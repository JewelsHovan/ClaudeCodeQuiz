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

Three metrics, because the obvious two are gameable
---------------------------------------------------
  key-longest rate  — how often the key is the longest option (chance is 25%)
  mean delta        — how much longer the key runs than its distractors
  spread            — longest minus shortest option, per question

Spread is the one that resists gaming. You can pull the first two into range by
inflating a single distractor to match a bloated key, but that leaves two long
options and two short ones, and the key is still findable by elimination. Parity
means all four options sit close together, which only spread measures.

Usage:
  uv run python scripts/audit_bank.py                     # report
  uv run python scripts/audit_bank.py --strict            # exit 1 if thresholds are breached
  uv run python scripts/audit_bank.py --worst 20          # the offenders to fix first
  uv run python scripts/audit_bank.py --file domain3.json # one file, while editing it
  uv run python scripts/audit_bank.py --json              # machine-readable
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import re
import statistics as st
import sys
from collections import Counter

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK_GLOB = os.path.join(REPO_ROOT, "quiz", "bank", "*.json")
# The readable practice sets carry the same defect as the JSON bank and are studied
# just as often, so they get audited by the same yardstick. Their options are prose of
# comparable length, so the thresholds transfer directly (unlike the DATAMON battle
# bank, whose ~33-char choices need the ratio test in scripts/audit_datamon_bank.mjs).
MARKDOWN_SETS = ["quiz/practice-questions.md", "quiz/scenario-questions.md"]
MD_OPTION = re.compile(r"^([A-D])\)\s+(.*)$")
MD_ANSWER = re.compile(r"\*\*Answer:\s*([A-D])")

# A key that is longest by chance happens ~25% of the time with four options.
# Allow headroom for genuinely longer correct answers, but not much.
MAX_LONGEST_KEY_RATE = 0.35
MAX_MEAN_LENGTH_DELTA = 15      # chars the key may exceed the mean distractor by
MAX_MEAN_SPREAD = 45            # mean (longest - shortest) option, per question
MIN_DISTRACTOR_CHARS = 45       # below this, a distractor reads as filler
VISIBLE_MARGIN = 15             # chars by which "longest" becomes noticeable to a reader
MAX_OPTION_CHARS = 200          # above this, an option is arguing rather than stating
SCENARIOS = [
    "Customer Support Resolution Agent",
    "Code Generation with Claude Code",
    "Multi-Agent Research System",
    "Developer Productivity with Claude",
    "Claude Code for Continuous Integration",
    "Structured Data Extraction",
]


def load_bank(only: str | None = None) -> list[dict]:
    qs: list[dict] = []
    for f in sorted(glob.glob(BANK_GLOB)):
        if only and os.path.basename(f) != only:
            continue
        for q in json.load(open(f, encoding="utf-8")):
            q["_file"] = os.path.basename(f)
            qs.append(q)
    if not qs:
        sys.exit(f"No questions found at {BANK_GLOB}" + (f" for --file {only}" if only else ""))
    return qs


def load_markdown() -> list[dict]:
    """Parse the readable practice sets into the same shape as a bank question.

    They are prose, not data, so this is a deliberately narrow parser: four `A)`..`D)`
    lines followed by a `**Answer: X**`. Anything that does not match that shape is
    skipped rather than guessed at.
    """
    qs: list[dict] = []
    for rel in MARKDOWN_SETS:
        path = os.path.join(REPO_ROOT, rel)
        if not os.path.exists(path):
            continue
        base, cur, n = os.path.basename(rel), {}, 0
        for line in open(path, encoding="utf-8"):
            m = MD_OPTION.match(line.strip())
            if m:
                if m.group(1) == "A" and cur:
                    cur = {}
                cur[m.group(1)] = m.group(2).strip()
                continue
            a = MD_ANSWER.search(line)
            if a and set(cur) == set("ABCD"):
                n += 1
                qs.append({"id": f"{base}:Q{n}", "_file": base, "options": cur,
                           "answer": a.group(1), "distractors": {k: "" for k in "ABCD" if k != a.group(1)}})
                cur = {}
    if not qs:
        sys.exit("No questions parsed from " + ", ".join(MARKDOWN_SETS))
    return qs


def keys_of(q: dict) -> list[str]:
    a = q["answer"]
    return a if isinstance(a, list) else [a]


