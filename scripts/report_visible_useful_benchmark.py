"""Summarize an explicitly labeled question inventory and observed useful cards.

The manifest must contain every planned question, including missed or unobserved
ones. Useful timestamps must be independently reviewed window observations, not
provider token timestamps. This script checks the supplied data's consistency;
it cannot prove physical visibility, independent labels, or answer correctness.
"""
import argparse
import json
from pathlib import Path

try:
    from scripts.report_call_latency import percentile
except ModuleNotFoundError:
    from report_call_latency import percentile


MIN_GOAL_SAMPLE = 20
MIN_PRD_SAMPLE = 200
OUTCOMES = {"useful", "not_useful", "missed", "unobserved"}


def analyze(data: dict) -> dict:
    questions = data.get("questions")
    observations = data.get("observations")
    if not isinstance(questions, list) or not questions or not isinstance(observations, list):
        raise ValueError("A nonempty question inventory and an observation list are required")
    inventory = {}
    for question in questions:
        if not isinstance(question, dict):
            raise ValueError("Invalid question")
        qid = question.get("id")
        ended = question.get("questionEndedAt")
        if (not isinstance(qid, str) or not qid.strip() or qid in inventory or
            not isinstance(question.get("category"), str) or not question["category"].strip() or
            question.get("difficulty") not in {"ordinary", "hard"} or
            type(ended) is not int or ended < 0):
            raise ValueError("Question IDs must be unique and include category, difficulty and end time")
        inventory[qid] = question
    by_id = {}
    for observation in observations:
        if not isinstance(observation, dict):
            raise ValueError("Invalid observation")
        qid = observation.get("questionId")
        if qid not in inventory or qid in by_id or observation.get("outcome") not in OUTCOMES:
            raise ValueError("Every observation must identify a unique inventoried question and outcome")
        visible = observation.get("firstUsefulVisibleAt")
        if observation["outcome"] == "useful":
            if (type(visible) is not int or visible < inventory[qid]["questionEndedAt"] or
                observation.get("visibilityEvidence") != "window_observation"):
                raise ValueError("Useful answers need a valid observed useful-text timestamp")
        elif visible is not None:
            raise ValueError("Only useful answers may have a useful-text timestamp")
        by_id[qid] = observation
    if set(by_id) != set(inventory):
        raise ValueError("Every inventoried question needs an observation, including misses")

    ordinary = [q for q in questions if q["difficulty"] == "ordinary"]
    latencies = [by_id[q["id"]]["firstUsefulVisibleAt"] - q["questionEndedAt"]
                 for q in ordinary if by_id[q["id"]]["outcome"] == "useful"]
    outcomes = {outcome: sum(by_id[q["id"]]["outcome"] == outcome for q in ordinary)
                for outcome in sorted(OUTCOMES)}
    p50 = percentile(latencies, 0.50) if latencies else None
    p95 = percentile(latencies, 0.95) if latencies else None
    complete = len(ordinary) > 0 and outcomes["useful"] == len(ordinary)
    goal_eligible = len(ordinary) >= MIN_GOAL_SAMPLE
    prd_eligible = len(ordinary) >= MIN_PRD_SAMPLE
    return {
        "ordinaryQuestions": len(ordinary), "hardQuestions": len(questions) - len(ordinary),
        "ordinaryOutcomes": outcomes, "usefulVisibleP50Ms": p50, "usefulVisibleP95Ms": p95,
        "goalSampleEligible": goal_eligible,
        "passesUserTarget": bool(goal_eligible and complete and p50 <= 2000 and p95 <= 4000),
        "prdSampleEligible": prd_eligible,
        "passesPrdTarget": bool(prd_eligible and complete and p50 <= 1500 and p95 <= 3000),
        "limitations": "Window observations and usefulness labels require independent review; missed and unobserved questions prevent a pass. Real-call verification is separate.",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", type=Path)
    args = parser.parse_args()
    print(json.dumps(analyze(json.loads(args.review.read_text(encoding="utf-8"))), indent=2))
