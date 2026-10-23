"""Describe the locked comparison, including unfavorable results and clustered uncertainty."""
import argparse
import csv
from pathlib import Path
from run_experiment import dump, model_name, read, tfidf_name
from verify_results import verify


def pct(value):
    return 'n/a' if value is None else f'{value*100:.2f}%'


def main():
    import numpy as np
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    run = args.run
    verified = verify(args.source, run)
    comparison, hp = read(run / 'comparison.json'), read(run / 'hyperparameter-selection.json')
    manifest = read(run / 'manifest.json')
    p = manifest['protocol']
    seeds = [p['screen_seed']] + p['confirmation_seeds']
    neural_names = [model_name(hp['learning_rate'], seed) for seed in seeds]
    baselines = list(dict.fromkeys([tfidf_name(1), tfidf_name(hp['tfidf_C'])]))

    def row(name, dataset, policy):
        return next(r for r in comparison if r['model'] == name and r['dataset'] == dataset and r['threshold_policy'] == policy)

    aggregates = []
    for dataset in ('domain-test', 'deepset', 'notinject'):
        for policy in ('validation-selected', 'fixed-0.5'):
            result = {'dataset': dataset, 'threshold_policy': policy, 'seeds': seeds}
            for metric in ('f1', 'recall', 'falsePositiveRate', 'precision'):
                values = [row(n, dataset, policy)[metric] for n in neural_names]
                result[metric] = None if any(v is None for v in values) else {
                    'mean': float(np.mean(values)), 'min': min(values), 'max': max(values),
                    'sample_sd': float(np.std(values, ddof=1))}
            aggregates.append(result)

    def aggregate(dataset, policy):
        return next(r for r in aggregates if r['dataset'] == dataset and r['threshold_policy'] == policy)

    intervals = []
    for policy, suffix in [('validation-selected', ''), ('fixed-0.5', '-fixed')]:
        names = baselines + neural_names
        predictions = {n: read(run / n / f'domain-test{suffix}.json')['examples'] for n in names}
        groups = sorted({r['group'] for r in predictions[names[0]]})
        counts = np.zeros((len(names), len(groups), 4), dtype=np.int64)
        for i, name in enumerate(names):
            for r in predictions[name]:
                # tp, fp, fn, tn
                outcome = 0 if r['label'] and r['prediction'] else 1 if r['prediction'] else 2 if r['label'] else 3
                counts[i, groups.index(r['group']), outcome] += 1
        rng = np.random.default_rng(20261024)
        draws = rng.integers(0, len(groups), size=(5000, len(groups)))
        totals = counts[:, draws, :].sum(axis=2)
        f1 = 2*totals[:, :, 0] / (2*totals[:, :, 0]+totals[:, :, 1]+totals[:, :, 2])
        for b, baseline in enumerate(baselines):
            for i, name in enumerate(neural_names):
                values = f1[len(baselines)+i] - f1[b]
                intervals.append({'baseline': baseline, 'model': name, 'threshold_policy': policy,
                    'delta_f1': row(name, 'domain-test', policy)['f1']-row(baseline, 'domain-test', policy)['f1'],
                    'ci95': np.quantile(values, [.025, .975]).tolist(), 'clusters': len(groups), 'resamples': 5000})
            values = f1[len(baselines):].mean(axis=0)-f1[b]
            intervals.append({'baseline': baseline, 'model': 'selected-deberta-three-seed-mean', 'threshold_policy': policy,
                'delta_f1': aggregate('domain-test', policy)['f1']['mean']-row(baseline, 'domain-test', policy)['f1'],
                'ci95': np.quantile(values, [.025, .975]).tolist(), 'clusters': len(groups), 'resamples': 5000})
    dump(run / 'aggregate.json', {'seed_aggregates': aggregates, 'paired_family_bootstrap': intervals,
        'limitations': 'Descriptive exploratory intervals. Twelve previously observed test families; validation selection and adaptive reuse are not reflected in intervals. Seeds and variants are not new independent test cases.'})
    dump(run / 'verification.json', verified)
    fields = ['model', 'dataset', 'threshold_policy', 'threshold', 'total', 'tp', 'fp', 'tn', 'fn', 'f1', 'recall', 'falsePositiveRate', 'precision', 'errors']
    with (run / 'comparison.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(comparison)

    primary = aggregate('domain-test', 'validation-selected')
    external = aggregate('deepset', 'fixed-0.5')
    original = row(tfidf_name(1), 'domain-test', 'validation-selected')
    tuned = row(tfidf_name(hp['tfidf_C']), 'domain-test', 'validation-selected')
    delta = primary['f1']['mean'] - original['f1']
    verb = 'higher' if delta > 0 else 'lower' if delta < 0 else 'equal'
    old = read(args.source / 'results/comparison.json')
    old_domain = [r['f1'] for r in old if r['model'].startswith('finetuned') and r['dataset'] == 'domain-test' and r['threshold_policy'] == 'validation-selected']
    old_external = [r['f1'] for r in old if r['model'].startswith('finetuned') and r['dataset'] == 'deepset' and r['threshold_policy'] == 'fixed-0.5']
    lines = ['# DeBERTa v2: validation-selected learning-rate follow-up', '',
        'Real local GPU training and inference. This is an exploratory follow-up on the already observed v1 datasets, not a fresh blind benchmark.', '',
        '## Direct answer', '',
        f"- Selected learning rate: `{hp['learning_rate']:g}`. Domain F1 at validation-selected thresholds: **{pct(primary['f1']['mean'])}** (mean of seeds 42/43/44), versus **{pct(original['f1'])}** for the original TF-IDF C=1 baseline ({abs(delta)*100:.2f} percentage points {verb}).",
        f"- Validation-selected TF-IDF C={hp['tfidf_C']:g}: **{pct(tuned['f1'])}** domain F1. Both classical baselines are reported; neither is chosen using test results.",
        f"- Selected DeBERTa mean recall **{pct(primary['recall']['mean'])}**, FPR **{pct(primary['falsePositiveRate']['mean'])}**. Test seeds exceeding the 5% FPR target: {sum(row(n, 'domain-test', 'validation-selected')['falsePositiveRate'] > .05 for n in neural_names)}/3.",
        f"- Fixed-0.5 deepset F1: upstream **{pct(row('pretrained', 'deepset', 'fixed-0.5')['f1'])}**, v1 fine-tuned mean **{pct(float(np.mean(old_external)))}**, v2 mean **{pct(external['f1']['mean'])}**. External data was not used for new selection, but its v1 regression motivated this experiment.",
        '- Small numerical differences do not establish general superiority. Inspect the family bootstrap intervals, both thresholds, all seeds and external results below. No checkpoint is automatically promoted.', '',
        '## Frozen design', '',
        '- Same 480 synthetic variants from 60 authored contrast families; 288/96/96 train/validation/test with 36/12/12 families. No new data or relabeling.',
        '- Full-parameter upstream ProtectAI DeBERTa-v3 injection-detector adaptation, three epochs per run; learning rates 5e-6, 1e-5, 2e-5 screened using seed 42.',
        '- AdamW, weight decay 0.01, linear schedule, 10% warmup, BF16, gradient checkpointing, microbatch 1 and accumulation 8. Max length 512 and stride 64. No epoch selection.',
        '- Threshold policy is unchanged from v1: maximize validation recall subject to empirical FPR <=5%, then precision, then higher threshold. This does not guarantee test FPR <=5%.',
        '- Hyperparameters maximize validation-selected F1; ties favor lower validation log loss, then earlier candidate order. TF-IDF word unigrams/bigrams uses C=0.1,1,10 with the same rule.',
        '- Freeze the LR using screening seed 42, then train seeds 43 and 44. The three-seed mean includes the screening seed and is not an independent confirmation. All screening validation results retained; unselected neural candidates are not tested.',
        '- Model and threshold selection is locked before test/public prediction generation. Existing v1 results were already known: the reused test is exploratory, not pristine. No tuning after this run\'s test results.', '',
        '## Validation search', '',
        '| Candidate | Validation F1 | Recall | FPR | Log loss | Threshold |',
        '|---|---:|---:|---:|---:|---:|']
    for chosen in hp['tfidf_candidates'] + hp['neural_candidates']:
        m = chosen['metrics']
        lines.append(f"| {chosen['name']} | {pct(m['f1'])} | {pct(m['recall'])} | {pct(m['falsePositiveRate'])} | {chosen['log_loss']:.6f} | {chosen['threshold']:.8f} |")
    lines += ['', '## Every test and external result', '',
        'NotInject contains 339 benign-only examples; attack F1 and recall are undefined. deepset has 662 labeled examples and is reported separately. Neither is guaranteed unseen by the upstream model.', '']
    for policy in ('validation-selected', 'fixed-0.5'):
        lines += [f'### {policy}', '', '| Dataset | Model | N | TP / FN | FP / TN | F1 | Recall | FPR |', '|---|---|---:|---:|---:|---:|---:|---:|']
        for r in comparison:
            if r['threshold_policy'] == policy:
                lines.append(f"| {r['dataset']} | {r['model']} | {r['total']} | {r['tp']} / {r['fn']} | {r['fp']} / {r['tn']} | {pct(r['f1'])} | {pct(r['recall'])} | {pct(r['falsePositiveRate'])} |")
        lines += ['']
    lines += ['## Three-seed averages', '', '| Dataset | Threshold | Mean F1 | F1 min / max | Mean recall | Mean FPR |', '|---|---|---:|---:|---:|---:|']
    for r in aggregates:
        f = r['f1']
        lines.append(f"| {r['dataset']} | {r['threshold_policy']} | {pct(f['mean']) if f else 'n/a'} | {(pct(f['min'])+' / '+pct(f['max'])) if f else 'n/a'} | {pct(r['recall']['mean']) if r['recall'] else 'n/a'} | {pct(r['falsePositiveRate']['mean'])} |")
    lines += ['', '## Paired family bootstrap', '',
        '5,000 paired resamples of all 12 test families, preserving all within-family variants and the same sampled families for every model. Seed variation is reported separately. These exploratory 95% percentile intervals do not account for previous test reuse or validation selection.', '',
        '| Threshold | Baseline | DeBERTa mean minus baseline (pp) | 95% interval (pp) |', '|---|---|---:|---:|']
    for r in intervals:
        if r['model'] == 'selected-deberta-three-seed-mean':
            lines.append(f"| {r['threshold_policy']} | {r['baseline']} | {r['delta_f1']*100:+.2f} | [{r['ci95'][0]*100:+.2f}, {r['ci95'][1]*100:+.2f}] |")
    lines += ['', '## Training evidence', '', '| Run | Trainable parameters | Seconds | Peak allocated GiB | Final loss |', '|---|---:|---:|---:|---:|']
    for directory in sorted(run.iterdir()):
        if (directory / 'training.json').exists():
            t = read(directory / 'training.json')
            lines.append(f"| {directory.name} | {t['trainable_parameters']:,} | {t['seconds']:.1f} | {t['peak_cuda_allocated_bytes']/1024**3:.2f} | {t['metrics']['train_loss']:.6f} |")
    lines += ['', '## Interpretation and reproduction boundaries', '',
        f"- Historical v1 mean domain F1 was {pct(float(np.mean(old_domain)))}. This run is an additional, disclosed experiment, not a replacement of the frozen v1 evidence.",
        '- Public diagnostic regressions and test FPR target violations must accompany favorable domain numbers. A lower false-positive rate can coincide with missed attacks.',
        '- This is a classifier experiment; results are not AgentGate agent attack-success rates or evidence that a deployed agent is safe.',
        '- Only 12 test families and 12 validation families exist. Shared synthetic authoring style, within-family correlation and single-seed hyperparameter screening limit conclusions.',
        '- Training and scoring use the pinned local checkpoint; no API requests or production/user data. Published files omit local account paths; large checkpoints remain local.',
        '- `verify_results.py` replays thresholds, selection, provenance, chronology and metric tables using stored predictions. It does not retrain the model. Checkpoints and frozen data are required for GPU reproduction.',
        f"- Hardware: {manifest['environment']['gpu']}; PyTorch {manifest['environment']['torch']}; Transformers {manifest['environment']['transformers']}. Fixed seeds do not guarantee cross-hardware bit identity.", '']
    (run / 'REPORT.md').write_text('\n'.join(lines), encoding='utf-8')
    print(f"Verified and summarized: selected LR={hp['learning_rate']}, mean F1={primary['f1']['mean']:.6f}, original TF-IDF={original['f1']:.6f}, tuned TF-IDF={tuned['f1']:.6f}")


if __name__ == '__main__':
    main()
