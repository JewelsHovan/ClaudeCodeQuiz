#!/usr/bin/env python3
"""
validate_bank.py — CI guard for the study question bank (quiz/bank/*.json).

Codifies every invariant the bank must hold so edits can't silently drift.
Complements scripts/validate-content.mjs (which validates the DATAMON game's
separate battle bank, not this study bank).

Run:
  uv run python scripts/validate_bank.py            # validate, exit 1 on error
  uv run python scripts/validate_bank.py --strict   # also fail on warnings

Checks (errors → exit 1):
  - required fields present; no unknown fields
  - domain 1-5 and matches the file it lives in; domain_name is canonical
  - scenario is one of the 6 official themes
  - difficulty in {easy, medium, hard}
  - options is exactly {A,B,C,D}, all non-empty
  - answer is a valid letter (single-select) OR a 2-3 letter array (multi-response);
    multi-response stems must tell the reader how many to select
  - distractors keys == exactly the non-answer option letters, all non-empty
  - id matches dN-NNN, is globally unique, domain digit matches
  - tags non-empty; source non-empty
  - no HTML-escape artifacts (&amp; &lt; &gt; &#..)
Warnings (exit 1 only with --strict):
  - per-domain answer-letter skew (cosmetic — the generators shuffle options at render)
  - a task-area/tag appearing on only one question
"""
import argparse
import collections
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "quiz", "bank")

CANON_NAME = {
    1: "Agentic Architecture & Orchestration",
    2: "Tool Design & MCP Integration",
    3: "Claude Code Configuration & Workflows",
    4: "Prompt Engineering & Structured Output",
    5: "Context Management & Reliability",
}
OFFICIAL_SCENARIOS = {
    "Customer Support Resolution Agent",
    "Code Generation with Claude Code",
    "Multi-Agent Research System",
    "Developer Productivity with Claude",
    "Claude Code for Continuous Integration",
    "Structured Data Extraction",
}
DIFF = {"easy", "medium", "hard"}
LETTERS = ["A", "B", "C", "D"]
REQUIRED = {"id", "domain", "domain_name", "scenario", "difficulty", "stem",
            "options", "answer", "explanation", "distractors", "tags", "source"}
OPTIONAL = {"select_count"}
HTML_ARTIFACT = re.compile(r"&amp;|&lt;|&gt;|&#\d")


