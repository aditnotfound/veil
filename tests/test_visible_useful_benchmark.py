import unittest
from copy import deepcopy
from scripts.report_visible_useful_benchmark import analyze


def fixture():
    return {
        "questions": [{"id": f"q{i}", "category": "coding", "difficulty": "ordinary", "questionEndedAt": 1000} for i in range(20)] +
                     [{"id": "hard", "category": "math", "difficulty": "hard", "questionEndedAt": 1000}],
        "observations": [{"questionId": f"q{i}", "outcome": "useful", "firstUsefulVisibleAt": 2500,
                          "visibilityEvidence": "window_observation"} for i in range(20)] +
                        [{"questionId": "hard", "outcome": "missed"}],
    }


class VisibleUsefulBenchmarkTests(unittest.TestCase):
    def test_inventoried_visible_useful_answers_and_separate_hard_questions(self):
        result = analyze(fixture())
        self.assertEqual(result["ordinaryQuestions"], 20)
        self.assertEqual(result["hardQuestions"], 1)
        self.assertEqual(result["usefulVisibleP50Ms"], 1500)
        self.assertTrue(result["passesUserTarget"])
        self.assertFalse(result["prdSampleEligible"])

    def test_a_missed_or_unobserved_question_cannot_pass(self):
        for outcome in ("missed", "not_useful", "unobserved"):
            sample = fixture()
            sample["observations"][0] = {"questionId": "q0", "outcome": outcome}
            result = analyze(sample)
            self.assertEqual(result["ordinaryOutcomes"][outcome], 1)
            self.assertFalse(result["passesUserTarget"])

    def test_unknown_missing_duplicate_and_first_token_evidence_rejected(self):
        for mutate in (
            lambda d: d["observations"].pop(),
            lambda d: d["observations"].append(deepcopy(d["observations"][0])),
            lambda d: d["observations"][0].update(questionId="unknown"),
            lambda d: d["observations"][0].update(visibilityEvidence="provider_chunk"),
            lambda d: d["observations"][0].update(firstUsefulVisibleAt=999),
        ):
            sample = fixture()
            mutate(sample)
            with self.assertRaises(ValueError):
                analyze(sample)

    def test_goal_and_prd_targets_are_distinct(self):
        sample = fixture()
        for observation in sample["observations"][:-1]:
            observation["firstUsefulVisibleAt"] = 3000
        self.assertTrue(analyze(sample)["passesUserTarget"])
        self.assertFalse(analyze(sample)["passesPrdTarget"])
        sample["observations"][0]["firstUsefulVisibleAt"] = 6000
        sample["observations"][1]["firstUsefulVisibleAt"] = 6000
        self.assertFalse(analyze(sample)["passesUserTarget"])


if __name__ == "__main__":
    unittest.main()