def metrics(q: dict) -> dict:
    """Per-question length metrics."""
    ks = keys_of(q)
    lens = {k: len(v) for k, v in q["options"].items()}
    kl = [lens[k] for k in ks]
    dl = [v for k, v in lens.items() if k not in ks]
    # rank of the key among option lengths, 1 = longest
    order = sorted(lens, key=lambda k: -lens[k])
    return {
        "id": q["id"],
        "file": q["_file"],
        "key_mean": st.mean(kl),
        "distractor_mean": st.mean(dl) if dl else 0.0,
        "delta": st.mean(kl) - (st.mean(dl) if dl else 0.0),
        "longest": bool(dl) and max(kl) > max(dl),
        # Longest by a margin a human actually notices while scanning. A key that wins
        # by two characters is still an exploit for a script, but it is not a tell a
        # candidate can see, so the two rates are reported separately.
        "longest_visibly": bool(dl) and max(kl) > max(dl) + VISIBLE_MARGIN,
        "spread": max(lens.values()) - min(lens.values()),
        "rank": min(order.index(k) for k in ks) + 1,
        "shortest_option": min(lens.values()),
        "longest_option": max(lens.values()),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Quality audit for the question bank.")
    ap.add_argument("--strict", action="store_true",
                    help="exit 1 when a threshold is breached (for CI)")
    ap.add_argument("--worst", type=int, default=0,
                    help="list the N worst length-bias offenders")
    ap.add_argument("--file", metavar="NAME",
                    help="audit a single bank file, e.g. domain3.json")
    ap.add_argument("--json", action="store_true",
                    help="emit machine-readable JSON instead of a report")
    ap.add_argument("--markdown", action="store_true",
                    help="audit the readable practice sets (quiz/*.md) instead of the JSON bank")
    args = ap.parse_args()

    bank = load_markdown() if args.markdown else load_bank(args.file)
    n = len(bank)
    m = [metrics(q) for q in bank]
    problems: list[str] = []   # blocking under --strict
    warnings: list[str] = []   # reported, never blocking

    rate = sum(x["longest"] for x in m) / n
    vis_rate = sum(x["longest_visibly"] for x in m) / n
    mean_delta = st.mean(x["delta"] for x in m)
    mean_spread = st.mean(x["spread"] for x in m)
    ranks = Counter(x["rank"] for x in m)
    short = [(q["id"], k) for q in bank for k, v in q["options"].items()
             if k not in keys_of(q) and len(v) < MIN_DISTRACTOR_CHARS]
    longopt = [(q["id"], k) for q in bank for k, v in q["options"].items()
               if len(v) > MAX_OPTION_CHARS]
    missing = [q["id"] for q in bank
               if len(q.get("distractors", {})) < len(q["options"]) - len(keys_of(q))]
    counts = Counter(q.get("scenario") for q in bank)

    if args.json:
        print(json.dumps({
            "questions": n,
            "longest_key_rate": round(rate, 4),
            "visibly_longest_key_rate": round(vis_rate, 4),
            "mean_delta": round(mean_delta, 1),
            "mean_spread": round(mean_spread, 1),
            "rank_distribution": {str(r): ranks.get(r, 0) for r in (1, 2, 3, 4)},
            "filler_distractors": len(short),
            "oversized_options": len(longopt),
            "missing_rationales": len(missing),
            "scenarios": {s: counts.get(s, 0) for s in SCENARIOS},
            "per_question": m,
        }, indent=2))
        return

    if args.markdown:
        print("Readable practice sets: " + ", ".join(
            f"{f} ({sum(1 for q in bank if q['_file'] == f)})" for f in sorted({q["_file"] for q in bank})) + "\n")
    else:
        print(f"Bank: {n} questions  ·  {sum(1 for q in bank if isinstance(q['answer'], list))} multiple-response"
              + (f"  ·  {args.file}" if args.file else ""))
        print(f"Difficulty: {dict(Counter(q.get('difficulty') for q in bank))}\n")

    # --- length bias ---------------------------------------------------------
    print("LENGTH BIAS  — can a candidate spot the key without reading the stem?")
    print(f"  key is the longest option : {sum(x['longest'] for x in m):>4} / {n}  ({rate:.0%})   target <={MAX_LONGEST_KEY_RATE:.0%}, chance 25%")
    print(f"    …of those, longest by {VISIBLE_MARGIN}+ chars : {sum(x['longest_visibly'] for x in m):>4} / {n}  ({vis_rate:.0%})   a margin a reader can actually see")
    print(f"  key longer than distractors by : {mean_delta:>+5.0f} chars (mean)      target <=+{MAX_MEAN_LENGTH_DELTA}")
    print(f"  spread, longest minus shortest : {mean_spread:>5.0f} chars (mean)      target <={MAX_MEAN_SPREAD}")
    print(f"  → always-pick-longest scores {rate:.0%} on this bank")
    print(f"  key length-rank (1 = longest; uniform would be 25% each): "
          + "  ".join(f"{r}:{ranks.get(r,0)/n:.0%}" for r in (1, 2, 3, 4)) + "\n")
    if rate > MAX_LONGEST_KEY_RATE:
        problems.append(f"length bias: key is longest in {rate:.0%} of questions (target <={MAX_LONGEST_KEY_RATE:.0%})")
    if mean_delta > MAX_MEAN_LENGTH_DELTA:
        problems.append(f"length bias: key averages {mean_delta:+.0f} chars vs distractors (target <=+{MAX_MEAN_LENGTH_DELTA})")
    if mean_spread > MAX_MEAN_SPREAD:
        problems.append(f"option spread averages {mean_spread:.0f} chars (target <={MAX_MEAN_SPREAD}) — options are not parallel")

    if args.worst:
        print(f"Worst {args.worst} offenders (key length minus mean distractor):")
        for x in sorted(m, key=lambda x: -x["delta"])[:args.worst]:
            print(f"  {x['delta']:>+5.0f}  spread {x['spread']:>3}  {x['id']}  ({x['file']})")
        print()

    # --- option sizing -------------------------------------------------------
    print(f"FILLER DISTRACTORS  — under {MIN_DISTRACTOR_CHARS} chars: {len(short)}")
    if short:
        print("  " + ", ".join(f"{i}:{k}" for i, k in short[:12]) + (" …" if len(short) > 12 else ""))
        problems.append(f"{len(short)} distractors under {MIN_DISTRACTOR_CHARS} chars read as filler")
    print(f"OVERSIZED OPTIONS  — over {MAX_OPTION_CHARS} chars: {len(longopt)}")
    if longopt:
        print("  " + ", ".join(f"{i}:{k}" for i, k in longopt[:12]) + (" …" if len(longopt) > 12 else ""))
        problems.append(f"{len(longopt)} options over {MAX_OPTION_CHARS} chars — an option that long is arguing, not stating")
    print()

    # --- rationale coverage --------------------------------------------------
    # Markdown sets keep their reasoning in one prose paragraph, not per-option, so
    # there is nothing structured to count.
    if args.markdown:
        pass
    else:
        print(f"DISTRACTOR RATIONALES  — questions missing one: {len(missing)}")
        if missing:
            print("  " + ", ".join(missing[:12]) + (" …" if len(missing) > 12 else ""))
            problems.append(f"{len(missing)} questions missing a distractor rationale")
        print()

    # --- scenario balance ----------------------------------------------------
    if not args.file and not args.markdown:
        parity = n / len(SCENARIOS)
        print(f"SCENARIO BALANCE  — themes are drawn 4-of-6, so parity is ~{parity:.0f} each")
        for s in SCENARIOS:
            c = counts.get(s, 0)
            d = c - parity
            flag = "  ⚠️" if abs(d) > parity * 0.5 else ""
            print(f"  {c:>4}  ({d:>+5.0f})  {s}{flag}")
        thin = [s for s in SCENARIOS if counts.get(s, 0) < parity * 0.5]
        if thin:
            warnings.append(f"scenario coverage under half parity: {', '.join(thin)}")
        print()

    # --- verdict -------------------------------------------------------------
    # Item quality blocks; coverage does not. A thin scenario can only be fixed by
    # authoring new questions, and that should not stand in the way of a PR that
    # fixes a typo. Length bias is a defect in questions that already exist.
    if warnings:
        print("WARNINGS  (reported, not blocking)")
        for w in warnings:
            print(f"  ~ {w}")
        print()
    if problems:
        print("ISSUES  (blocking under --strict)")
        for p in problems:
            print(f"  ! {p}")
        if args.strict:
            sys.exit(1)
    else:
        print("✓ no quality thresholds breached")


if __name__ == "__main__":
    main()
