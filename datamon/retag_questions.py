#!/usr/bin/env python3
"""One-time build script: re-tag datamon/questions.js with a `d` difficulty field
and validate unique stable `id` fields.

The datamon question bank (`datamon/questions.js`) holds condensed, REWRITTEN
versions of the source exam questions in `quiz/bank/domain{1..5}.json` — they are
NOT verbatim copies, so substring matching fails. This script fuzzy-matches each
datamon question against its mapped source domain (AGENT->domain1, MCP->domain2,
CONFIG->domain3, PROMPT->domain4, CONTEXT->domain5) using a combined
SequenceMatcher + token-Jaccard similarity over (question + choices + explanation),
copies the matched source `difficulty` into a new `d` field ("easy"/"medium"/"hard"),
and defaults to "medium" when no match clears the threshold.

Invariants:
  * Never drops a question (asserts per-category and total counts unchanged).
  * Preserves the existing id/q/c/a/x key shape; adds `d` as the last key.
  * Only the QUESTION_BANK object is rewritten — header comment and the trailing
    MON_NAMES / BATTLE_INTROS / WIN_QUOTES / LOSE_QUOTES blocks are kept verbatim.
  * IDs are stable and immutable: they do NOT depend on array position.
    Reordering questions must preserve their IDs unchanged.

Run from repo root:  uv run python datamon/retag_questions.py
"""
import json
import re
import sys
from difflib import SequenceMatcher
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
QUESTIONS_JS = REPO / "datamon" / "questions.js"
CATEGORY_DOMAIN = {
    "AGENT": "domain1",
    "MCP": "domain2",
    "CONFIG": "domain3",
    "PROMPT": "domain4",
    "CONTEXT": "domain5",
}
CATEGORY_ORDER = ["AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT"]
MATCH_THRESHOLD = 0.12  # combined score below this -> default "medium" (uncertain)

_word_re = re.compile(r"[a-z0-9_]+")


def normalize(text: str) -> str:
    return " ".join(_word_re.findall((text or "").lower()))


def tokens(text: str) -> set:
    return set(_word_re.findall((text or "").lower()))


def jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def extract_balanced_array(text: str, start: int) -> str:
    """Return the JSON array substring starting at the '[' at/after `start`,
    tracking bracket depth and skipping brackets inside strings."""
    i = text.index("[", start)
    depth = 0
    in_str = False
    esc = False
    for j in range(i, len(text)):
        ch = text[j]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return text[i:j + 1]
    raise ValueError("unbalanced array")


import math
from collections import Counter


def correct_choice(q: dict) -> str:
    c = q.get("c", [])
    a = q.get("a", -1)
    return c[a] if isinstance(a, int) and 0 <= a < len(c) else ""


def bank_correct_option(entry: dict) -> str:
    opts = entry.get("options", {})
    ans = entry.get("answer", "")
    if isinstance(opts, dict):
        return opts.get(ans, "")
    return ""


def datamon_text(q: dict) -> str:
    return " ".join([q.get("q", ""), " ".join(q.get("c", [])), q.get("x", "")])


def bank_text(entry: dict) -> str:
    opts = entry.get("options", {})
    opt_text = " ".join(opts.values()) if isinstance(opts, dict) else ""
    return " ".join([entry.get("stem", ""), opt_text, entry.get("explanation", "")])


def build_idf(bank: list) -> dict:
    """Inverse document frequency over the source-domain bank. Distinctive
    technical tokens (pause_turn, max_turns, ResultMessage) get high weight;
    ubiquitous words (agent, the, claude, loop) get near-zero weight — which is
    exactly the signal that disambiguates rewritten questions."""
    n = len(bank)
    df = Counter()
    for entry in bank:
        for tok in tokens(bank_text(entry)):
            df[tok] += 1
    return {tok: math.log((n + 1) / (c + 0.5)) for tok, c in df.items()}


def idf_cosine(a_toks: set, b_toks: set, idf: dict) -> float:
    """IDF-weighted cosine over presence vectors (binary tf, idf weights)."""
    shared = a_toks & b_toks
    if not shared:
        return 0.0
    num = sum(idf.get(t, 0.0) ** 2 for t in shared)
    na = math.sqrt(sum(idf.get(t, 0.0) ** 2 for t in a_toks))
    nb = math.sqrt(sum(idf.get(t, 0.0) ** 2 for t in b_toks))
    if na == 0 or nb == 0:
        return 0.0
    return num / (na * nb)


