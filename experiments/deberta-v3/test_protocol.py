import unittest
from run_experiment import select, selection_key
from analysis import validate_splits, metrics, read_dataset, dataset_hash
from run_experiment import ROOT, read


class SelectionTests(unittest.TestCase):
    def rows(self, scores):
        return [{'label': label, 'score': score, 'durationMs': 0} for label, score in scores]

    def test_threshold_obeys_validation_constraint(self):
        chosen = select(self.rows([(0, .1), (0, .7), (1, .8), (1, .9)]), .05)
        self.assertEqual(chosen['metrics']['falsePositiveRate'], 0)
        self.assertEqual(chosen['metrics']['recall'], 1)
        self.assertEqual(chosen['threshold'], .8)

    def test_equal_f1_prefers_lower_logloss(self):
        a = select(self.rows([(0, .4), (1, .6)]), .05)
        b = select(self.rows([(0, .1), (1, .9)]), .05)
        self.assertEqual(a['metrics']['f1'], b['metrics']['f1'])
        self.assertGreater(selection_key(b), selection_key(a))

    def test_bad_validation_scores_do_not_silently_calibrate(self):
        with self.assertRaises(ValueError):
            select(self.rows([(0, 1), (1, 1)]), .05)

    def test_family_overlap_rejected(self):
        splits = {'train': [{'id': 'a', 'group': 'family', 'text': 'a', 'label': 0},
                            {'id': 'b', 'group': 'family', 'text': 'b', 'label': 1}],
                  'validation': [{'id': 'c', 'group': 'family', 'text': 'c', 'label': 0},
                                 {'id': 'd', 'group': 'family', 'text': 'd', 'label': 1}]}
        with self.assertRaises(ValueError):
            validate_splits(splits)

    def test_benign_diagnostic_f1_not_reported_as_attack_performance(self):
        result = metrics(self.rows([(0, .9), (0, .2)]), .5)
        self.assertIsNone(result['f1'])
        self.assertIsNone(result['recall'])
        self.assertEqual(result['falsePositiveRate'], .5)

    def test_frozen_data_and_new_holdout_families(self):
        manifest = read(ROOT / 'data/manifest.json')
        splits = {key: read_dataset(ROOT / 'data' / f'{key}.jsonl', strict=True) for key in ('train', 'validation', 'test')}
        validate_splits(splits)
        for key, rows in splits.items():
            self.assertEqual(dataset_hash(ROOT / 'data' / f'{key}.jsonl'), manifest['datasets'][key]['sha256'])
            self.assertEqual(len(rows), 360 if key == 'train' else 96)
            self.assertEqual(len({r['text'] for r in rows}), len(rows))
            self.assertEqual(len({r['group'] for r in rows}), 180 if key == 'train' else 48)
        self.assertTrue(all(r['group'].startswith('v3-') for k in ('validation', 'test') for r in splits[k]))
        self.assertFalse(read(ROOT / 'data/overlap-audit.json')['cross_split_matches'])


if __name__ == '__main__':
    unittest.main()
