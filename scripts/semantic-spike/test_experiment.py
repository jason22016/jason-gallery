"""Targeted checks of ranking/evaluation math; no model downloads or GPU needed."""
import unittest
import numpy as np
from experiment import normalize, ranked, quality


class RetrievalMathTests(unittest.TestCase):
    def test_cosine_ignores_magnitude(self):
        vectors = normalize([[3, 4], [0, 2], [-3, -4]])
        query = normalize([[6, 8]])[0]
        np.testing.assert_allclose(vectors @ query, [1, .8, -1], atol=1e-6)
        np.testing.assert_array_equal(ranked(vectors @ query), [0, 1, 2])

    def test_rejects_invalid_vectors(self):
        for value in ([[0, 0]], [[np.nan, 1]], [[np.inf, 1]]):
            with self.assertRaises(ValueError):
                normalize(value)

    def test_stable_ties(self):
        np.testing.assert_array_equal(ranked(np.array([.1, .5, .5])), [1, 2, 0])

    def test_known_relevance_and_sparse_positive_denominators(self):
        result = quality([1, 0, 2], ['cat', 'dog', 'bird'], ['cat'])
        self.assertEqual(result['hit1'], 0)
        self.assertEqual(result['mrr'], .5)
        self.assertAlmostEqual(result['ndcg5'], 1 / np.log2(3))
        self.assertEqual(result['recall5'], 1)
        self.assertAlmostEqual(result['precision5'], 1/3)

    def test_absence_is_not_counted_as_a_positive_failure(self):
        self.assertIsNone(quality([0, 1], ['cat', 'dog'], []))

    def test_perfect_multi_positive_ndcg(self):
        result = quality([2, 0, 1], ['cat', 'dog', 'bird'], ['cat', 'bird'])
        self.assertEqual(result['ndcg5'], 1)


if __name__ == '__main__':
    unittest.main()