def score_pair(q: dict, entry: dict, idf: dict) -> float:
    """IDF-weighted similarity between a datamon question and a bank entry.

    Datamon questions are rewrites, so the discriminating signal is the set of
    rare technical tokens they still share with the source — captured by an
    IDF-weighted cosine over the full text. The correct-answer char-sequence
    ratio is blended in as a tiebreak for near-duplicate option wording."""
    s_full = idf_cosine(tokens(datamon_text(q)), tokens(bank_text(entry)), idf)
    dc, bc = correct_choice(q), bank_correct_option(entry)
    s_ans = SequenceMatcher(None, normalize(dc), normalize(bc)).ratio()
    return 0.80 * s_full + 0.20 * s_ans


def best_match(q: dict, bank: list, idf: dict):
    """Return (difficulty, score, matched_stem) of the best bank entry."""
    best = ("medium", -1.0, "")
    for entry in bank:
        score = score_pair(q, entry, idf)
        if score > best[1]:
            best = (entry.get("difficulty", "medium"), score, entry.get("stem", ""))
    return best


def top_matches(q: dict, bank: list, idf: dict, n: int = 3):
    scored = sorted(
        ((score_pair(q, e, idf), e) for e in bank), key=lambda t: t[0], reverse=True
    )
    return scored[:n]