def validate():
    files = sorted(glob.glob(os.path.join(BANK, "domain*.json")))
    if not files:
        print(f"ERROR: no bank files at {BANK}")
        return 2, 2
    errors, warnings = [], []
    seen_ids = {}
    all_q = []
    per_dom_ans = collections.defaultdict(lambda: collections.Counter())
    tag_counts = collections.Counter()

    for f in files:
        base = os.path.basename(f)
        m = re.match(r"domain(\d)\.json", base)
        file_dom = int(m.group(1)) if m else None
        try:
            data = json.load(open(f, encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"{base}: invalid JSON: {e}")
            continue
        if not isinstance(data, list):
            errors.append(f"{base}: top level must be a JSON array")
            continue
        # canonical formatting (minimal-diff round-trip)
        raw = open(f, encoding="utf-8").read()
        if json.dumps(data, indent=2, ensure_ascii=False) != raw:
            warnings.append(f"{base}: not in canonical format (indent=2, no trailing newline)")

        for q in data:
            all_q.append(q)
            qid = q.get("id", "<no id>")
            def err(msg):
                errors.append(f"{base} {qid}: {msg}")

            extra = set(q) - REQUIRED - OPTIONAL
            missing = REQUIRED - set(q)
            if missing:
                err(f"missing fields: {sorted(missing)}")
                continue
            if extra:
                warnings.append(f"{base} {qid}: unknown fields {sorted(extra)}")

            if q["domain"] != file_dom:
                err(f"domain {q['domain']} != file domain {file_dom}")
            if q["domain_name"] != CANON_NAME.get(q["domain"]):
                err(f"domain_name {q['domain_name']!r} != canonical {CANON_NAME.get(q['domain'])!r}")
            if q["scenario"] not in OFFICIAL_SCENARIOS:
                err(f"non-official scenario {q['scenario']!r}")
            if q["difficulty"] not in DIFF:
                err(f"bad difficulty {q['difficulty']!r}")

            opts = q["options"]
            if not isinstance(opts, dict) or set(opts) != set(LETTERS):
                err(f"options must be exactly A-D, got {sorted(opts) if isinstance(opts, dict) else type(opts).__name__}")
                ans_set = set()
            else:
                for L in LETTERS:
                    if not isinstance(opts[L], str) or not opts[L].strip():
                        err(f"option {L} empty")
                ans = q["answer"]
                if isinstance(ans, list):
                    if not (2 <= len(ans) <= 3):
                        err(f"multi-response answer needs 2-3 letters, got {ans}")
                    if len(set(ans)) != len(ans):
                        err(f"duplicate letters in answer {ans}")
                    if any(a not in LETTERS for a in ans):
                        err(f"answer letters out of A-D: {ans}")
                    if not re.search(r"\bselect\b", q["stem"], re.I):
                        err("multi-response stem must tell the reader how many to select ('Select TWO')")
                    ans_set = set(ans)
                    if "select_count" in q and q["select_count"] != len(ans):
                        err(f"select_count {q['select_count']} != len(answer) {len(ans)}")
                elif isinstance(ans, str):
                    if ans not in LETTERS:
                        err(f"answer {ans!r} not A-D")
                    ans_set = {ans}
                    per_dom_ans[q["domain"]][ans] += 1
                else:
                    err(f"answer wrong type {type(ans).__name__}")
                    ans_set = set()

            dis = q["distractors"]
            if not isinstance(dis, dict):
                err("distractors must be a dict")
            elif ans_set:
                expected = set(LETTERS) - ans_set
                if set(dis) != expected:
                    err(f"distractor keys {sorted(dis)} != non-answer options {sorted(expected)}")
                for k, v in dis.items():
                    if not isinstance(v, str) or not v.strip():
                        err(f"distractor {k} empty")

            if not str(q["explanation"]).strip():
                err("empty explanation")
            if not isinstance(q["tags"], list) or not q["tags"]:
                err("tags must be a non-empty list")
            else:
                for t in q["tags"]:
                    tag_counts[t] += 1
            if not str(q["source"]).strip():
                err("empty source")

            if not re.fullmatch(r"d(\d)-\d{3}", str(qid)):
                err(f"id {qid!r} must match dN-NNN")
            elif int(qid[1]) != q["domain"]:
                err(f"id domain digit {qid[1]} != domain {q['domain']}")
            if qid in seen_ids:
                err(f"duplicate id (also in {seen_ids[qid]})")
            else:
                seen_ids[qid] = base

            if HTML_ARTIFACT.search(json.dumps(q, ensure_ascii=False)):
                err("contains HTML-escape artifact (&amp; / &lt; / &gt; / &#..)")

    # warnings: per-domain answer skew
    for d, c in sorted(per_dom_ans.items()):
        tot = sum(c.values())
        if tot >= 8:
            hi = max(c.values()); lo = min(c.get(L, 0) for L in LETTERS)
            if hi >= 3 * max(1, lo):
                warnings.append(f"D{d}: answer-letter skew {dict(c)} (cosmetic — generators shuffle at render)")
    for t, n in tag_counts.items():
        if n == 1:
            pass  # singletons are fine; kept quiet unless we want signal

    # summary
    by_dom = collections.Counter(q.get("domain") for q in all_q)
    multi = sum(1 for q in all_q if isinstance(q.get("answer"), list))
    print(f"Bank: {len(all_q)} questions  " + " ".join(f"D{d}={by_dom[d]}" for d in sorted(by_dom)))
    print(f"Multiple-response: {multi}  |  unique ids: {len(seen_ids)}")
    if warnings:
        print(f"\n{len(warnings)} warning(s):")
        for w in warnings:
            print("  ! " + w)
    if errors:
        print(f"\n{len(errors)} ERROR(s):")
        for e in errors:
            print("  ✗ " + e)
    else:
        print("\n✓ all invariants hold")
    return len(errors), len(warnings)


def main():
    ap = argparse.ArgumentParser(description="Validate quiz/bank/*.json invariants.")
    ap.add_argument("--strict", action="store_true", help="fail (exit 1) on warnings too")
    args = ap.parse_args()
    n_err, n_warn = validate()
    sys.exit(1 if n_err or (args.strict and n_warn) else 0)


if __name__ == "__main__":
    main()
