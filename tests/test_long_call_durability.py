import tempfile
import unittest
from pathlib import Path

from scripts.validate_long_call_durability import (
    CRASH_EXIT_CODE,
    DURATION_MS,
    TURN_COUNT,
    run_validation,
)


class LongCallDurabilityTests(unittest.TestCase):
    def test_two_hour_journal_survives_hard_exits_and_overlap_replay(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "two-hour.db"
            report = run_validation(path)
            with self.assertRaises(FileExistsError):
                run_validation(path)

        self.assertEqual(report["durationMs"], DURATION_MS)
        self.assertEqual(report["durationMinutes"], 120)
        self.assertEqual(report["persistedTurns"], TURN_COUNT)
        self.assertEqual(report["exportedTurns"], TURN_COUNT)
        self.assertEqual(report["sourceCounts"], {"mic": 720, "system": 720})
        self.assertEqual(
            report["injectedCrashExitCodes"],
            [CRASH_EXIT_CODE, CRASH_EXIT_CODE],
        )
        self.assertEqual(report["uncommittedSentinelsPresentAfterRecovery"], 0)
        self.assertEqual(report["integrity"], "ok")
        self.assertEqual(report["foreignKeyViolations"], 0)


if __name__ == "__main__":
    unittest.main()
