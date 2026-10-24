"""Replay public prediction evidence without loading models or installing ML packages."""
import argparse
import json
import math
import statistics
from datetime import datetime
from pathlib import Path
from analysis import dataset_hash, metrics, read_dataset, validate_splits, report
from run_experiment import model_name, read, select, selection_key, tfidf_name

ROOT = Path(__file__).resolve().parent


def check_equal(actual, expected):
    if isinstance(expected, float):
        assert math.isclose(actual, expected, abs_tol=1e-12), (actual, expected)
    else:
        assert actual == expected, (actual, expected)


def verify(source, run):
    manifest = read(run / 'manifest.json')
    p = read(ROOT / 'protocol.json')
    assert p == manifest['protocol']
    for name, sha in manifest['code_sha256'].items():
        assert dataset_hash(ROOT / name) == sha, name
    assert read(ROOT / 'data/manifest.json') == manifest['data']
    assert dataset_hash(source / 'data/manifest.json') == manifest['data']['old_manifest_sha256']
    assert dataset_hash(ROOT / 'families.json') == manifest['data']['families_sha256']
    assert dataset_hash(ROOT / 'prepare_data.py') == manifest['data']['builder_sha256']
    assert dataset_hash(ROOT / 'data/overlap-audit.json') == manifest['data']['overlap_audit_sha256']
    assert not read(ROOT / 'data/overlap-audit.json')['cross_split_matches']
    assert manifest['base_files'] == [r for r in read(source / 'sources/manifest.json') if r['path'].startswith('base-model/')]
    for name, entry in manifest['data']['datasets'].items():
        assert dataset_hash(ROOT / 'data' / f'{name}.jsonl') == entry['sha256'], name
    datasets = {name: read_dataset(ROOT / 'data' / f'{name}.jsonl', strict=True)
                for name in ('train', 'validation', 'test', 'deepset', 'notinject')}
    validate_splits({k: datasets[k] for k in ('train', 'validation', 'test')})
    lock = read(run / 'selection-lock.json')
    for name, sha in lock['files_sha256'].items():
        assert dataset_hash(run / name) == sha, name
    hp = read(run / 'hyperparameter-selection.json')
    neural_names = [model_name(lr, p['screen_seed']) for lr in p['learning_rates']]
    tfidf_names = [tfidf_name(c) for c in p['tfidf_candidates']]
    all_names = list(dict.fromkeys(neural_names + tfidf_names + lock['models']))
    for name in all_names:
        chosen = read(run / name / 'selection.json')
        val = read(run / name / 'validation.json')
        rows = val['examples']
        assert len(rows) == len(datasets['validation'])
        for row, original in zip(rows, datasets['validation']):
            assert all(row[k] == v for k, v in original.items())
            assert row['model'] == name and row['revision'] == chosen['revision']
            assert not row.get('error') and math.isfinite(row['score']) and 0 <= row['score'] <= 1
        recalculated = select(rows, p['max_validation_fpr'])
        for key in ('threshold', 'log_loss'):
            check_equal(chosen[key], recalculated[key])
        assert chosen['metrics'] == recalculated['metrics']
        for key, value in recalculated['metrics'].items():
            check_equal(val[key], value)
        replay = report(rows, chosen['threshold'], split='validation')
        assert val == replay, 'Validation prediction/slice/curve mismatch: ' + name
        if name.startswith('deberta'):
            training = read(run / name / 'training.json')
            assert training['checkpoint_sha256'] == chosen['revision']
            assert training['trainable_parameters'] == 184423682
            assert training['metrics']['epoch'] == p['epochs']
            assert training['seconds'] > 0
    assert hp['neural_candidates'] == [read(run / name / 'selection.json') for name in neural_names]
    assert hp['tfidf_candidates'] == [read(run / name / 'selection.json') for name in tfidf_names]
    best_lr_index = max(range(len(neural_names)), key=lambda i: selection_key(hp['neural_candidates'][i]))
    best_c_index = max(range(len(tfidf_names)), key=lambda i: selection_key(hp['tfidf_candidates'][i]))
    assert hp['learning_rate'] == p['learning_rates'][best_lr_index]
    assert hp['tfidf_config'] == p['tfidf_candidates'][best_c_index]
    expected_names = list(dict.fromkeys([tfidf_name({'features': 'word', 'C': 1}), tfidf_name(hp['tfidf_config']), 'pretrained'] +
        [model_name(hp['learning_rate'], seed) for seed in [p['screen_seed']] + p['confirmation_seeds']]))
    assert expected_names == lock['models']
    for name in expected_names:
        assert lock['selections'][name] == read(run / name / 'selection.json')
    start, complete = read(run / 'evaluation-start.json'), read(run / 'evaluation-complete.json')
    assert start['selection_lock_sha256'] == complete['selection_lock_sha256'] == dataset_hash(run / 'selection-lock.json')
    assert complete['comparison_sha256'] == dataset_hash(run / 'comparison.json')
    assert datetime.fromisoformat(manifest['started_utc']) < datetime.fromisoformat(hp['utc']) < datetime.fromisoformat(lock['utc']) < datetime.fromisoformat(start['utc']) < datetime.fromisoformat(complete['utc'])
    comparison = read(run / 'comparison.json')
    assert len(comparison) == len(expected_names)*3*2
    checked = 0
    for name in expected_names:
        for dataset, key in [('domain-test', 'test'), ('deepset', 'deepset'), ('notinject', 'notinject')]:
            rows = read(run / name / f'{dataset}.json')['examples']
            assert len(rows) == len(datasets[key])
            for row, original in zip(rows, datasets[key]):
                assert all(row[k] == v for k, v in original.items())
                assert row['model'] == name and row['revision'] == lock['selections'][name]['revision']
                assert not row.get('error') and math.isfinite(row['score']) and 0 <= row['score'] <= 1
            for policy, suffix, threshold in [('validation-selected', '', lock['selections'][name]['threshold']), ('fixed-0.5', '-fixed', .5)]:
                stored = read(run / name / f'{dataset}{suffix}.json')
                replay = report(rows, threshold, split=dataset, threshold_policy=policy)
                assert stored == replay, 'Prediction/slice/curve mismatch: ' + name + '/' + dataset + suffix
                actual = metrics(rows, threshold)
                if key == 'notinject':
                    actual['f1'] = None
                summary = [r for r in comparison if r['model'] == name and r['dataset'] == dataset and r['threshold_policy'] == policy]
                assert len(summary) == 1
                for metric, value in actual.items():
                    check_equal(stored[metric], value)
                    check_equal(summary[0][metric], value)
                assert len(stored['examples']) == len(rows)
                for raw, result in zip(rows, stored['examples']):
                    assert raw['id'] == result['id'] and raw['score'] == result['score']
                    assert result['prediction'] == int(raw['score'] >= threshold)
                checked += 1
    if (run / 'aggregate.json').exists():
        aggregate = read(run / 'aggregate.json')
        neural = [n for n in expected_names if n.startswith('deberta')]
        from family_bootstrap import bootstrap
        baselines = [n for n in expected_names if n.startswith('tfidf')]
        assert aggregate['paired_family_bootstrap'] == [record for policy in ('validation-selected', 'fixed-0.5')
                                                       for record in bootstrap(run, baselines, neural, policy)]
        assert len(aggregate['seed_aggregates']) == 6
        for record in aggregate['seed_aggregates']:
            assert record['seeds'] == [p['screen_seed']] + p['confirmation_seeds']
            for metric in ('f1', 'recall', 'falsePositiveRate', 'precision'):
                values = [r[metric] for r in comparison if r['model'] in neural and
                          r['dataset'] == record['dataset'] and r['threshold_policy'] == record['threshold_policy']]
                assert len(values) == 3
                if any(v is None for v in values):
                    assert record[metric] is None
                else:
                    for key, value in {'mean': statistics.mean(values), 'min': min(values),
                                       'max': max(values), 'sample_sd': statistics.stdev(values)}.items():
                        check_equal(record[metric][key], value)
    if (run / 'SHA256SUMS.json').exists():
        for name, sha in read(run / 'SHA256SUMS.json').items():
            assert dataset_hash(run / name) == sha, name
    return {'verified': True, 'model_configurations': len(expected_names), 'metric_tables': checked,
            'selection_candidates': len(neural_names)+len(tfidf_names), 'test_families': len({r['group'] for r in datasets['test']}),
            'note': 'Recomputes published metrics and selection decisions from saved evidence; does not rerun training or prove unseen test data.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--run', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.source, args.run), indent=2))
