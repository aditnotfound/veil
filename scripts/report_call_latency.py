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
    ("question_to_first_chunk_ms", "Question end to first chunk"),
    ("question_to_answer_total_ms", "Question end to answer total"),
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
            "SELECT t.source, t.status, t.audio_ready_at, u.ended_at AS question_ended_at, "
            "t.audio_to_stt_ms, t.wait_before_answer_ms, t.answer_to_first_chunk_ms, "
            "t.audio_to_first_chunk_ms, t.answer_total_ms "
            "FROM call_turn_timings t LEFT JOIN call_utterances u ON u.id = t.turn_id "
            "AND u.session_id = t.session_id"
        ).fetchall()

    lines = [f"Turns: {len(rows)}"]
    for source in ("system", "mic"):
        source_rows = []
        for row in rows:
            if row["source"] != source:
                continue
            enriched = dict(row)
            if row["question_ended_at"] is not None:
                question_to_answer_start = max(
                    0.0,
                    float(row["audio_ready_at"] - row["question_ended_at"]),
                ) + float(row["audio_to_stt_ms"] or 0) + float(row["wait_before_answer_ms"] or 0)
                if row["answer_to_first_chunk_ms"] is not None:
                    enriched["question_to_first_chunk_ms"] = (
                        question_to_answer_start + float(row["answer_to_first_chunk_ms"])
                    )
                if row["answer_total_ms"] is not None:
                    enriched["question_to_answer_total_ms"] = (
                        question_to_answer_start + float(row["answer_total_ms"])
                    )
            enriched.setdefault("question_to_first_chunk_ms", None)
            enriched.setdefault("question_to_answer_total_ms", None)
            source_rows.append(enriched)
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
    lines.append(
        "\nQuestion-end metrics use the finalized utterance end time and saved stage timings. "
        "First chunk may be incomplete; neither metric proves a useful card appeared."
    )
    return "\n".join(lines)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    args = parser.parse_args()
    print(report(args.db))
