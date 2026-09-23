"""Report question-end-to-first-useful-card latency from a labeled card review.

Usage: python scripts/report_useful_card_latency.py LABELED_REVIEW.json
The PRD gate is eligible only with at least 200 reviewed ordinary-question cards
and no reviewed question lacking a useful checkpoint.
"""

import argparse
import json
from pathlib import Path

try:
    from scripts.report_call_latency import percentile
except ModuleNotFoundError:  # Direct execution from the scripts directory.
    from report_call_latency import percentile


MIN_REVIEWED = 200
P50_GATE_MS = 1500
P95_GATE_MS = 3000


def analyze(review: dict) -> dict:
    sessions = review.get("sessions")
    if not isinstance(sessions, list):
        raise ValueError("Missing sessions array")
    latencies = []
    no_useful_card = 0
    reviewed = 0
    for session in sessions:
        if not isinstance(session, dict) or not session.get("id") or not isinstance(session.get("cards"), list):
            raise ValueError("Malformed review session")
        for card in session["cards"]:
            if not isinstance(card, dict) or not isinstance(card.get("cardUseful"), bool):
                raise ValueError("Every card needs a boolean cardUseful label")
            reviewed += 1
            index = card.get("firstUsefulCheckpoint")
            checkpoints = card.get("checkpoints")
            question_end = card.get("questionEndedAt")
            if not isinstance(checkpoints, list) or not isinstance(question_end, int):
                raise ValueError("Card timing data is missing")
            if not card["cardUseful"]:
                if index is not None:
                    raise ValueError("An unusable card cannot have a first useful checkpoint")
                no_useful_card += 1
                continue
            if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < len(checkpoints):
                raise ValueError("A useful card needs a valid first useful checkpoint")
            at = checkpoints[index].get("at") if isinstance(checkpoints[index], dict) else None
            if not isinstance(at, int) or at < question_end:
                raise ValueError("Useful checkpoint precedes the detected question end")
            latencies.append(at - question_end)

    p50 = percentile(latencies, 0.50) if latencies else None
    p95 = percentile(latencies, 0.95) if latencies else None
    eligible = reviewed >= MIN_REVIEWED
    passed = bool(
        eligible and no_useful_card == 0 and p50 is not None and p95 is not None and
        p50 <= P50_GATE_MS and p95 <= P95_GATE_MS
    )
    return {
        "sessions": len(sessions),
        "reviewedCards": reviewed,
        "usefulCards": len(latencies),
        "noUsefulCard": no_useful_card,
        "usefulRate": len(latencies) / reviewed if reviewed else None,
        "p50Ms": p50,
        "p95Ms": p95,
        "gateEligible": eligible,
        "passesPrdGate": passed,
    }


def format_report(result: dict) -> str:
    latency = "unavailable"
    if result["p50Ms"] is not None:
        latency = f"p50={result['p50Ms']:.0f} ms, p95={result['p95Ms']:.0f} ms"
    return "\n".join([
        f"Sessions: {result['sessions']}",
        f"Reviewed cards: {result['reviewedCards']}",
        f"Useful cards: {result['usefulCards']}",
        f"No useful checkpoint: {result['noUsefulCard']}",
        f"Question end to first useful checkpoint: {latency}",
        f"PRD sample gate eligible (>= {MIN_REVIEWED}): {str(result['gateEligible']).lower()}",
        f"Passes PRD latency gate: {str(result['passesPrdGate']).lower()}",
    ])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", type=Path)
    args = parser.parse_args()
    data = json.loads(args.review.read_text(encoding="utf-8"))
    print(format_report(analyze(data)))