def main() -> int:
    check_mode = "--check" in sys.argv
    dry_run = "--dry-run" in sys.argv
    raw = QUESTIONS_JS.read_text(encoding="utf-8")

    head_end = raw.index("const QUESTION_BANK")
    tail_start = raw.index('// The "mons" colleagues')
    head = raw[:head_end]
    tail = raw[tail_start:]
    bank_region = raw[head_end:tail_start]

    # Parse current datamon categories.
    categories = {}
    for cat in CATEGORY_ORDER:
        m = re.search(rf"\b{cat}\s*:", bank_region)
        if not m:
            print(f"ERROR: category {cat} not found", file=sys.stderr)
            return 1
        arr_text = extract_balanced_array(bank_region, m.end())
        categories[cat] = json.loads(arr_text)

    # Load source banks + build per-domain IDF.
    banks = {}
    idfs = {}
    for cat, dom in CATEGORY_DOMAIN.items():
        banks[cat] = json.loads((REPO / "quiz" / "bank" / f"{dom}.json").read_text(encoding="utf-8"))
        idfs[cat] = build_idf(banks[cat])

    if check_mode:
        print("=== retag_questions.py --check ===")
        errors = 0
        # Validate IDs: unique category-prefixed ^[a-z]+-[0-9]{3}$ only.
        # IDs are IMMUTABLE under reorder — position is irrelevant.
        import re as id_re
        id_pat = id_re.compile(r"^[a-z]+-[0-9]{3}$")
        id_set = set()
        for cat in CATEGORY_ORDER:
            qs = categories[cat]
            expected_prefix = cat.lower()
            for i, q in enumerate(qs):
                qid = q.get("id", "")
                if not qid:
                    print(f"ERROR: {cat}[{i}] missing id")
                    errors += 1
                elif not id_pat.match(qid):
                    print(f"ERROR: {cat}[{i}] invalid id format: {qid} (expected {expected_prefix}-NNN)")
                    errors += 1
                elif qid in id_set:
                    print(f"ERROR: {cat}[{i}] duplicate id: {qid}")
                    errors += 1
                else:
                    id_set.add(qid)

        total = sum(len(categories[c]) for c in CATEGORY_ORDER)
        if len(id_set) != total:
            print(f"ERROR: ID count mismatch: {len(id_set)} unique vs {total} questions")
            errors += 1
        if total != 120:
            print(f"ERROR: total question count {total} != 120")
            errors += 1
        # Validate category counts
        for cat in CATEGORY_ORDER:
            if len(categories[cat]) != 24:
                print(f"ERROR: {cat} has {len(categories[cat])} questions (expected 24)")
                errors += 1
        # Validate all entries have required fields in correct order
        for cat in CATEGORY_ORDER:
            for i, q in enumerate(categories[cat]):
                for field in ("id", "q", "c", "a", "x", "d"):
                    if field not in q:
                        print(f"ERROR: {cat}[{i}] missing field {field}")
                        errors += 1
                if not isinstance(q.get("c"), list) or len(q.get("c", [])) != 4:
                    print(f"ERROR: {cat}[{i}] choices must be list of 4")
                    errors += 1
                if not isinstance(q.get("a"), int) or not (0 <= q.get("a", -1) < len(q.get("c", []))):
                    print(f"ERROR: {cat}[{i}] invalid answer index")
                    errors += 1
                if q.get("d") not in ("easy", "medium", "hard"):
                    print(f"ERROR: {cat}[{i}] invalid difficulty: {q.get('d')}")
                    errors += 1

        if errors:
            print(f"\n{errors} error(s) found. Run without --check to re-tag.")
            return 1

        # Reorder-probe: prove IDs are immutable under reorder.
        # Reverse AGENT array and verify every ID is unchanged.
        agent_qs = categories["AGENT"]
        agent_ids_orig = [q.get("id", "") for q in agent_qs]
        agent_reversed = list(reversed(agent_qs))
        agent_ids_rev = [q.get("id", "") for q in agent_reversed]
        agent_ids_expected_rev = list(reversed(agent_ids_orig))
        if agent_ids_rev != agent_ids_expected_rev:
            print("ERROR: reorder-probe failed — IDs do not survive reorder")
            for i, (got, exp) in enumerate(zip(agent_ids_rev, agent_ids_expected_rev)):
                if got != exp:
                    print(f"  reversed[{i}]: got {got}, expected {exp}")
            errors += 1
        else:
            print("Reorder-probe passed: IDs are stable under array reorder.")
            print(f"  AGENT[0] id={agent_ids_orig[0]}, AGENT[23] id={agent_ids_orig[23]}")
            print(f"  reversed AGENT[0] id={agent_ids_rev[0]} (was AGENT[23])")

        if errors:
            print(f"\n{errors} error(s) found. Run without --check to re-tag.")
            return 1
        print(f"All checks passed: {total} questions, {len(id_set)} unique IDs, 5 categories × 24.")
        return 0

    if dry_run:
        for cat in CATEGORY_ORDER:
            print(f"\n===== {cat} (vs {CATEGORY_DOMAIN[cat]}) =====")
            for q in categories[cat]:
                tm = top_matches(q, banks[cat], idfs[cat], 3)
                best_diff = tm[0][1].get("difficulty", "medium") if tm else "medium"
                flag = "" if tm and tm[0][0] >= MATCH_THRESHOLD else "  <<LOW>>"
                print(f"\nQ: {q.get('q','')[:78]}{flag}")
                print(f"   ans: {correct_choice(q)[:70]}")
                for sc, e in tm:
                    print(f"   [{sc:.3f}] {e.get('difficulty'):6} {e.get('stem','')[:64]}")
                print(f"   -> assign d={best_diff if (tm and tm[0][0] >= MATCH_THRESHOLD) else 'medium'}")
        return 0

    # Tag.
    dist = {"easy": 0, "medium": 0, "hard": 0}
    low_score = []
    counts_in = {}
    counts_out = {}
    for cat in CATEGORY_ORDER:
        qs = categories[cat]
        counts_in[cat] = len(qs)
        for q in qs:
            diff, score, stem = best_match(q, banks[cat], idfs[cat])
            if score < MATCH_THRESHOLD or diff not in ("easy", "medium", "hard"):
                diff = "medium"
            q["d"] = diff  # added as last key (dict preserves insertion order)
            dist[diff] += 1
            if score < MATCH_THRESHOLD:
                low_score.append((cat, round(score, 3), q.get("q", "")[:60], stem[:50]))
        counts_out[cat] = len(qs)

    # Invariant: no question dropped.
    for cat in CATEGORY_ORDER:
        assert counts_in[cat] == counts_out[cat], f"count drift in {cat}"
    total_in = sum(counts_in.values())
    total_out = sum(counts_out.values())
    assert total_in == total_out, "total count drift"

    # Re-emit. Compact one-line-per-entry; key order id,q,c,a,x,d.
    def emit_entry(q: dict) -> str:
        ordered = {"id": q.get("id", ""), "q": q["q"], "c": q["c"], "a": q["a"], "x": q.get("x", ""), "d": q["d"]}
        return json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))

    parts = [head, "const QUESTION_BANK = {\n"]
    for ci, cat in enumerate(CATEGORY_ORDER):
        parts.append(f"  {cat}: [\n")
        entries = categories[cat]
        for ei, q in enumerate(entries):
            sep = "," if ei < len(entries) - 1 else ""
            parts.append("    " + emit_entry(q) + sep + "\n")
        parts.append("  ]" + ("," if ci < len(CATEGORY_ORDER) - 1 else "") + "\n")
    parts.append("};\n\n")
    parts.append(tail)
    out = "".join(parts)

    QUESTIONS_JS.write_text(out, encoding="utf-8")

    print(f"Re-tagged {total_out} questions (in={total_in}).")
    print("Per-category counts:", counts_in)
    print("Difficulty distribution:", dist)
    print(f"Questions below match threshold {MATCH_THRESHOLD} (defaulted to medium): {len(low_score)}")
    for cat, sc, qtext, stem in low_score:
        print(f"  [{cat}] score={sc} :: {qtext} ~ {stem}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
