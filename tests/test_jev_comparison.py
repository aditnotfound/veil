import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from scripts.compare_jev_shadow import compare


MIGRATIONS = Path(__file__).resolve().parents[1] / "src-tauri/src/db/migrations"


class JevComparisonTests(unittest.TestCase):
    def test_same_turn_comparison_counts_false_suggestions_and_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "veil.db"
            with closing(sqlite3.connect(path)) as db:
                for filename in ("call-sessions.sql", "call-timing.sql", "call-decisions.sql", "call-delete.sql", "call-jev-shadow.sql"):
                    db.executescript((MIGRATIONS / filename).read_text())
                db.execute("INSERT INTO call_sessions(id,started_at) VALUES ('call',1)")
                turns = [
                    ("q", "call", "system", 1, 1000, 2000, "What changed?"),
                    ("n", "call", "system", 2, 3000, 4000, "We will review later"),
                    ("m", "call", "mic", 1, 5000, 6000, "Okay thanks"),
                ]
                db.executemany("INSERT INTO call_utterances VALUES (?,?,?,?,?,?,?)", turns)
                db.executemany("INSERT INTO call_turn_decisions VALUES (?,?,?,?,?,?,?)", [
                    ("q", "call", 2000, "deterministic-v1", "after_pause", "short_answer", "explicit_question"),
                    ("n", "call", 4000, "deterministic-v1", "after_pause", "silence", "not_a_request"),
                    ("m", "call", 6000, "deterministic-v1", "after_pause", "silence", "mic_source"),
                ])
                db.executemany("INSERT INTO call_jev_shadow VALUES (?,?,?,?,?,?,?,?,?)", [
                    ("q", "call", 2100, "typesafe/jev-1.13", "after_pause", "valid", "silence", 0.8, 100.0),
                    ("n", "call", 4100, "typesafe/jev-1.13", "after_pause", "valid", "short_answer", 0.9, 200.0),
                ])
                db.commit()
            labeled = {"sessions": [{
                "id": "call", "negativeDurationMs": 900000,
                "turns": [
                    {"id": "q", "sessionId": "call", "source": "system", "text": "What changed?", "usefulSuggestion": True},
                    {"id": "n", "sessionId": "call", "source": "system", "text": "We will review later", "usefulSuggestion": False},
                    {"id": "m", "sessionId": "call", "source": "mic", "text": "Okay thanks", "usefulSuggestion": False},
                ],
            }]}
            report = compare(path, labeled)
            self.assertEqual(report["shadowValidCoverage"], 1)
            self.assertEqual(report["deterministic"]["truePositive"], 1)
            self.assertEqual(report["jevWithDeterministicFallback"]["falseNegative"], 1)
            self.assertEqual(report["jevWithDeterministicFallback"]["falsePositive"], 1)
            self.assertEqual(report["jevWithDeterministicFallback"]["falseSuggestionsPerNegativeHour"], 4)
            self.assertEqual(report["validJevLatencyMs"]["p95"], 195)
            labeled["sessions"][0]["turns"][0]["text"] = "changed transcript"
            with self.assertRaises(ValueError):
                compare(path, labeled)


if __name__ == "__main__":
    unittest.main()
