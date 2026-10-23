"""Build v3 once, before fitting. Deterministic family split; no test-score feedback."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil
import unicodedata
from analysis import dataset_hash, read_dataset, validate_splits

ROOT = Path(__file__).resolve().parent


def normalized(text):
    return ' '.join(unicodedata.normalize('NFKC', text).casefold().split())


def shingles(text):
    text = normalized(text)
    return {text[i:i+5] for i in range(max(1, len(text)-4))}


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def build(source, destination):
    destination.mkdir(parents=True, exist_ok=False)
    families = json.loads((ROOT / 'families.json').read_text(encoding='utf-8'))
    assert len(families) == 240 and len({f['id'] for f in families}) == 240
    assert set(Counter(f['category'] for f in families).values()) == {30}
    splits = {'train': [], 'validation': [], 'test': []}
    # Keep only the original unwrapped pair from each old TRAIN family.
    # The old validation and test are never repurposed for fitting/selection.
    original = read_dataset(source / 'data/train.jsonl', strict=True)
    splits['train'] = [row for row in original if row['variant'] == 0]
    assert len(splits['train']) == 72
    for category in sorted({f['category'] for f in families}):
        ordered = sorted((f for f in families if f['category'] == category),
                         key=lambda f: hashlib.sha256(('agentgate-v3-20261024:'+f['id']).encode()).hexdigest())
        for index, family in enumerate(ordered):
            split = 'train' if index < 18 else 'validation' if index < 24 else 'test'
            for label, field in [(0, 'safe'), (1, 'attack')]:
                text = family[field]
                splits[split].append({'id': family['id']+f'-{label}', 'text': text, 'label': label,
                    'group': family['id'], 'category': category,
                    'language': 'mixed' if re.search(r'[^\x00-\x7f]', text) else 'en-or-mixed-latin',
                    'source': 'AgentGate original AI-authored contrast pairs, 2026-10-24',
                    'license': 'Original generated project material; no third-party source text',
                    'synthetic': True, 'annotation': family['annotation']})
    validate_splits(splits)
    for name, rows in splits.items():
        assert len(rows) == (360 if name == 'train' else 96)
        rows.sort(key=lambda r: r['id'])
        (destination / f'{name}.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in rows), encoding='utf-8')
    references = {}
    for name in ('deepset', 'notinject'):
        shutil.copyfile(source / 'data' / f'{name}.jsonl', destination / f'{name}.jsonl')
        references[name] = read_dataset(destination / f'{name}.jsonl', strict=True)
    references['legacy-validation'] = read_dataset(source / 'data/validation.jsonl', strict=True)
    references['legacy-test'] = read_dataset(source / 'data/test.jsonl', strict=True)
    # Existing external sets are diagnostic-only. New text must not duplicate them
    # or any old holdout; character shingles are a lexical guard, not a semantic proof.
    audit = {'method': 'NFKC/casefold/whitespace exact; character-5-gram Jaccard >= 0.65',
             'limitation': 'Does not certify semantic independence, human labels, or novelty to upstream pretraining.',
             'cross_split_matches': [], 'maxima': {}}
    encoded = {name: [(r, normalized(r['text']), shingles(r['text'])) for r in rows]
               for name, rows in {**splits, **references}.items()}
    comparisons = [('train','validation'), ('train','test'), ('validation','test')]
    comparisons += [(split, ref) for split in splits for ref in references]
    for left, right in comparisons:
        closest = {'jaccard': 0.0}
        for a, an, ash in encoded[left]:
            for b, bn, bsh in encoded[right]:
                similarity = len(ash & bsh) / len(ash | bsh)
                if similarity > closest['jaccard']:
                    closest = {'jaccard': similarity, 'left_id': a['id'], 'right_id': b['id']}
                if an == bn or similarity >= .65:
                    audit['cross_split_matches'].append({'left': left, 'right': right, 'left_id': a['id'], 'right_id': b['id'], 'jaccard': similarity})
        audit['maxima'][left+'__'+right] = closest
    dump(destination / 'overlap-audit.json', audit)
    if audit['cross_split_matches']:
        raise ValueError('Resolve cross-split lexical duplicates before freezing data; see overlap-audit.json')
    datasets = {**splits, **{k: references[k] for k in ('deepset', 'notinject')}}
    manifest = {'families_sha256': dataset_hash(ROOT / 'families.json'),
                'builder_sha256': dataset_hash(ROOT / 'prepare_data.py'),
                'old_manifest_sha256': dataset_hash(source / 'data/manifest.json'),
                'overlap_audit_sha256': dataset_hash(destination / 'overlap-audit.json'),
                'split_method': 'Category-stratified SHA256 ordering, fixed salt agentgate-v3-20261024; 18/6/6 new families per category. Add 36 original training pairs without wrappers.',
                'datasets': {name: {'sha256': dataset_hash(destination / f'{name}.jsonl'), 'rows': len(rows),
                    'classes': dict(Counter(r['label'] for r in rows)), 'groups': len({r['group'] for r in rows}),
                    'categories': dict(Counter(r['category'] for r in rows))} for name, rows in datasets.items()},
                'exclusions': {'old_train_wrappers_removed': 216, 'old_validation_and_test_not_reused': 192},
                'annotation': 'All new labels are AI-authored, not independently human-reviewed. Shared author and attack concepts remain limitations.'}
    dump(destination / 'manifest.json', manifest)
    print(json.dumps({k: {'rows': v['rows'], 'families': v['groups']} for k, v in manifest['datasets'].items()}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, default=ROOT / 'data')
    args = parser.parse_args()
    build(args.source, args.destination)
