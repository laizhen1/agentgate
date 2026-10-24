"""Publish all locked results and family-cluster uncertainty, without selecting on test."""
import argparse
import csv
import statistics
from pathlib import Path
from run_experiment import dump, model_name, read, tfidf_name
from verify_results import verify
from family_bootstrap import bootstrap


def pct(value):
    return 'n/a' if value is None else f'{value*100:.2f}%'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    run = args.run
    verify(args.source, run)
    comparison, hp = read(run / 'comparison.json'), read(run / 'hyperparameter-selection.json')
    manifest = read(run / 'manifest.json')
    p = manifest['protocol']
    seeds = [p['screen_seed']] + p['confirmation_seeds']
    neural = [model_name(hp['learning_rate'], s) for s in seeds]
    baselines = list(dict.fromkeys([tfidf_name({'features': 'word', 'C': 1}), tfidf_name(hp['tfidf_config'])]))

    def row(name, dataset, policy):
        return next(r for r in comparison if r['model'] == name and r['dataset'] == dataset and r['threshold_policy'] == policy)

    aggregates = []
    for dataset in ('domain-test', 'deepset', 'notinject'):
        for policy in ('validation-selected', 'fixed-0.5'):
            record = {'dataset': dataset, 'threshold_policy': policy, 'seeds': seeds}
            for metric in ('f1', 'recall', 'falsePositiveRate', 'precision'):
                values = [row(n, dataset, policy)[metric] for n in neural]
                record[metric] = None if any(v is None for v in values) else {
                    'mean': statistics.mean(values), 'min': min(values), 'max': max(values), 'sample_sd': statistics.stdev(values)}
            aggregates.append(record)

    def aggregate(dataset, policy):
        return next(r for r in aggregates if r['dataset'] == dataset and r['threshold_policy'] == policy)

    intervals = [r for policy in ('validation-selected', 'fixed-0.5') for r in bootstrap(run, baselines, neural, policy)]
    limitation = ('Paired bootstrap of 48 newly held-out synthetic families, not 96 independent scenarios. '
                  'Intervals exclude author/style bias and validation-selection uncertainty. '
                  'All labels are AI-authored, without independent human validation. Seeds do not add independent test cases.')
    dump(run / 'aggregate.json', {'seed_aggregates': aggregates, 'paired_family_bootstrap': intervals, 'limitations': limitation})
    dump(run / 'verification.json', verify(args.source, run))
    fields = ['model', 'dataset', 'threshold_policy', 'threshold', 'total', 'tp', 'fp', 'tn', 'fn', 'f1', 'recall', 'falsePositiveRate', 'precision', 'errors']
    with (run / 'comparison.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(comparison)
    primary = aggregate('domain-test', 'validation-selected')
    tuned_name = tfidf_name(hp['tfidf_config'])
    tuned = row(tuned_name, 'domain-test', 'validation-selected')
    effect = next(r for r in intervals if r['model'] == 'selected-deberta-three-seed-mean' and r['baseline'] == tuned_name and r['threshold_policy'] == 'validation-selected')
    external = aggregate('deepset', 'fixed-0.5')
    if effect['ci95'][0] > 0:
        conclusion = 'DeBERTa beats validation-selected TF-IDF on this fresh synthetic test, with a paired family-bootstrap interval excluding zero. This does not establish real-world or cross-domain superiority.'
    elif effect['ci95'][1] < 0:
        conclusion = 'DeBERTa underperforms validation-selected TF-IDF on this fresh synthetic test, with a paired family-bootstrap interval excluding zero.'
    else:
        conclusion = 'This comparison does not establish a clear F1 advantage: the paired family-bootstrap interval includes zero.'
    lines = ['# DeBERTa v3: expanded families and fresh held-out comparison', '',
        'Actual local GPU training and inference. Dataset and fitting protocol committed before training in `fce251bfc5bc2b20d1f48a1aa4b618c775f69963`. Frozen v1/v2 evidence remains unchanged.', '',
        '## Direct answer', '', conclusion, '',
        f"- Primary, validation-selected thresholds: **{pct(primary['f1']['mean'])}** DeBERTa mean F1 (seeds 42/43/44) versus **{pct(tuned['f1'])}** for `{tuned_name}`. Difference **{effect['delta_f1']*100:+.2f} pp**, paired-family 95% interval **[{effect['ci95'][0]*100:+.2f}, {effect['ci95'][1]*100:+.2f}] pp**.",
        f"- Original-style word C=1 baseline refit on the same data: **{pct(row(baselines[0], 'domain-test', 'validation-selected')['f1'])}** F1. Both baselines are disclosed; neither was selected by test score.",
        f"- DeBERTa mean recall **{pct(primary['recall']['mean'])}**, FPR **{pct(primary['falsePositiveRate']['mean'])}**. Seeds exceeding the 5% test-FPR target: **{sum(row(n, 'domain-test', 'validation-selected')['falsePositiveRate']>.05 for n in neural)}/3**. Validation's empirical constraint is not a test guarantee.",
        f"- Fixed-0.5 deepset F1: upstream **{pct(row('pretrained', 'deepset', 'fixed-0.5')['f1'])}**, adapted mean **{pct(external['f1']['mean'])}**. Recall: upstream **{pct(row('pretrained', 'deepset', 'fixed-0.5')['recall'])}**, adapted **{pct(external['recall']['mean'])}**.",
        '- No checkpoint is promoted to the default detector. Classifier results are not agent attack-success rates.', '',
        '## Data and frozen design', '',
        '- Added 240 original AI-authored contrast families across eight procurement categories, one benign and one attack text each. No new wrapper expansion.',
        '- New families split 144/48/48. Training also retains 72 unwrapped texts from 36 old training families; old validation/test are excluded. Totals: **360/96/96 texts**, **180/48/48 families**.',
        '- Training families increased fivefold (36 to 180) and test families fourfold (12 to 48). This is not a controlled data-size ablation: authoring, wrapper removal, learning-rate grid and baseline features also changed.',
        '- The test is new to fitting/selection, but authors saw its texts during construction. AI labels, shared style and attack concepts, short fragments and limited multilingual examples restrict generalization. No independent human annotation or production evaluation.',
        '- Domain splits are balanced at 50% attacks. Deployment precision depends on the actual attack prevalence; these F1 values are not estimates for natural procurement traffic.',
        '- Cross-split normalized exact and character-5-gram overlap checks passed at the frozen 0.65 Jaccard threshold, including comparisons with old holdouts and public diagnostics. This is not proof of semantic novelty or absence from upstream pretraining.',
        '- Full-parameter adaptation of the upstream ProtectAI DeBERTa-v3 detector: 184,423,682 trainable parameters, revision `90c9989b1a342275dd0d1a95aad283c04e075671`. Each run starts from upstream, not the old adapted checkpoint.',
        f"- Learning rates 1e-5, 2e-5, 5e-5 screened with seed 42; selected **{hp['learning_rate']:g}**. Three epochs, AdamW, weight decay 0.01, linear schedule, 10% warmup, BF16, gradient checkpointing, microbatch 1 × accumulation 8, max length 512 and stride 64. All training texts fit one window.",
        '- TF-IDF: word uni/bigrams, character-within-word 3–5-grams, or concatenation; C=0.1/1/10 for each. Balanced logistic regression, seed 42. Nine cheap classical candidates versus three neural learning rates, not equal compute.',
        '- Same selection endpoint: maximum validation recall at FPR <=5%, ties use precision then higher threshold; hyperparameters maximize validation F1, then lower log loss, then grid order. Final epoch only, no best-epoch search.',
        '- Freeze LR before training seeds 43/44. The mean includes screening seed 42; it is not three independent validation searches. Lock all models/thresholds before test/public predictions. No post-test tuning or best-test-seed selection.', '',
        '## All screening validation results', '',
        '| Candidate | F1 | Recall | FPR | Log loss | Threshold |', '|---|---:|---:|---:|---:|---:|']
    for chosen in hp['tfidf_candidates'] + hp['neural_candidates']:
        m = chosen['metrics']
        lines.append(f"| {chosen['name']} | {pct(m['f1'])} | {pct(m['recall'])} | {pct(m['falsePositiveRate'])} | {chosen['log_loss']:.6f} | {chosen['threshold']:.8f} |")
    lines += ['', '## Every test and external result', '',
        'deepset has 662 labelled examples. NotInject has 339 benign-only examples, so attack recall/F1 are undefined. Both diagnostics are unchanged and unused for fitting/selection. Their earlier results were known; upstream pretraining overlap is unknown. Do not pool them as a 1,001-example F1 test.', '']
    for policy in ('validation-selected', 'fixed-0.5'):
        lines += [f'### {policy}', '', '| Dataset | Model | N | TP / FN | FP / TN | F1 | Recall | FPR |', '|---|---|---:|---:|---:|---:|---:|---:|']
        for r in comparison:
            if r['threshold_policy'] == policy:
                lines.append(f"| {r['dataset']} | {r['model']} | {r['total']} | {r['tp']} / {r['fn']} | {r['fp']} / {r['tn']} | {pct(r['f1'])} | {pct(r['recall'])} | {pct(r['falsePositiveRate'])} |")
        lines += ['']
    lines += ['## Seed variability', '', '| Dataset | Threshold | Mean F1 | F1 min / max | F1 SD (pp) | Mean recall | Mean FPR |', '|---|---|---:|---:|---:|---:|---:|']
    for r in aggregates:
        f = r['f1']
        avg = pct(f['mean']) if f else 'n/a'
        extent = pct(f['min'])+' / '+pct(f['max']) if f else 'n/a'
        sd = f"{f['sample_sd']*100:.2f}" if f else 'n/a'
        recall = pct(r['recall']['mean']) if r['recall'] else 'n/a'
        lines.append(f"| {r['dataset']} | {r['threshold_policy']} | {avg} | {extent} | {sd} | {recall} | {pct(r['falsePositiveRate']['mean'])} |")
    primary_reports = {name: read(run / name / 'domain-test.json') for name in [tuned_name]+neural}
    lines += ['', '## Fresh-test error slices', '',
        'Each category has only six held-out pairs (12 texts). These slices are descriptive, not grounds for another model-selection round.', '',
        '| Category | TF-IDF F1 | DeBERTa mean F1 | TF-IDF FPR | DeBERTa mean FPR |', '|---|---:|---:|---:|---:|']
    for category, lexical in primary_reports[tuned_name]['slices']['category'].items():
        adapted = [primary_reports[name]['slices']['category'][category] for name in neural]
        lines.append(f"| {category} | {pct(lexical['f1'])} | {pct(statistics.mean(r['f1'] for r in adapted))} | {pct(lexical['falsePositiveRate'])} | {pct(statistics.mean(r['falsePositiveRate'] for r in adapted))} |")
    lookup = {name: {r['id']: r for r in result['examples']} for name, result in primary_reports.items()}
    all_wrong = [identifier for identifier, example in lookup[tuned_name].items()
                 if all(lookup[n][identifier]['prediction'] != example['label'] for n in neural)]
    lexical_only_correct = [identifier for identifier in all_wrong
                           if lookup[tuned_name][identifier]['prediction'] == lookup[tuned_name][identifier]['label']]
    lines += ['', f"All three DeBERTa seeds wrong at their selected thresholds: {len(all_wrong)} texts. IDs: " + (', '.join(f'`{i}`' for i in all_wrong) or 'none') + '.',
        f"Of those, selected TF-IDF is correct on {len(lexical_only_correct)}: " + (', '.join(f'`{i}`' for i in lexical_only_correct) or 'none') + '.',
        'Inspect the saved text/probability/outcome records for these cases. No labels, thresholds or models were changed in response to this error inspection.']
    lines += ['', '## Paired family uncertainty', '', limitation,
        ' Five thousand paired bootstrap resamples preserve both texts in each family and use the same draws for every model. The calculation uses Python `random.Random(20261024)`.', '',
        '| Threshold | Baseline | DeBERTa mean minus baseline (pp) | 95% interval (pp) |', '|---|---|---:|---:|']
    for r in intervals:
        if r['model'] == 'selected-deberta-three-seed-mean':
            lines.append(f"| {r['threshold_policy']} | {r['baseline']} | {r['delta_f1']*100:+.2f} | [{r['ci95'][0]*100:+.2f}, {r['ci95'][1]*100:+.2f}] |")
    lines += ['', '## Training evidence', '', '| Run | Parameters | Seconds | Peak allocated GiB | Mean training loss |', '|---|---:|---:|---:|---:|---:|']
    for directory in sorted(run.iterdir()):
        if (directory / 'training.json').exists():
            t = read(directory / 'training.json')
            lines.append(f"| {directory.name} | {t['trainable_parameters']:,} | {t['seconds']:.1f} | {t['peak_cuda_allocated_bytes']/1024**3:.2f} | {t['metrics']['train_loss']:.6f} |")
    lines += ['', '## Reproduction boundaries', '',
        '- `comparison.csv` contains every confusion matrix; per-model JSON contains predictions and slices for error inspection. `aggregate.json` includes per-seed and mean bootstrap comparisons.',
        '- `verify_results.py` replays code/data hashes, candidate rankings, thresholds, chronology, prediction identity, metric tables, seed statistics and bootstrap intervals. It does not rerun GPU training.',
        '- Public evidence omits account paths, credentials and weights. Training uses local synthetic inputs and offline models; no real buyer or supplier records.',
        f"- Hardware: {manifest['environment']['gpu']}; PyTorch {manifest['environment']['torch']}; Transformers {manifest['environment']['transformers']}. GPU sharing and temperature affect timings; no controlled speed claim. Fixed seeds do not guarantee cross-hardware bit identity.", '']
    (run / 'REPORT.md').write_text('\n'.join(lines), encoding='utf-8')
    print(f"Mean DeBERTa F1={primary['f1']['mean']:.6f}; selected TF-IDF={tuned['f1']:.6f}; delta={effect['delta_f1']:.6f}; CI={effect['ci95']}")


if __name__ == '__main__':
    main()
