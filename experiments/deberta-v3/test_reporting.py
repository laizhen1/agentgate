from pathlib import Path
import unittest
from unittest.mock import patch
from family_bootstrap import bootstrap


class BootstrapTests(unittest.TestCase):
    def fixture(self, perfect):
        rows = [{'id': f'{group}-{label}', 'group': group, 'label': label,
                 'prediction': label if perfect else 1-label}
                for group in ('a', 'b', 'c') for label in (0, 1)]
        return {'examples': rows}

    def test_identical_models_have_zero_paired_difference(self):
        with patch('family_bootstrap.read', return_value=self.fixture(True)):
            result = bootstrap(Path('fixture'), ['baseline'], ['seed1', 'seed2', 'seed3'], 'validation-selected', repeats=100)
            self.assertEqual(len(result), 4)
            for record in result:
                self.assertEqual(record['delta_f1'], 0)
                self.assertEqual(record['ci95'], [0, 0])
                self.assertEqual(record['clusters'], 3)

    def test_perfect_and_fully_wrong_models_preserve_direction(self):
        with patch('family_bootstrap.read', side_effect=lambda path: self.fixture(path.parent.name != 'baseline')):
            result = bootstrap(Path('fixture'), ['baseline'], ['seed1', 'seed2', 'seed3'], 'validation-selected', repeats=100)
            for record in result:
                self.assertEqual(record['delta_f1'], 1)
                self.assertEqual(record['ci95'], [1, 1])


if __name__ == '__main__':
    unittest.main()
