"""Validate the local Listen journal across a two-hour synthetic call and hard exits.

Usage:
    python scripts/validate_long_call_durability.py --db work/long-call.db \
        [--report work/long-call-report.json]

The fixture contains synthetic transcript text only. Each injected crash happens
after an uncommitted sentinel row is written, so reopening the database exercises
SQLite recovery rather than a caught application exception.
"""

from __future__ import annotations

import argparse
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from scripts.export_call_replay import build_replay


MIGRATIONS = ROOT / "src-tauri/src/db/migrations"
SCRIPT = Path(__file__).resolve()
SESSION_ID = "synthetic-two-hour-call"
SESSION_STARTED_AT = 1_800_000_000_000
DURATION_MS = 120 * 60 * 1000
TURN_INTERVAL_MS = 5_000
TURN_DURATION_MS = 1_500
TURN_COUNT = DURATION_MS // TURN_INTERVAL_MS
CRASH_EXIT_CODE = 91
OVERLAP_TURNS = 10


def _turn(index: int) -> tuple[str, str, str, int, int, int, str]:
    source = "system" if index % 2 == 0 else "mic"
    sequence = index // 2 + 1
    started_at = SESSION_STARTED_AT + index * TURN_INTERVAL_MS
    ended_at = started_at + TURN_DURATION_MS
    text = f"Synthetic {source} turn {sequence} at second {index * 5}"
    return (
        f"{SESSION_ID}:{source}:{sequence}",
        SESSION_ID,
        source,
        sequence,
        started_at,
        ended_at,
        text,
    )


def _initialize_database(path: Path) -> str:
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite existing database: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as db:
        journal_mode = db.execute("PRAGMA journal_mode=WAL").fetchone()[0]
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA foreign_keys=ON")
        for filename in ("call-sessions.sql", "call-timing.sql"):
            db.executescript((MIGRATIONS / filename).read_text(encoding="utf-8"))
        db.execute(
            "INSERT INTO call_sessions(id, started_at) VALUES (?, ?)",
            (SESSION_ID, SESSION_STARTED_AT),
        )
        db.commit()
    return journal_mode


def _worker(path: Path, start: int, end: int, crash_sentinel: str | None) -> None:
    with closing(sqlite3.connect(path)) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA synchronous=FULL")
        for index in range(start, end):
            db.execute(
                "INSERT OR IGNORE INTO call_utterances "
                "(id, session_id, source, sequence, started_at, ended_at, text) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                _turn(index),
            )
            db.commit()

        if crash_sentinel is not None:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "INSERT INTO call_utterances "
                "(id, session_id, source, sequence, started_at, ended_at, text) "
                "VALUES (?, ?, 'system', ?, ?, ?, ?)",
                (
                    crash_sentinel,
                    SESSION_ID,
                    1_000_000 + end,
                    SESSION_STARTED_AT + end * TURN_INTERVAL_MS,
                    SESSION_STARTED_AT + end * TURN_INTERVAL_MS + 1,
                    "UNCOMMITTED CRASH SENTINEL",
                ),
            )
            os._exit(CRASH_EXIT_CODE)


