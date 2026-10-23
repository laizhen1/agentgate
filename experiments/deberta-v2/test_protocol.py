import unittest
from run_experiment import select, selection_key
from analysis import validate_splits


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


if __name__ == '__main__':
    unittest.main()
