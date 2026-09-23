"""Report independently graded deep-answer quality and full-draft latency.

Usage: python scripts/report_deep_answer_quality.py LABELED_REVIEW.json
This report does not invent a launch threshold; it exposes the observed counts,
rates, and sample size required for a later product decision.
"""

import argparse
import json
from pathlib import Path

try:
    from scripts.report_call_latency import percentile
except ModuleNotFoundError:
    from report_call_latency import percentile


CORRECTNESS = {"correct", "partially_correct", "incorrect", "not_gradable"}
PROOF = {"adequate", "incomplete", "not_applicable"}


def analyze(review: dict) -> dict:
    if review.get("rubricVersion") != "deep-answer-v1":
        raise ValueError("Unsupported or missing deep-answer rubric version")
    if not isinstance(review.get("graderId"), str) or not review["graderId"].strip():
        raise ValueError("A nonempty independent graderId is required")
    sessions = review.get("sessions")
    if not isinstance(sessions, list):
        raise ValueError("Missing sessions array")

    counts = {label: 0 for label in CORRECTNESS}
    proof_counts = {label: 0 for label in PROOF}
    total = 0
    out_of_scope = 0
    improper_claims = 0
    latencies = []
    for session in sessions:
        if not isinstance(session, dict) or not session.get("id") or not isinstance(session.get("answers"), list):
            raise ValueError("Malformed deep-answer review session")
        for answer in session["answers"]:
            if not isinstance(answer, dict) or not isinstance(answer.get("inScopeHardQuestion"), bool):
                raise ValueError("Every answer needs an inScopeHardQuestion label")
            if not answer["inScopeHardQuestion"]:
                out_of_scope += 1
                continue
            correctness = answer.get("correctness")
            proof = answer.get("proofAdequacy")
            improper = answer.get("improperVerificationClaim")
            if correctness not in CORRECTNESS or proof not in PROOF or not isinstance(improper, bool):
                raise ValueError("Every in-scope answer needs correctness, proof, and verification-claim labels")
            question_end = answer.get("questionEndedAt")
            completed = answer.get("deepCompletedAt")
            if not isinstance(question_end, int) or not isinstance(completed, int) or completed < question_end:
                raise ValueError("Deep-answer timing is missing or invalid")
            total += 1
            counts[correctness] += 1
            proof_counts[proof] += 1
            improper_claims += int(improper)
            latencies.append(completed - question_end)

    return {
        "graderId": review["graderId"].strip(),
        "sessions": len(sessions),
        "inScopeAnswers": total,
        "outOfScopeAnswers": out_of_scope,
        "correctness": counts,
        "proofAdequacy": proof_counts,
        "correctRate": counts["correct"] / total if total else None,
        "adequateProofRate": proof_counts["adequate"] / total if total else None,
        "improperVerificationClaims": improper_claims,
        "fullDraftP50Ms": percentile(latencies, 0.50) if latencies else None,
        "fullDraftP95Ms": percentile(latencies, 0.95) if latencies else None,
    }


def format_report(result: dict) -> str:
    latency = "unavailable"
    if result["fullDraftP50Ms"] is not None:
        latency = f"p50={result['fullDraftP50Ms']:.0f} ms, p95={result['fullDraftP95Ms']:.0f} ms"
    return "\n".join([
        f"Independent grader: {result['graderId']}",
        f"In-scope hard answers: {result['inScopeAnswers']}",
        f"Out of scope: {result['outOfScopeAnswers']}",
        "Correctness: " + ", ".join(f"{key}={value}" for key, value in sorted(result["correctness"].items())),
        "Proof adequacy: " + ", ".join(f"{key}={value}" for key, value in sorted(result["proofAdequacy"].items())),
        f"Improper checked/proven/final claims: {result['improperVerificationClaims']}",
        f"Question end to full deep draft: {latency}",
        "No launch threshold is encoded; interpret these results with the reported sample size.",
    ])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("review", type=Path)
    args = parser.parse_args()
    data = json.loads(args.review.read_text(encoding="utf-8"))
    print(format_report(analyze(data)))