def _run_worker(
    path: Path,
    start: int,
    end: int,
    crash_sentinel: str | None = None,
) -> int:
    command = [
        sys.executable,
        str(SCRIPT),
        "--worker",
        str(path),
        str(start),
        str(end),
    ]
    if crash_sentinel is not None:
        command.append(crash_sentinel)
    result = subprocess.run(
        command,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    expected = CRASH_EXIT_CODE if crash_sentinel is not None else 0
    if result.returncode != expected:
        raise RuntimeError(
            f"Writer exited {result.returncode}; expected {expected}. "
            f"stdout={result.stdout!r} stderr={result.stderr!r}"
        )
    return result.returncode


def _assert_recovered_prefix(path: Path, expected_count: int, sentinel: str) -> None:
    with closing(sqlite3.connect(path)) as db:
        count = db.execute(
            "SELECT COUNT(*) FROM call_utterances WHERE session_id = ?",
            (SESSION_ID,),
        ).fetchone()[0]
        ghost_count = db.execute(
            "SELECT COUNT(*) FROM call_utterances WHERE id = ?", (sentinel,)
        ).fetchone()[0]
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    if count != expected_count:
        raise AssertionError(f"Recovered {count} turns; expected {expected_count}")
    if ghost_count != 0:
        raise AssertionError(f"Uncommitted sentinel survived crash: {sentinel}")
    if integrity != "ok":
        raise AssertionError(f"SQLite integrity check failed after crash: {integrity}")


def run_validation(path: Path) -> dict[str, object]:
    """Create and validate a deterministic two-hour crash/restart fixture."""
    path = path.resolve()
    started = time.perf_counter()
    journal_mode = _initialize_database(path)

    first_end = TURN_COUNT // 3
    second_end = 2 * TURN_COUNT // 3
    crash_codes = [
        _run_worker(path, 0, first_end, "uncommitted-crash-a"),
    ]
    _assert_recovered_prefix(path, first_end, "uncommitted-crash-a")

    crash_codes.append(
        _run_worker(
            path,
            first_end - OVERLAP_TURNS,
            second_end,
            "uncommitted-crash-b",
        )
    )
    _assert_recovered_prefix(path, second_end, "uncommitted-crash-b")

    _run_worker(path, second_end - OVERLAP_TURNS, TURN_COUNT)

    expected_rows = [_turn(index) for index in range(TURN_COUNT)]
    with closing(sqlite3.connect(path)) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute(
            "UPDATE call_sessions SET ended_at = ? WHERE id = ?",
            (SESSION_STARTED_AT + DURATION_MS, SESSION_ID),
        )
        db.commit()
        rows = db.execute(
            "SELECT id, session_id, source, sequence, started_at, ended_at, text "
            "FROM call_utterances WHERE session_id = ? "
            "ORDER BY started_at, ended_at, source, sequence",
            (SESSION_ID,),
        ).fetchall()
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
        foreign_key_violations = db.execute("PRAGMA foreign_key_check").fetchall()
        distinct_ids = db.execute(
            "SELECT COUNT(DISTINCT id) FROM call_utterances WHERE session_id = ?",
            (SESSION_ID,),
        ).fetchone()[0]
        distinct_source_sequences = db.execute(
            "SELECT COUNT(*) FROM (SELECT source, sequence FROM call_utterances "
            "WHERE session_id = ? GROUP BY source, sequence)",
            (SESSION_ID,),
        ).fetchone()[0]
        source_counts = dict(
            db.execute(
                "SELECT source, COUNT(*) FROM call_utterances "
                "WHERE session_id = ? GROUP BY source ORDER BY source",
                (SESSION_ID,),
            ).fetchall()
        )

    if rows != expected_rows:
        raise AssertionError("Recovered journal does not exactly match the two-hour input")
    if distinct_ids != TURN_COUNT or distinct_source_sequences != TURN_COUNT:
        raise AssertionError("Restart overlap introduced a duplicate journal identity")
    if integrity != "ok" or foreign_key_violations:
        raise AssertionError(
            f"Database validation failed: integrity={integrity}, "
            f"foreign_keys={foreign_key_violations}"
        )

    replay = build_replay(path, SESSION_ID)
    exported = replay["sessions"][0]
    exported_ids = [turn["id"] for turn in exported["turns"]]
    expected_ids = [row[0] for row in expected_rows]
    if exported_ids != expected_ids:
        raise AssertionError("Replay export changed or omitted recovered journal ordering")
    if any(turn["usefulSuggestion"] is not None for turn in exported["turns"]):
        raise AssertionError("Synthetic replay unexpectedly contains usefulness labels")

    return {
        "database": str(path),
        "sessionId": SESSION_ID,
        "durationMs": DURATION_MS,
        "durationMinutes": DURATION_MS // 60_000,
        "turnIntervalMs": TURN_INTERVAL_MS,
        "expectedTurns": TURN_COUNT,
        "persistedTurns": len(rows),
        "exportedTurns": len(exported["turns"]),
        "sourceCounts": source_counts,
        "restartOverlapTurns": OVERLAP_TURNS,
        "injectedCrashExitCodes": crash_codes,
        "uncommittedSentinelsPresentAfterRecovery": 0,
        "journalMode": journal_mode,
        "integrity": integrity,
        "foreignKeyViolations": len(foreign_key_violations),
        "elapsedSeconds": round(time.perf_counter() - started, 3),
    }


def _main() -> int:
    if len(sys.argv) >= 2 and sys.argv[1] == "--worker":
        if len(sys.argv) not in (5, 6):
            raise SystemExit("worker usage: --worker DB START END [CRASH_SENTINEL]")
        _worker(
            Path(sys.argv[2]),
            int(sys.argv[3]),
            int(sys.argv[4]),
            sys.argv[5] if len(sys.argv) == 6 else None,
        )
        return 0

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    if args.report is not None and args.report.resolve() == args.db.resolve():
        parser.error("database and report paths must be different")
    if args.report is not None and args.report.exists():
        parser.error(f"refusing to overwrite existing report: {args.report}")
    report = run_validation(args.db)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.report is not None:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
