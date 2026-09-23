import tempfile
import unittest
from pathlib import Path

from scripts.benchmark_local_retrieval import (
    assert_gates,
    build_match_queries,
    create_database,
    run_benchmark,
    search,
)


class RetrievalBenchmarkTests(unittest.TestCase):
    def test_benchmark_uses_production_query_builder_and_exact_query_plan(self):
        [match] = build_match_queries(["What is the heliotrope launch freeze time?"])
        self.assertIn('"heliotrope"*', match)
        with tempfile.TemporaryDirectory() as directory:
            db, _ = create_database(Path(directory) / "test.db", 100)
            try:
                self.assertEqual(search(db, match, 1), ["target-heliotrope"])
            finally:
                db.close()

    def test_small_report_is_labeled_and_passes_lexical_gate(self):
        report = run_benchmark([100], repeats=2)
        result = report["scales"][0]
        self.assertEqual(result["integrity"], "ok")
        self.assertEqual(result["lexical"]["recall_at_7"], 1.0)
        self.assertIn("synthetic", report["corpus"])
        self.assertIn("paraphrase_only", result)
        assert_gates(report)


if __name__ == "__main__":
    unittest.main()
