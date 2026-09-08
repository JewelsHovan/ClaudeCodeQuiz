#!/usr/bin/env python3
"""
Quality audit for the question bank.

`validate_bank.py` checks invariants — schema, unique ids, valid answers.
This checks whether the questions actually *behave* like exam questions, which is
a different problem. The headline metric is length bias.

Why length bias matters
-----------------------
LLM-authored questions tend to explain the reasoning inside the correct option
("...because X, so do Y") while leaving distractors terse. The key then becomes
visually identifiable and a candidate can score well above chance without reading
the stem. That inflates practice scores and trains pattern-matching instead of the
judgment the exam actually tests.

The fix is length parity: every option gets the same treatment, and the reasoning
lives in `explanation` / `distractors`, never inside the option text.

Usage:
  uv run python scripts/audit_bank.py            # report
  uv run python scripts/audit_bank.py --strict   # exit 1 if thresholds are breached
  uv run python scripts/audit_bank.py --worst 20 # list the worst offenders
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import statistics as st
import sys
from collections import Counter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK_GLOB = os.path.join(REPO_ROOT, "quiz", "bank", "*.json")

# A key that is longest by chance happens ~25% of the time with four options.
# Allow headroom for genuinely longer correct answers, but not much.
MAX_LONGEST_KEY_RATE = 0.35
MAX_MEAN_LENGTH_DELTA = 15      # chars the key may exceed the mean distractor by
MIN_DISTRACTOR_CHARS = 45       # below this, a distractor reads as filler
SCENARIOS = [
    "Customer Support Resolution Agent",
    "Code Generation with Claude Code",
    "Multi-Agent Research System",
    "Developer Productivity with Claude",
    "Claude Code for Continuous Integration",
    "Structured Data Extraction",
]


def load_bank() -> list[dict]:
    qs: list[dict] = []
    for f in sorted(glob.glob(BANK_GLOB)):
        for q in json.load(open(f, encoding="utf-8")):
            q["_file"] = os.path.basename(f)
            qs.append(q)
    if not qs:
        sys.exit(f"No questions found at {BANK_GLOB}")
    return qs


def keys_of(q: dict) -> list[str]:
    a = q["answer"]
    return a if isinstance(a, list) else [a]


def length_stats(q: dict) -> tuple[float, float, bool]:
    """(mean key length, mean distractor length, key is the single longest option)."""
    ks = keys_of(q)
    kl = [len(q["options"][k]) for k in ks]
    dl = [len(v) for k, v in q["options"].items() if k not in ks]
    longest = bool(dl) and max(kl) > max(dl)
    return st.mean(kl), (st.mean(dl) if dl else 0.0), longest


def main() -> None:
    ap = argparse.ArgumentParser(description="Quality audit for the question bank.")
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 when a threshold is breached (for CI)")
    ap.add_argument("--worst", type=int, default=0,
                    help="list the N worst length-bias offenders")
    args = ap.parse_args()

    bank = load_bank()
    n = len(bank)
    problems: list[str] = []

    print(f"Bank: {n} questions  ·  {sum(1 for q in bank if isinstance(q['answer'], list))} multiple-response")
    print(f"Difficulty: {dict(Counter(q.get('difficulty') for q in bank))}\n")

    # --- length bias ---------------------------------------------------------
    deltas, longest_flags, offenders = [], [], []
    for q in bank:
        kmean, dmean, longest = length_stats(q)
        deltas.append(kmean - dmean)
        longest_flags.append(longest)
        if longest:
            offenders.append((kmean - dmean, q["id"], q["_file"]))

    rate = sum(longest_flags) / n
    mean_delta = st.mean(deltas)

    print("LENGTH BIAS  — can a candidate spot the key without reading the stem?")
    print(f"  key is the longest option : {sum(longest_flags):>4} / {n}  ({rate:.0%})   target <={MAX_LONGEST_KEY_RATE:.0%}, chance 25%")
    print(f"  key longer than distractors by : {mean_delta:>+5.0f} chars (mean)      target <=+{MAX_MEAN_LENGTH_DELTA}")
    print(f"  → always-pick-longest scores {rate:.0%} on this bank\n")
    if rate > MAX_LONGEST_KEY_RATE:
        problems.append(f"length bias: key is longest in {rate:.0%} of questions (target <={MAX_LONGEST_KEY_RATE:.0%})")
    if mean_delta > MAX_MEAN_LENGTH_DELTA:
        problems.append(f"length bias: key averages {mean_delta:+.0f} chars vs distractors (target <=+{MAX_MEAN_LENGTH_DELTA})")

    if args.worst:
        print(f"Worst {args.worst} offenders (key length minus mean distractor):")
        for d, qid, f in sorted(offenders, reverse=True)[:args.worst]:
            print(f"  {d:>+5.0f}  {qid}  ({f})")
        print()

    # --- filler distractors --------------------------------------------------
    short = [(q["id"], k) for q in bank for k, v in q["options"].items()
             if k not in keys_of(q) and len(v) < MIN_DISTRACTOR_CHARS]
    print(f"FILLER DISTRACTORS  — under {MIN_DISTRACTOR_CHARS} chars: {len(short)}")
    if short:
        print("  " + ", ".join(f"{i}:{k}" for i, k in short[:12]) + (" …" if len(short) > 12 else ""))
        problems.append(f"{len(short)} distractors under {MIN_DISTRACTOR_CHARS} chars read as filler")
    print()

    # --- rationale coverage --------------------------------------------------
    missing = [q["id"] for q in bank
               if len(q.get("distractors", {})) < len(q["options"]) - len(keys_of(q))]
    print(f"DISTRACTOR RATIONALES  — questions missing one: {len(missing)}")
    if missing:
        print("  " + ", ".join(missing[:12]) + (" …" if len(missing) > 12 else ""))
        problems.append(f"{len(missing)} questions missing a distractor rationale")
    print()

    # --- scenario balance ----------------------------------------------------
    counts = Counter(q.get("scenario") for q in bank)
    parity = n / len(SCENARIOS)
    print(f"SCENARIO BALANCE  — themes are drawn 4-of-6, so parity is ~{parity:.0f} each")
    for s in SCENARIOS:
        c = counts.get(s, 0)
        d = c - parity
        flag = "  ⚠️" if abs(d) > parity * 0.5 else ""
        print(f"  {c:>4}  ({d:>+5.0f})  {s}{flag}")
    thin = [s for s in SCENARIOS if counts.get(s, 0) < parity * 0.5]
    if thin:
        problems.append(f"scenario coverage under half parity: {', '.join(thin)}")
    print()

    # --- verdict -------------------------------------------------------------
    if problems:
        print("ISSUES")
        for p in problems:
            print(f"  ! {p}")
        if args.strict:
            sys.exit(1)
    else:
        print("✓ no quality thresholds breached")


if __name__ == "__main__":
    main()
