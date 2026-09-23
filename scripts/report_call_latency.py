"""Report local post-VAD call latency without reading transcript text.

Usage: py scripts/report_call_latency.py --db PATH_TO_veil.db
The first-chunk metric is not the PRD's first-useful-card metric.
"""

import argparse
from contextlib import closing
import math
import sqlite3
from pathlib import Path


METRICS = (
    ("audio_to_stt_ms", "Audio ready to final STT"),
    ("wait_before_answer_ms", "Final STT to answer start"),
    ("answer_to_first_chunk_ms", "Answer start to first chunk"),
    ("audio_to_first_chunk_ms", "Audio ready to first chunk"),
    ("answer_total_ms", "Answer total"),
)


def percentile(values: list[float], percentile_value: float) -> float:
    values = sorted(values)
    if not values:
        raise ValueError("Cannot compute a percentile without values")
    index = (len(values) - 1) * percentile_value
    lower = math.floor(index)
    upper = math.ceil(index)
    return values[lower] + (values[upper] - values[lower]) * (index - lower)


def report(db_path: Path) -> str:
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            "SELECT source, status, audio_to_stt_ms, wait_before_answer_ms, "
            "answer_to_first_chunk_ms, audio_to_first_chunk_ms, answer_total_ms "
            "FROM call_turn_timings"
        ).fetchall()

    lines = [f"Turns: {len(rows)}"]
    for source in ("system", "mic"):
        source_rows = [row for row in rows if row["source"] == source]
        if not source_rows:
            continue
        lines.append(f"\n{source}: {len(source_rows)} turns")
        statuses = sorted({row["status"] for row in source_rows})
        lines.append("  Status: " + ", ".join(
            f"{status}={sum(row['status'] == status for row in source_rows)}"
            for status in statuses
        ))
        for key, label in METRICS:
            values = [float(row[key]) for row in source_rows if row[key] is not None]
            if values:
                lines.append(
                    f"  {label}: n={len(values)}, "
                    f"p50={percentile(values, 0.50):.0f} ms, "
                    f"p95={percentile(values, 0.95):.0f} ms"
                )
    lines.append("\nTiming starts when batch audio is ready after VAD. First chunk may be incomplete; neither metric proves a useful card appeared.")
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    args = parser.parse_args()
    print(report(args.db))
