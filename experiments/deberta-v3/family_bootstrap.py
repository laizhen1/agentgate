"""Paired cluster bootstrap; standard-library implementation for offline CI replay."""
import random
import statistics
from analysis import percentile
from run_experiment import read


def bootstrap(run, baselines, neural, policy, repeats=5000, seed=20261024):
    suffix = '' if policy == 'validation-selected' else '-fixed'
    names = baselines + neural
    rows = {name: read(run / name / f'domain-test{suffix}.json')['examples'] for name in names}
    groups = sorted({r['group'] for r in rows[names[0]]})
    counts = {name: {group: [0, 0, 0] for group in groups} for name in names}
    for name in names:
        for row in rows[name]:
            if row['label'] and row['prediction']:
                counts[name][row['group']][0] += 1
            elif row['prediction']:
                counts[name][row['group']][1] += 1
            elif row['label']:
                counts[name][row['group']][2] += 1

    def f1(name, sample):
        tp, fp, fn = (sum(counts[name][g][i] for g in sample) for i in range(3))
        return 2*tp/(2*tp+fp+fn) if 2*tp+fp+fn else 0.0

    models = neural + ['selected-deberta-three-seed-mean']
    values = {(b, n): [] for b in baselines for n in models}
    rng = random.Random(seed)
    for _ in range(repeats):
        sample = [groups[rng.randrange(len(groups))] for _ in groups]
        scores = {name: f1(name, sample) for name in names}
        scores[models[-1]] = statistics.mean(scores[n] for n in neural)
        for b, n in values:
            values[b, n].append(scores[n] - scores[b])
    actual = {name: f1(name, groups) for name in names}
    actual[models[-1]] = statistics.mean(actual[n] for n in neural)
    return [{'baseline': b, 'model': n, 'threshold_policy': policy,
             'delta_f1': actual[n]-actual[b], 'ci95': [percentile(v, .025), percentile(v, .975)],
             'clusters': len(groups), 'resamples': repeats, 'rng': 'Python random.Random', 'seed': seed}
            for (b, n), v in values.items()]
