"""Offline, validation-selected follow-up. Run selection before evaluation."""
import argparse
import gc
import hashlib
import json
import math
import os
import platform
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['CUBLAS_WORKSPACE_CONFIG'] = ':4096:8'
from analysis import calibrate, dataset_hash, metrics, read_dataset, report, validate_splits, write_report

ROOT = Path(__file__).resolve().parent


def now():
    return datetime.now(timezone.utc).isoformat()


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def selection_key(selection):
    # max() retains first candidate for an exact tie.
    return (selection['metrics']['f1'] or 0, -selection['log_loss'])


def select(rows, max_fpr):
    threshold = calibrate(rows, max_fpr)
    loss = -sum(r['label'] * math.log(max(1e-15, r['score'])) +
                (1-r['label']) * math.log(max(1e-15, 1-r['score'])) for r in rows) / len(rows)
    return {'threshold': threshold, 'log_loss': loss, 'metrics': metrics(rows, threshold)}


def model_name(lr, seed):
    return f'deberta-lr{lr:.0e}-seed{seed}'


def tfidf_name(config):
    return f"tfidf-{config['features']}-C{config['C']:g}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True, help='Frozen v1 experiment including base-model')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--stage', choices=['select', 'evaluate'], required=True)
    parser.add_argument('--resume', action='store_true', help='Resume completed stages with exact provenance only')
    args = parser.parse_args()
    import numpy as np
    import sklearn
    import torch
    import transformers
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.pipeline import FeatureUnion
    from transformers import AutoModelForSequenceClassification, AutoTokenizer, DataCollatorWithPadding, Trainer, TrainingArguments, set_seed

    p = read(ROOT / 'protocol.json')
    source, output = args.source.resolve(), args.output.resolve()
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError('This protocol requires a CUDA GPU with BF16 support')
    torch.set_num_threads(4)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    data_root = ROOT / 'data'
    data_manifest = read(data_root / 'manifest.json')
    for key, path in [('families_sha256', ROOT / 'families.json'), ('builder_sha256', ROOT / 'prepare_data.py'),
                      ('overlap_audit_sha256', data_root / 'overlap-audit.json'), ('old_manifest_sha256', source / 'data/manifest.json')]:
        if dataset_hash(path) != data_manifest[key]:
            raise ValueError('Data construction provenance mismatch: ' + key)
    for name, record in data_manifest['datasets'].items():
        if dataset_hash(data_root / f'{name}.jsonl') != record['sha256']:
            raise ValueError('Frozen data hash mismatch: ' + name)
    base_records = [r for r in read(source / 'sources/manifest.json') if r['path'].startswith('base-model/')]
    if not any(r['path'] == 'base-model/model.safetensors' for r in base_records):
        raise ValueError('Missing base weight provenance')
    for record in base_records:
        if dataset_hash(source / record['path']) != record['sha256']:
            raise ValueError('Base model hash mismatch: ' + record['path'])
    provenance = {'protocol': p, 'data': data_manifest,
                  'code_sha256': {name: dataset_hash(ROOT / name) for name in ('run_experiment.py', 'analysis.py', 'protocol.json', 'families.json', 'prepare_data.py', 'author_families.py')},
                  'base_files': base_records}
    if args.stage == 'select' and not args.resume:
        output.mkdir(parents=True, exist_ok=False)
        dump(output / 'manifest.json', {**provenance, 'started_utc': now(), 'environment': {
            'python': platform.python_version(), 'torch': torch.__version__, 'transformers': transformers.__version__,
            'sklearn': sklearn.__version__, 'numpy': np.__version__, 'cuda': torch.version.cuda,
            'gpu': torch.cuda.get_device_name(0), 'cpu_threads': 4,
            'determinism': 'Fixed seeds; GPU/platform bit equivalence is not guaranteed'}})
        (output / 'environment.lock.txt').write_text(subprocess.check_output([os.sys.executable, '-m', 'pip', 'freeze'], text=True), encoding='utf-8')
    else:
        previous = read(output / 'manifest.json')
        for key, value in provenance.items():
            if previous[key] != value:
                raise ValueError('Refusing changed provenance: ' + key)

    def event(message):
        line = now() + ' ' + message
        print(line, flush=True)
        with (output / 'events.log').open('a', encoding='utf-8') as f:
            f.write(line + '\n')

    # Evaluation datasets are not parsed until a verified selection lock exists.
    splits = {k: read_dataset(data_root / f'{k}.jsonl', strict=True) for k in ('train', 'validation')}
    validate_splits(splits)

    def score(rows, predict, name, revision):
        results = []
        for i, row in enumerate(rows):
            torch.cuda.synchronize()
            started = time.perf_counter()
            value = float(predict(row['text']))
            torch.cuda.synchronize()
            if not np.isfinite(value) or not 0 <= value <= 1:
                raise ValueError('Invalid model probability')
            results.append({**row, 'score': value, 'durationMs': (time.perf_counter()-started)*1000,
                            'model': name, 'revision': revision})
            if (i+1) % 100 == 0:
                event(f'{name}: scored {i+1}/{len(rows)}')
        return results

    def validate(name, predict, revision):
        directory = output / name
        rows = score(splits['validation'], predict, name, revision)
        chosen = {**select(rows, p['max_validation_fpr']), 'name': name, 'revision': revision}
        write_report(report(rows, chosen['threshold'], split='validation'), directory / 'validation')
        dump(directory / 'selection.json', chosen)
        event(f"{name}: validation F1={chosen['metrics']['f1']:.6f}, logloss={chosen['log_loss']:.6f}")
        return chosen

    def fit_tfidf(config):
        word = TfidfVectorizer(ngram_range=(1, 2), max_features=30000, sublinear_tf=True)
        char = TfidfVectorizer(analyzer='char_wb', ngram_range=(3, 5), max_features=50000, sublinear_tf=True)
        features = {'word': word, 'char': char, 'union': FeatureUnion([('word', word), ('char', char)])}[config['features']]
        baseline = make_pipeline(features,
            LogisticRegression(C=config['C'], max_iter=1000, class_weight='balanced', random_state=42))
        baseline.fit([r['text'] for r in splits['train']], [r['label'] for r in splits['train']])
        if any(baseline[-1].n_iter_ >= 1000):
            raise RuntimeError('TF-IDF solver did not converge')
        return baseline

    def tfidf_evidence(baseline, config):
        features = baseline[0].transformer_list if config['features'] == 'union' else [(config['features'], baseline[0])]
        return {'config': config, 'coefficients': baseline[-1].coef_.tolist(), 'intercept': baseline[-1].intercept_.tolist(),
                'features': {name: {'idf': f.idf_.tolist(), 'vocabulary': {k: int(v) for k, v in f.vocabulary_.items()}}
                             for name, f in features}}

    tokenizer = AutoTokenizer.from_pretrained(source / 'base-model', local_files_only=True, trust_remote_code=False)

    def load(path):
        model = AutoModelForSequenceClassification.from_pretrained(path, local_files_only=True, trust_remote_code=False, use_safetensors=True)
        if {int(k): v.upper() for k, v in model.config.id2label.items()} != {0: 'SAFE', 1: 'INJECTION'}:
            raise ValueError('Unexpected class mapping')
        return model.to('cuda')

    def predictor(model):
        model.eval()
        def predict(text):
            tokens = tokenizer(text, truncation=True, max_length=p['max_length'], stride=p['stride'],
                               return_overflowing_tokens=True, padding=True, return_tensors='pt')
            tokens.pop('overflow_to_sample_mapping', None)
            with torch.inference_mode():
                scores = [model(**{k: v[i:i+1].to('cuda') for k, v in tokens.items()}).logits.softmax(-1)[0, 1].item()
                          for i in range(len(tokens['input_ids']))]
            return max(scores)
        for _ in range(3):
            predict(splits['train'][0]['text'])
        return predict

    def cleanup():
        gc.collect()
        torch.cuda.empty_cache()

    class TrainingData(torch.utils.data.Dataset):
        def __init__(self):
            self.items = []
            for row in splits['train']:
                tokens = tokenizer(row['text'], truncation=True, max_length=p['max_length'], stride=p['stride'], return_overflowing_tokens=True)
                tokens.pop('overflow_to_sample_mapping', None)
                if row['label'] and len(tokens['input_ids']) > 1:
                    raise ValueError('Positive windows require localized labels')
                self.items.extend({**{k: v[i] for k, v in tokens.items()}, 'labels': row['label']} for i in range(len(tokens['input_ids'])))
        def __len__(self):
            return len(self.items)
        def __getitem__(self, index):
            return self.items[index]

    def train(lr, seed):
        name = model_name(lr, seed)
        directory = output / name
        if (directory / 'selection.json').exists():
            chosen = read(directory / 'selection.json')
            if dataset_hash(directory / 'checkpoint/model.safetensors') != chosen['revision']:
                raise ValueError('Completed checkpoint hash mismatch')
            event('Resume completed ' + name)
            return chosen
        directory.mkdir(exist_ok=True)
        set_seed(seed)
        model = load(source / 'base-model')
        torch.cuda.reset_peak_memory_stats()
        event(f'Training {name}: full parameters, {p["epochs"]} epochs; evaluation unopened')
        started = time.perf_counter()
        trainer = Trainer(model=model, train_dataset=TrainingData(),
            data_collator=DataCollatorWithPadding(tokenizer=tokenizer, pad_to_multiple_of=8),
            args=TrainingArguments(output_dir=str(directory / 'trainer'), num_train_epochs=p['epochs'], learning_rate=lr,
                per_device_train_batch_size=p['batch_size'], gradient_accumulation_steps=p['gradient_accumulation_steps'],
                weight_decay=p['weight_decay'], warmup_ratio=p['warmup_ratio'], lr_scheduler_type='linear',
                optim='adamw_torch', bf16=True, gradient_checkpointing=True,
                gradient_checkpointing_kwargs={'use_reentrant': False}, seed=seed, data_seed=seed,
                save_strategy='no', report_to='none', logging_steps=10, disable_tqdm=True,
                dataloader_num_workers=0, dataloader_pin_memory=True))
        result = trainer.train()
        elapsed = time.perf_counter()-started
        if not np.isfinite(result.training_loss):
            raise RuntimeError('Nonfinite training loss')
        model.config._name_or_path = p['model']
        model.save_pretrained(directory / 'checkpoint', safe_serialization=True)
        tokenizer.save_pretrained(directory / 'checkpoint')
        revision = dataset_hash(directory / 'checkpoint/model.safetensors')
        dump(directory / 'training.json', {'seed': seed, 'learning_rate': lr, 'seconds': elapsed,
            'trainable_parameters': sum(t.numel() for t in model.parameters() if t.requires_grad),
            'peak_cuda_allocated_bytes': torch.cuda.max_memory_allocated(), 'metrics': result.metrics,
            'log_history': trainer.state.log_history, 'checkpoint_sha256': revision})
        del trainer
        model.gradient_checkpointing_disable()
        predict = predictor(model)
        chosen = validate(name, predict, revision)
        del predict, model
        cleanup()
        event(f'Finished {name}: {elapsed:.1f} seconds')
        return chosen

    lock_path = output / 'selection-lock.json'
    if args.stage == 'select':
        if lock_path.exists():
            raise ValueError('Selection already locked; proceed to evaluate, do not retune')
        for config in p['tfidf_candidates']:
            name = tfidf_name(config)
            if (output / name / 'selection.json').exists():
                continue
            baseline = fit_tfidf(config)
            directory = output / name
            directory.mkdir(exist_ok=True)
            dump(directory / 'weights.json', tfidf_evidence(baseline, config))
            validate(name, lambda text: baseline.predict_proba([text])[0, 1], dataset_hash(directory / 'weights.json'))
        if not (output / 'pretrained/selection.json').exists():
            model = load(source / 'base-model')
            predict = predictor(model)
            validate('pretrained', predict, p['revision'])
            del predict, model
            cleanup()
        candidate_path = output / 'hyperparameter-selection.json'
        if not candidate_path.exists():
            neural = [train(lr, p['screen_seed']) for lr in p['learning_rates']]
            best_index = max(range(len(neural)), key=lambda i: selection_key(neural[i]))
            classical = [read(output / tfidf_name(config) / 'selection.json') for config in p['tfidf_candidates']]
            best_c = max(range(len(classical)), key=lambda i: selection_key(classical[i]))
            dump(candidate_path, {'utc': now(), 'learning_rate': p['learning_rates'][best_index],
                 'tfidf_config': p['tfidf_candidates'][best_c], 'neural_candidates': neural, 'tfidf_candidates': classical,
                 'selection_data': 'validation only; screening seed 42'})
        candidate = read(candidate_path)
        event(f"Hyperparameters frozen: LR={candidate['learning_rate']}, TF-IDF={candidate['tfidf_config']}")
        for seed in p['confirmation_seeds']:
            train(candidate['learning_rate'], seed)
        names = list(dict.fromkeys([tfidf_name({'features': 'word', 'C': 1}), tfidf_name(candidate['tfidf_config']), 'pretrained'] +
                   [model_name(candidate['learning_rate'], s) for s in [p['screen_seed']] + p['confirmation_seeds']]))
        locked_files = {name: dataset_hash(output / name) for name in ['manifest.json', 'hyperparameter-selection.json']}
        for directory in sorted(output.iterdir()):
            if directory.is_dir():
                for file in ('selection.json', 'validation.json', 'training.json'):
                    if (directory / file).exists():
                        relative = directory.name + '/' + file
                        locked_files[relative] = dataset_hash(output / relative)
        dump(lock_path, {'utc': now(), 'models': names, 'files_sha256': locked_files,
                        'selections': {name: read(output / name / 'selection.json') for name in names}})
        event('All selections and training locked. No evaluation predictions produced yet.')
        return

    lock = read(lock_path)
    for relative, sha in lock['files_sha256'].items():
        if dataset_hash(output / relative) != sha:
            raise ValueError('Changed selection artifact: ' + relative)
    if (output / 'comparison.json').exists():
        raise ValueError('Evaluation already complete; use saved predictions for analysis')
    if (output / 'evaluation-start.json').exists() and not args.resume:
        raise ValueError('Interrupted evaluation requires explicit --resume')
    if not (output / 'evaluation-start.json').exists():
        dump(output / 'evaluation-start.json', {'utc': now(), 'selection_lock_sha256': dataset_hash(lock_path)})
    if read(output / 'evaluation-start.json')['selection_lock_sha256'] != dataset_hash(lock_path):
        raise ValueError('Selection changed after evaluation started')
    event('Opening evaluation with locked models and thresholds; no further tuning allowed')
    datasets = {key: read_dataset(data_root / f'{value}.jsonl', strict=True)
                for key, value in [('domain-test', 'test'), ('deepset', 'deepset'), ('notinject', 'notinject')]}
    validate_splits({**splits, 'test': datasets['domain-test']})
    comparisons = []
    for name in lock['models']:
        chosen = lock['selections'][name]
        if name.startswith('tfidf'):
            config = next(c for c in p['tfidf_candidates'] if tfidf_name(c) == name)
            baseline = fit_tfidf(config)
            if tfidf_evidence(baseline, config) != read(output / name / 'weights.json'):
                raise ValueError('Refitted TF-IDF differs from selected weights')
            predict = lambda text: baseline.predict_proba([text])[0, 1]
        else:
            path = source / 'base-model' if name == 'pretrained' else output / name / 'checkpoint'
            if name != 'pretrained' and dataset_hash(path / 'model.safetensors') != chosen['revision']:
                raise ValueError('Selected checkpoint mismatch')
            model = load(path)
            predict = predictor(model)
        for dataset_name, rows in datasets.items():
            path = output / name / dataset_name
            if path.with_suffix('.json').exists():
                if not args.resume:
                    raise ValueError('Recorded predictions require explicit resume')
                predictions = read(path.with_suffix('.json'))['examples']
            else:
                predictions = score(rows, predict, name, chosen['revision'])
            for policy, threshold, suffix in [('validation-selected', chosen['threshold'], ''), ('fixed-0.5', .5, '-fixed')]:
                result = report(predictions, threshold, split=dataset_name, threshold_policy=policy)
                # Attack F1 is undefined when the dataset has no positive labels.
                if not any(r['label'] for r in rows):
                    result['f1'] = None
                write_report(result, output / name / (dataset_name + suffix))
                comparisons.append({'model': name, 'dataset': dataset_name,
                    **{k: v for k, v in result.items() if k not in ('examples', 'precisionRecall', 'slices')}})
            event(f'{name}: saved {dataset_name}')
        del predict
        if not name.startswith('tfidf'):
            del model
        cleanup()
    dump(output / 'comparison.json', comparisons)
    dump(output / 'evaluation-complete.json', {'utc': now(), 'selection_lock_sha256': dataset_hash(lock_path),
         'comparison_sha256': dataset_hash(output / 'comparison.json')})
    event('Evaluation complete')


if __name__ == '__main__':
    main()
