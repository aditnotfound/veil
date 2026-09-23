"""Compare saved JEV shadow choices with the deterministic router on labeled turns.

Usage: python scripts/compare_jev_shadow.py --db PATH_TO_veil.db --labels LABELED_REPLAY.json
The report contains aggregate counts, not transcript text. It does not judge answer quality.
"""

import argparse
from collections import Counter
from contextlib import closing
import json
import math
from pathlib import Path
import sqlite3


def confusion() -> dict[str, int]:
    return {"truePositive": 0, "falsePositive": 0, "falseNegative": 0, "trueNegative": 0}


def count_choice(counts: dict[str, int], action: str, useful: bool) -> None:
    suggested = action != "silence"
    key = (
        "truePositive" if useful else "falsePositive"
    ) if suggested else (
        "falseNegative" if useful else "trueNegative"
    )
    counts[key] += 1


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    position = (len(values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def compare(db_path: Path, labeled_replay: dict) -> dict:
    if not db_path.is_file():
        raise FileNotFoundError(db_path)
    sessions = labeled_replay.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        raise ValueError("Labeled replay needs sessions")
    baseline = confusion()
    candidate = confusion()
    statuses = Counter()
    valid_latency = []
    eligible = 0
    total_turns = 0
    negative_ms = 0
    seen = set()
    seen_sessions = set()
    with closing(sqlite3.connect(f"{db_path.resolve().as_uri()}?mode=ro", uri=True)) as db:
        db.row_factory = sqlite3.Row
        for session in sessions:
            session_id = session.get("id")
            duration = session.get("negativeDurationMs")
            turns = session.get("turns")
            if (not isinstance(session_id, str) or not session_id or session_id in seen_sessions or
                not isinstance(duration, (int, float)) or isinstance(duration, bool) or
                not math.isfinite(duration) or duration < 0 or not isinstance(turns, list)):
                raise ValueError("Every replay session needs an ID, labeled negative duration, and turns")
            seen_sessions.add(session_id)
            negative_ms += duration
            for turn in turns:
                if not isinstance(turn, dict):
                    raise ValueError("Every replay turn needs a unique ID and independent usefulness label")
                turn_id = turn.get("id")
                if (not isinstance(turn_id, str) or not turn_id or
                    turn.get("sessionId") != session_id or
                    not isinstance(turn.get("usefulSuggestion"), bool) or
                    (session_id, turn_id) in seen):
                    raise ValueError("Every replay turn needs a unique ID and independent usefulness label")
                seen.add((session_id, turn_id))
                row = db.execute(
                    "SELECT u.text, u.source, d.mode, d.action AS baseline_action, d.reason, "
                    "j.status, j.choice, j.latency_ms "
                    "FROM call_utterances u "
                    "JOIN call_turn_decisions d ON d.turn_id = u.id "
                    "LEFT JOIN call_jev_shadow j ON j.turn_id = u.id "
                    "WHERE u.id = ? AND u.session_id = ?",
                    (turn_id, session_id),
                ).fetchone()
                if row is None or row["text"] != turn.get("text") or row["source"] != turn.get("source"):
                    raise ValueError(f"Replay turn {turn_id} does not match saved transcript and decision")
                total_turns += 1
                original = row["baseline_action"]
                chosen = row["choice"] if row["status"] == "valid" else original
                count_choice(baseline, original, turn["usefulSuggestion"])
                count_choice(candidate, chosen, turn["usefulSuggestion"])
                if row["source"] == "system" and row["mode"] != "off" and row["reason"] != "superseded":
                    eligible += 1
                    status = row["status"] or "missing"
                    statuses[status] += 1
                    if status == "valid" and row["latency_ms"] is not None:
                        valid_latency.append(float(row["latency_ms"]))

    negative_hours = negative_ms / 3_600_000
    def summarize(counts: dict[str, int]) -> dict:
        suggested = counts["truePositive"] + counts["falsePositive"]
        useful = counts["truePositive"] + counts["falseNegative"]
        return {
            **counts,
            "precision": counts["truePositive"] / suggested if suggested else None,
            "recall": counts["truePositive"] / useful if useful else None,
            "falseSuggestionsPerNegativeHour": counts["falsePositive"] / negative_hours if negative_hours else None,
        }
    return {
        "sessions": len(sessions),
        "turns": total_turns,
        "negativeHours": negative_hours,
        "eligibleSystemTurns": eligible,
        "shadowValidCoverage": statuses["valid"] / eligible if eligible else None,
        "shadowStatuses": dict(sorted(statuses.items())),
        "validJevLatencyMs": {
            "n": len(valid_latency), "p50": percentile(valid_latency, 0.50),
            "p95": percentile(valid_latency, 0.95),
        },
        "deterministic": summarize(baseline),
        "jevWithDeterministicFallback": summarize(candidate),
        "note": "Decision comparison only. Missing/failed JEV calls use the recorded deterministic action; low shadow coverage can hide differences. No answer-usefulness or end-to-end latency claim follows.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--labels", required=True, type=Path)
    args = parser.parse_args()
    data = json.loads(args.labels.read_text(encoding="utf-8"))
    print(json.dumps(compare(args.db, data), indent=2))
