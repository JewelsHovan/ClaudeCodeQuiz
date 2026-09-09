#!/usr/bin/env python3
"""
check_bank_diff.py — compare the working-tree bank against a git ref.

For bulk edits to the question bank (a length-parity pass, a tone pass), the thing
you actually need to prove is a negative: that nothing changed except what was
meant to. This diffs field by field and fails on any change to a frozen field.

Frozen — a change here is an error:
  id, domain, domain_name, scenario, difficulty, answer, select_count, tags, source, stem
  and the option letters themselves (must stay exactly A-D)

Free — a change here is expected and reported, not flagged:
  options[A-D] text, explanation, distractors

A question disappearing, appearing, or moving file is an error. New questions are
reported separately so an additive commit still passes.

Run:
  uv run python scripts/check_bank_diff.py                    # vs HEAD
  uv run python scripts/check_bank_diff.py --ref main         # vs another ref
  uv run python scripts/check_bank_diff.py --show-options d3-010
"""
from __future__ import annotations
import argparse
import glob
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FROZEN = ["domain", "domain_name", "scenario", "difficulty", "answer",
          "select_count", "tags", "source", "stem"]


def bank_at_ref(ref: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    files = subprocess.run(["git", "ls-tree", "--name-only", ref, "quiz/bank/"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout.split()
    for path in files:
        if not path.endswith(".json"):
            continue
        blob = subprocess.run(["git", "show", f"{ref}:{path}"],
                              cwd=ROOT, capture_output=True, text=True, check=True).stdout
        for q in json.loads(blob):
            q["_file"] = os.path.basename(path)
            out[q["id"]] = q
    return out


def bank_working() -> dict[str, dict]:
    out: dict[str, dict] = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "quiz", "bank", "*.json"))):
        for q in json.load(open(path, encoding="utf-8")):
            q["_file"] = os.path.basename(path)
            out[q["id"]] = q
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Diff the bank against a git ref, guarding frozen fields.")
    ap.add_argument("--ref", default="HEAD", help="git ref to compare against (default HEAD)")
    ap.add_argument("--show-options", metavar="ID", help="print before/after options for one question")
    args = ap.parse_args()

    old, new = bank_at_ref(args.ref), bank_working()
    errors: list[str] = []

    if args.show_options:
        qid = args.show_options
        if qid not in old or qid not in new:
            sys.exit(f"{qid} not present in both {args.ref} and the working tree")
        for label, q in (("BEFORE", old[qid]), ("AFTER", new[qid])):
            print(f"--- {label}  {qid}  answer={q['answer']}")
            for L in "ABCD":
                mark = "*" if L in (q["answer"] if isinstance(q["answer"], list) else [q["answer"]]) else " "
                print(f"  {mark}{L} [{len(q['options'][L]):>3}] {q['options'][L]}")
        return

    removed = sorted(set(old) - set(new))
    added = sorted(set(new) - set(old))
    for qid in removed:
        errors.append(f"{qid}: removed from the bank")

    changed_opts = moved = 0
    changed_expl: list[str] = []
    for qid in sorted(set(old) & set(new)):
        o, w = old[qid], new[qid]
        if o["_file"] != w["_file"]:
            errors.append(f"{qid}: moved {o['_file']} -> {w['_file']}")
            moved += 1
        for f in FROZEN:
            if o.get(f) != w.get(f):
                errors.append(f"{qid}: frozen field {f!r} changed\n      - {o.get(f)!r}\n      + {w.get(f)!r}")
        if set(w.get("options", {})) != set("ABCD"):
            errors.append(f"{qid}: options are not exactly A-D")
        elif o["options"] != w["options"]:
            changed_opts += 1
        if o.get("explanation") != w.get("explanation") or o.get("distractors") != w.get("distractors"):
            changed_expl.append(qid)

    print(f"Compared {len(set(old) & set(new))} questions against {args.ref}")
    print(f"  options rewritten          : {changed_opts}")
    print(f"  explanation/distractors    : {len(changed_expl)}")
    print(f"  new questions              : {len(added)}" + (f"  ({', '.join(added[:8])}{' …' if len(added) > 8 else ''})" if added else ""))
    if errors:
        print(f"\n{len(errors)} ERROR(s) — frozen data changed:")
        for e in errors:
            print("  ✗ " + e)
        sys.exit(1)
    print("\n✓ answers, stems and metadata are byte-identical; only option wording moved")


if __name__ == "__main__":
    main()
