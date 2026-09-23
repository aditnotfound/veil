#!/usr/bin/env python3
"""Benchmark Veil's actual local FTS5 knowledge query at useful library sizes.

The corpus is deterministic and synthetic. Each labeled target has one query
with a rare lexical anchor and one paraphrase-only query. The first group
measures the path Veil implements today; the second makes the known semantic
recall limit visible rather than treating a fast lexical benchmark as proof of
general retrieval quality.
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sqlite3
import subprocess
import tempfile
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "src-tauri/src/db/migrations"
DEFAULT_SCALES = (100, 1_000, 10_000)
TOP_KS = (1, 3, 7)


@dataclass(frozen=True)
class RetrievalCase:
    target_id: str
    content: str
    lexical_query: str
    paraphrase_query: str


CASES = (
    RetrievalCase("target-heliotrope", "Project heliotrope launch freeze is Tuesday at 16:00 UTC.", "heliotrope launch freeze time", "When must code changes stop?"),
    RetrievalCase("target-oriole", "Oriole calibration tolerance is 0.35 millimeters.", "oriole calibration tolerance", "What deviation from the reference is allowed?"),
    RetrievalCase("target-juniper", "Juniper records are retained for 45 days.", "juniper retention days", "How long before archived material is erased?"),
    RetrievalCase("target-saffron", "Saffron invoice ceiling is 18,500 USD.", "saffron invoice ceiling", "What is the largest bill we may approve?"),
    RetrievalCase("target-kestrel", "Kestrel backups are stored in ap-south-1.", "kestrel backup region", "Which geography holds the disaster copies?"),
    RetrievalCase("target-marigold", "Marigold approval owner is Nisha Rao.", "marigold approval owner", "Who signs off on that initiative?"),
    RetrievalCase("target-cobalt", "Cobalt sensor sampling is configured at 128 hertz.", "cobalt sensor sampling", "How frequently does the instrument take readings?"),
    RetrievalCase("target-elmwood", "Elmwood renewal date is November 17, 2027.", "elmwood renewal date", "When does the subscription roll over?"),
    RetrievalCase("target-zephyr", "Zephyr incident classification is severity two.", "zephyr incident severity", "How serious was the outage rated?"),
    RetrievalCase("target-topaz", "Topaz shipments arrive at dock seven.", "topaz shipment dock", "Which loading bay receives the delivery?"),
    RetrievalCase("target-quasar", "Quasar experiment uses random seed 481516.", "quasar experiment seed", "Which reproducibility number initializes the trial?"),
    RetrievalCase("target-willow", "Willow maintenance interval is 600 operating hours.", "willow maintenance interval", "After how much runtime should servicing occur?"),
)


@dataclass
class SuiteResult:
    recall_at_1: float
    recall_at_3: float
    recall_at_7: float
    first_pass_p95_ms: float
    steady_p50_ms: float
    steady_p95_ms: float
    query_count: int


def percentile(values: list[float], quantile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * quantile) - 1)]


def build_match_queries(texts: Iterable[str]) -> list[str]:
    """Use the production TypeScript tokenizer instead of duplicating it."""
    code = (
        'import {readFileSync} from "node:fs"; '
        'import {buildFtsQuery} from "./src/lib/call/local-search.ts"; '
        'const values=JSON.parse(readFileSync(0,"utf8")); '
        'process.stdout.write(JSON.stringify(values.map((value) => buildFtsQuery(value))));'
    )
    completed = subprocess.run(
        ["node", "--input-type=module", "-e", code],
        cwd=ROOT,
        input=json.dumps(list(texts)),
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(completed.stdout)


def create_database(path: Path, chunk_count: int) -> tuple[sqlite3.Connection, float]:
    if chunk_count < len(CASES):
        raise ValueError(f"chunk_count must be at least {len(CASES)}")
    db = sqlite3.connect(path)
    try:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript((MIGRATIONS / "knowledge.sql").read_text(encoding="utf-8"))
        db.executescript((MIGRATIONS / "call-sessions.sql").read_text(encoding="utf-8"))
        db.executescript((MIGRATIONS / "local-search.sql").read_text(encoding="utf-8"))
    except Exception:
        db.close()
        raise

    started = time.perf_counter()
    source_count = max(1, math.ceil(chunk_count / 50))
    db.executemany(
        "INSERT INTO knowledge_sources(id,title,kind,tags,raw_text,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
        ((f"source-{index:04d}", f"Synthetic source {index}", "note", "[]", "", 1, 1) for index in range(source_count)),
    )
    rows = []
    for index, case in enumerate(CASES):
        rows.append((case.target_id, f"source-{index // 50:04d}", index, case.content, "[]", 1))

    vocabulary = (
        "agenda budget customer design engineering forecast inventory legal "
        "meeting operations planning policy product project quarterly report "
        "research review roadmap schedule security service status support team"
    ).split()
    randomizer = random.Random(20260924)
    for index in range(len(CASES), chunk_count):
        words = randomizer.sample(vocabulary, 9)
        content = f"Synthetic record {index}: {' '.join(words)} reference {index:05d}."
        rows.append((f"noise-{index:05d}", f"source-{index // 50:04d}", index % 50, content, "[]", 1))
    with db:
        db.executemany(
            "INSERT INTO knowledge_chunks(id,source_id,chunk_index,content,embedding,created_at) VALUES (?,?,?,?,?,?)",
            rows,
        )
    return db, (time.perf_counter() - started) * 1000


def search(db: sqlite3.Connection, match: str, limit: int = 7) -> list[str]:
    rows = [
        row[0]
        for row in db.execute(
            """SELECT c.id
               FROM knowledge_chunks_fts
               JOIN knowledge_chunks c ON c.rowid = knowledge_chunks_fts.rowid
               JOIN knowledge_sources s ON s.id = c.source_id
               WHERE knowledge_chunks_fts MATCH ?
               ORDER BY bm25(knowledge_chunks_fts)
               LIMIT 40""",
            (match,),
        )
    ]
    return rows[:limit]


def run_suite(
    db: sqlite3.Connection,
    matches: list[str],
    repeats: int,
) -> SuiteResult:
    first_latencies: list[float] = []
    repeated_latencies: list[float] = []
    results: list[list[str]] = []
    for match in matches:
        started = time.perf_counter()
        found = search(db, match, max(TOP_KS)) if match else []
        first_latencies.append((time.perf_counter() - started) * 1000)
        results.append(found)
    for _ in range(repeats):
        for match in matches:
            started = time.perf_counter()
            if match:
                search(db, match, max(TOP_KS))
            repeated_latencies.append((time.perf_counter() - started) * 1000)

    recalls = {
        top_k: sum(case.target_id in found[:top_k] for case, found in zip(CASES, results)) / len(CASES)
        for top_k in TOP_KS
    }
    return SuiteResult(
        recall_at_1=recalls[1],
        recall_at_3=recalls[3],
        recall_at_7=recalls[7],
        first_pass_p95_ms=percentile(first_latencies, 0.95),
        steady_p50_ms=percentile(repeated_latencies, 0.50),
        steady_p95_ms=percentile(repeated_latencies, 0.95),
        query_count=len(first_latencies) + len(repeated_latencies),
    )


def benchmark_scale(chunk_count: int, repeats: int) -> dict:
    lexical_matches = build_match_queries(case.lexical_query for case in CASES)
    paraphrase_matches = build_match_queries(case.paraphrase_query for case in CASES)
    with tempfile.TemporaryDirectory(prefix="veil-retrieval-") as directory:
        path = Path(directory) / "benchmark.db"
        db, build_ms = create_database(path, chunk_count)
        try:
            integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
            lexical = run_suite(db, lexical_matches, repeats)
            paraphrase = run_suite(db, paraphrase_matches, repeats)
            size_bytes = path.stat().st_size
        finally:
            db.close()
    return {
        "chunks": chunk_count,
        "database_bytes": size_bytes,
        "index_build_ms": round(build_ms, 3),
        "integrity": integrity,
        "lexical": {key: round(value, 4) if isinstance(value, float) else value for key, value in asdict(lexical).items()},
        "paraphrase_only": {key: round(value, 4) if isinstance(value, float) else value for key, value in asdict(paraphrase).items()},
    }


def run_benchmark(scales: Iterable[int], repeats: int) -> dict:
    return {
        "benchmark": "veil-local-fts5-v1",
        "corpus": "deterministic synthetic; 12 labeled targets plus distractors",
        "latency_scope": "SQLite query execution only; first pass and warmed repeated queries reported separately",
        "limitations": [
            "Lexical anchors are controlled and do not represent real user documents.",
            "Paraphrase-only recall is diagnostic; dense retrieval and mixed ranking are outside this benchmark.",
            "No knowledge focus-tag filter is active in the benchmark.",
            "Results describe this machine and SQLite build, not all packaged target devices.",
        ],
        "scales": [benchmark_scale(scale, repeats) for scale in scales],
    }


def assert_gates(report: dict) -> None:
    failures = []
    for result in report["scales"]:
        if result["integrity"] != "ok":
            failures.append(f"{result['chunks']} chunks: integrity={result['integrity']}")
        if result["lexical"]["recall_at_7"] < 0.95:
            failures.append(f"{result['chunks']} chunks: lexical recall@7 below 0.95")
        if result["chunks"] == 10_000 and result["lexical"]["first_pass_p95_ms"] > 100:
            failures.append("10,000 chunks: first-pass lexical p95 exceeds 100 ms")
    if failures:
        raise SystemExit("Benchmark gate failed:\n- " + "\n- ".join(failures))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scales", nargs="+", type=int, default=list(DEFAULT_SCALES))
    parser.add_argument("--repeats", type=int, default=30)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--assert-gates", action="store_true")
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    report = run_benchmark(args.scales, args.repeats)
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    print(rendered)
    if args.assert_gates:
        assert_gates(report)


if __name__ == "__main__":
    main()
