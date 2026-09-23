import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from report_call_latency import percentile, report


class LatencyReportTests(unittest.TestCase):
    def test_percentile_and_status_report(self):
        self.assertEqual(percentile([100, 300, 200], 0.50), 200)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "veil.db"
            with closing(sqlite3.connect(path)) as db:
                db.executescript((Path(__file__).resolve().parents[1] /
                    "src-tauri/src/db/migrations/call-sessions.sql").read_text())
                db.executescript((Path(__file__).resolve().parents[1] /
                    "src-tauri/src/db/migrations/call-timing.sql").read_text())
                db.execute("INSERT INTO call_sessions(id,started_at) VALUES (?,?)", ("s", 1))
                db.execute(
                    "INSERT INTO call_turn_timings(turn_id,session_id,source,audio_ready_at,audio_to_stt_ms,status) "
                    "VALUES (?,?,?,?,?,?)", ("u", "s", "mic", 1, 200, "transcribed")
                )
                db.commit()
            output = report(path)
            self.assertIn("mic: 1 turns", output)
            self.assertIn("p50=200 ms", output)
            self.assertIn("First chunk may be incomplete", output)


if __name__ == "__main__":
    unittest.main()
