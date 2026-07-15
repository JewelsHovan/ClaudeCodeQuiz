#!/usr/bin/env python3
"""
gen_library.py — DATAMON library minigame content bank generator.

Derives four JSON content banks from existing docs/*.md and quiz/bank/domain{1-5}.json.
No manual content authoring, no network access, stdlib only.

Difficulty mapping: quiz data uses easy/medium/hard; output normalises medium→normal.

Output files (under datamon/library/):
  pairs.json    — term↔definition flash pairs (≥20)
  cloze.json    — fill-in-the-blank items (≥20)
  diagrams.json — ASCII decision-tree puzzles (≥5)
  books.json    — pre-paginated study-doc pages for in-game reader (≥10)

Re-running OVERWRITES generated output; hand-curated edits require a separate
post-process step or manual re-application.
"""

import argparse
import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parents[2]
QUIZ_DIR = REPO_ROOT / "quiz" / "bank"
DOCS_DIR = REPO_ROOT / "docs"
OUT_DIR = REPO_ROOT / "datamon" / "library"

# ---------------------------------------------------------------------------
# Books pipeline constants (agreed w/ ticket E #027)
# ---------------------------------------------------------------------------

PAGE_WIDTH = 38      # max chars per wrapped text line (8px pixel font @ 304px usable canvas width)
LINES_PER_PAGE = 12  # max text lines per page (canvas height minus title/nav chrome)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def first_sentence(text: str) -> str:
    """Return the first sentence of text (split on '. ' or '.\\n', keep period)."""
    text = text.strip()
    for sep in (". ", ".\n"):
        idx = text.find(sep)
        if idx != -1:
            return text[: idx + 1].strip()
    # Fallback: whole text (already a single sentence or ends with period)
    return text.strip()


def norm_difficulty(d: str) -> str:
    """Map quiz difficulty values to output values: medium→normal, others pass through."""
    return {"medium": "normal"}.get(d, d)


def slugify(text: str) -> str:
    """Lowercase, replace non-alphanumeric runs with '-', strip leading/trailing '-'."""
    text = text.lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def doc_slug(path: Path) -> str:
    """Return slug from filename stem (e.g. exam-cheat-sheet from exam-cheat-sheet.md)."""
    return slugify(path.stem)


def load_quiz() -> list:
    """
    Read all 5 domain JSON files in sorted filename order.
    Return list sorted by question id (stable lexicographic sort on id string).
    """
    questions = []
    for fpath in sorted(QUIZ_DIR.glob("domain*.json")):
        with fpath.open(encoding="utf-8") as fh:
            questions.extend(json.load(fh))
    # Sort by id for deterministic output
    questions.sort(key=lambda q: q["id"])
    return questions


# ---------------------------------------------------------------------------
# Pairs builder
# ---------------------------------------------------------------------------


def build_pairs() -> list:
    """
    Build term↔definition pairs from quiz questions and doc headings.

    Per question:
      term       = tags[0] if non-empty, else longest capitalised token from stem
      definition = first_sentence(explanation)
      domain     = q["domain"]
      difficulty = norm_difficulty(q["difficulty"])

    Per doc H3 heading (supplement):
      term       = cleaned heading text
      definition = first non-empty paragraph line following the heading
      domain     = N if filename matches domainN, else 0
      difficulty = "normal"
    """
    raw: list[dict] = []

    # --- Quiz-derived pairs ---
    for q in load_quiz():
        tags = q.get("tags", [])
        if tags:
            term = tags[0]
        else:
            # Fallback: longest capitalised token in stem
            caps = re.findall(r"\b[A-Z][a-zA-Z]{2,}\b", q["stem"])
            term = max(caps, key=len) if caps else ""

        definition = first_sentence(q.get("explanation", ""))
        if not term or not definition:
            continue

        raw.append(
            {
                "term": term,
                "definition": definition,
                "domain": q["domain"],
                "difficulty": norm_difficulty(q["difficulty"]),
                "_src": "quiz",
            }
        )

    # --- Doc-heading supplement ---
    for fpath in sorted(DOCS_DIR.glob("*.md")):
        # Infer domain from filename
        m = re.search(r"domain(\d+)", fpath.stem)
        domain = int(m.group(1)) if m else 0

        lines = fpath.read_text(encoding="utf-8").splitlines()
        i = 0
        while i < len(lines):
            line = lines[i]
            # Match H3 headings
            h3_match = re.match(r"^###\s+(.*)", line)
            if h3_match:
                heading_text = h3_match.group(1).strip().strip('"').strip("'").strip()
                # Walk forward to find first non-empty, plain-prose paragraph line
                j = i + 1
                definition = ""
                while j < len(lines):
                    candidate = lines[j].strip()
                    # Skip blank lines, fence markers, and sub-headings
                    if candidate and not candidate.startswith("#") and not candidate.startswith("```"):
                        sentence = first_sentence(candidate)
                        # Require: starts with a letter/digit (not symbol/bullet/bracket),
                        # length ≥ 15 chars (prose, not a code snippet or short label)
                        if sentence and len(sentence) >= 15 and sentence[0].isalpha():
                            definition = sentence
                        break
                    j += 1

                if heading_text and definition and domain in range(1, 6):
                    raw.append(
                        {
                            "term": heading_text,
                            "definition": definition,
                            "domain": domain,
                            "difficulty": "normal",
                            "_src": "doc",
                        }
                    )
            i += 1

    # Deduplicate by (term.lower(), definition) keeping first occurrence, then sort for determinism
    seen: set[tuple] = set()
    deduped: list[dict] = []
    for item in raw:
        key = (item["term"].lower(), item["definition"].lower())
        if key not in seen:
            seen.add(key)
            deduped.append(item)

    # Stable sort: quiz items before doc items (by _src), then by term
    deduped.sort(key=lambda x: (x["_src"], x["term"].lower()))

    # Assign final ids and drop internal _src field
    pairs: list[dict] = []
    for idx, item in enumerate(deduped):
        pairs.append(
            {
                "id": f"pair-{idx:03d}",
                "term": item["term"],
                "definition": item["definition"],
                "domain": item["domain"],
                "difficulty": item["difficulty"],
            }
        )

    return pairs


# ---------------------------------------------------------------------------
# Cloze builder
# ---------------------------------------------------------------------------

# Stoplist for the capitalized-token fallback: framing/common words that make
# poor blanks because they test sentence structure rather than exam content.
_CLOZE_STOPLIST: frozenset[str] = frozenset({
    "which", "given", "your", "you", "what", "when", "where", "after", "before",
    "this", "that", "these", "those", "testers", "reviewers", "claude", "yesterday",
    "today", "the", "and", "with", "from", "into", "over", "every", "here", "there",
    "while", "would", "should", "could", "agent", "agents", "system",
})


def _tag_candidates(tag: str) -> list[str]:
    """
    Return all surface forms of a tag to try matching against the stem.

    For a plain tag like "coordinator" → ["coordinator"].
    For a hyphenated tag like "error-handling" → ["error-handling", "error handling",
    "error", "handling"] (individual words last, longest first within each group).
    Returned in priority order: full form first, space-joined, then individual words
    sorted longest-first so we always pick the most specific match.
    """
    candidates: list[str] = [tag]
    if "-" in tag:
        space_form = tag.replace("-", " ")
        candidates.append(space_form)
        words = [w for w in tag.split("-") if w]
        # Add individual words longest-first (deterministic: sort by length desc, then alpha)
        candidates.extend(sorted(words, key=lambda w: (-len(w), w)))
    return candidates


def _find_cloze_keyword(q: dict) -> str:
    """
    Find the best keyword to blank in the stem. Deterministic; returns the matched
    substring (preserving original casing from the stem) or empty string if none found.

    Priority:
    1. First tag (in given order) whose word(s) appear verbatim (case-insensitive) as
       a substring in the stem. For hyphenated tags, also try space-joined form and
       individual words. Return the actual matched substring from the stem so that
       re.sub with re.IGNORECASE blanks exactly one occurrence.
    2. Longest token in the stem (length ≥ 5) that:
         - is NOT the first whitespace-delimited word of the stem, AND
         - lowercased is NOT in _CLOZE_STOPLIST.
       Among ties on length use the first occurrence in the stem (deterministic).
       Tokens are extracted by splitting on whitespace and stripping punctuation edges.
    3. Return empty string → caller will skip the question.
    """
    tags = q.get("tags", [])
    stem = q["stem"]
    stem_lower = stem.lower()

    # --- Priority 1: tag matching ---
    # Skip any candidate whose lowercased form is in the stoplist — individual words
    # from hyphenated tags (e.g. "claude" from "claude-md") produce poor blanks.
    for tag in tags:
        for candidate in _tag_candidates(tag):
            c_lower = candidate.lower()
            if c_lower in _CLOZE_STOPLIST:
                continue
            idx = stem_lower.find(c_lower)
            if idx != -1:
                # Return the verbatim slice from the stem (preserves original casing)
                return stem[idx: idx + len(candidate)]

    # --- Priority 2: longest non-stoplist, non-first-word token (len ≥ 5) ---
    # Split stem into whitespace tokens to find the first word and all candidates.
    words = stem.split()
    if not words:
        return ""
    first_word_lower = re.sub(r"[^a-z]", "", words[0].lower())

    # Walk the stem with a word-boundary tokeniser so we get positional info.
    # We want the longest match; ties resolved by first occurrence.
    best_token = ""
    best_len = 0

    for m in re.finditer(r"\b[a-zA-Z]{5,}\b", stem):
        token = m.group()
        token_lower = token.lower()
        # Skip stoplist words
        if token_lower in _CLOZE_STOPLIST:
            continue
        # Skip if this token IS the first word of the stem (compare cleaned forms)
        if token_lower == first_word_lower:
            continue
        # Skip if this match starts at position 0 (belt-and-suspenders)
        if m.start() == 0:
            continue
        # Prefer longer tokens; first occurrence wins on equal length
        if len(token) > best_len:
            best_len = len(token)
            best_token = token

    return best_token


def build_cloze() -> list:
    """
    Build fill-in-the-blank items from quiz questions.

    Each item: id, template (exactly one '___'), answer, hint, domain, difficulty.
    Items that can't satisfy the constraints are silently skipped.
    """
    cloze: list[dict] = []

    for q in load_quiz():
        kw = _find_cloze_keyword(q)
        if not kw:
            continue

        stem = q["stem"]
        template = re.sub(re.escape(kw), "___", stem, count=1, flags=re.IGNORECASE)

        # Validate constraints
        if template == stem:
            continue  # substitution didn't happen
        if template.count("___") != 1:
            continue  # multiple blanks (shouldn't happen with count=1 but guard anyway)

        hint = first_sentence(q.get("explanation", ""))
        if not hint:
            continue

        cloze.append(
            {
                "_sort_key": q["id"],  # for ordering, stripped before output
                "template": template,
                "answer": kw,
                "hint": hint,
                "domain": q["domain"],
                "difficulty": norm_difficulty(q["difficulty"]),
            }
        )

    # Sort by id (already processed in id order from load_quiz, but be explicit)
    cloze.sort(key=lambda x: x["_sort_key"])

    # Assign ids and drop sort key
    result: list[dict] = []
    for idx, item in enumerate(cloze):
        result.append(
            {
                "id": f"cloze-{idx:03d}",
                "template": item["template"],
                "answer": item["answer"],
                "hint": item["hint"],
                "domain": item["domain"],
                "difficulty": item["difficulty"],
            }
        )

    return result


# ---------------------------------------------------------------------------
# Diagrams builder
# ---------------------------------------------------------------------------

# Leaf-line prefixes for ASCII trees
_LEAF_PREFIXES = ("├──", "└──")


def _strip_leaf_marker(line: str) -> str:
    """Remove leading box-drawing branch marker and return the label text."""
    stripped = line.strip()
    for prefix in _LEAF_PREFIXES:
        if stripped.startswith(prefix):
            return stripped[len(prefix) :].strip()
    return stripped


def _is_leaf_line(line: str) -> bool:
    """
    Return True only for lines that are genuine decision-tree leaf lines:
    they start with ├── or └── AND contain at least one alphanumeric character
    after the marker (i.e., not pure box-drawing connector lines like └───┬───).
    """
    stripped = line.strip()
    if not (stripped.startswith("├──") or stripped.startswith("└──")):
        return False
    # Strip the marker prefix and check that the label has alphanumeric content
    for prefix in ("├──", "└──"):
        if stripped.startswith(prefix):
            label = stripped[len(prefix):]
            return bool(re.search(r"[a-zA-Z0-9]", label))
    return False


def build_diagrams() -> list:
    """
    Build diagram puzzles from ASCII decision trees in docs/*.md.

    Scans fenced code blocks that contain leaf lines (├── / └──).
    Per block:
      - title from the nearest preceding ### heading (quotes stripped)
      - root/prompt = first non-empty, non-leaf line in the block
      - pieces = one per leaf line
      - correct_layout = ordered list of piece ids
    """
    diagrams: list[dict] = []

    for fpath in sorted(DOCS_DIR.glob("*.md")):
        # Infer domain from filename
        m = re.search(r"domain(\d+)", fpath.stem)
        file_domain = int(m.group(1)) if m else 0

        dslug = doc_slug(fpath)
        lines = fpath.read_text(encoding="utf-8").splitlines()

        last_h3: str = ""
        in_fence: bool = False
        fence_lines: list[str] = []
        doc_diagram_idx: int = 0  # 0-based index within this doc file

        def flush_block(block: list[str], heading: str, domain: int) -> None:
            nonlocal doc_diagram_idx

            # Split into root line(s) and leaf lines
            root_candidates = [ln for ln in block if ln.strip() and not _is_leaf_line(ln)]
            leaf_lines = [ln for ln in block if _is_leaf_line(ln)]

            if len(leaf_lines) < 2:
                return  # skip blocks without ≥2 leaves

            root_line = root_candidates[0].strip() if root_candidates else heading

            # Title: heading text with quotes stripped; fallback to root line
            title = heading.strip().strip('"').strip("'").strip() if heading else root_line

            # Slug for this diagram (N is 1-based for readability)
            N = doc_diagram_idx + 1
            base_slug = f"lib-diagram-{dslug}-{N}"

            pieces: list[dict] = []
            for M, leaf in enumerate(leaf_lines, start=1):
                label = _strip_leaf_marker(leaf)
                piece_slug = f"{base_slug}-piece-{M}"
                pieces.append(
                    {
                        "id": f"piece-{M}",
                        "label": label,
                        "sprite_slug": piece_slug,
                    }
                )

            correct_layout = [p["id"] for p in pieces]

            diagrams.append(
                {
                    "_sort_key": f"{dslug}-{N:04d}",
                    "slug": base_slug,
                    "sprite_slug": base_slug,
                    "title": title,
                    "domain": domain,
                    "root": root_line,
                    "pieces": pieces,
                    "correct_layout": correct_layout,
                }
            )
            doc_diagram_idx += 1

        for line in lines:
            h3_match = re.match(r"^###\s+(.*)", line)
            if h3_match:
                last_h3 = h3_match.group(1).strip()

            if line.strip().startswith("```") and not in_fence:
                # Opening fence — start collecting
                in_fence = True
                fence_lines = []
                continue

            if line.strip().startswith("```") and in_fence:
                # Closing fence — process the block if it has leaf lines
                if any(_is_leaf_line(ln) for ln in fence_lines):
                    flush_block(fence_lines, last_h3, file_domain)
                in_fence = False
                fence_lines = []
                continue

            if in_fence:
                fence_lines.append(line)

    # Sort for determinism: by _sort_key (file order, then doc_diagram_idx)
    diagrams.sort(key=lambda x: x["_sort_key"])

    # Assign global ids and drop internal sort key
    result: list[dict] = []
    for idx, item in enumerate(diagrams):
        entry = {k: v for k, v in item.items() if k != "_sort_key"}
        entry["id"] = f"diagram-{idx:03d}"
        # Re-order keys for clean output
        result.append(
            {
                "id": entry["id"],
                "slug": entry["slug"],
                "sprite_slug": entry["sprite_slug"],
                "title": entry["title"],
                "domain": entry["domain"],
                "root": entry["root"],
                "pieces": entry["pieces"],
                "correct_layout": entry["correct_layout"],
            }
        )

    return result


# ---------------------------------------------------------------------------
# Books builder
# ---------------------------------------------------------------------------


def _book_domain(stem: str) -> int:
    """
    Return the exam domain int for a doc filename stem.

    - Filenames matching domain<N> → N (1–5)
    - mcp-deep-dive → 2
    - agent-sdk-deep-dive → 1
    - anything else → 0 (reference)
    """
    m = re.search(r"domain(\d+)", stem)
    if m:
        return int(m.group(1))
    if stem == "mcp-deep-dive":
        return 2
    if stem == "agent-sdk-deep-dive":
        return 1
    return 0


def _cover_slug(domain: int) -> str:
    """
    Return cover sprite slug.  Domain must be 1–5; anything outside that range
    maps to book-domain1 (only covers book-domain1..5 exist in assets).
    """
    n = domain if 1 <= domain <= 5 else 1
    return f"book-domain{n}"


def _line_too_long(line: str) -> bool:
    """
    Return True iff the line exceeds PAGE_WIDTH. The books.json contract requires
    that NO text line exceed PAGE_WIDTH — wrap_text() now hard-splits long unbreakable
    tokens, so there is no whitespace exemption.
    """
    return len(line) > PAGE_WIDTH


def clean_text_line(line: str) -> str:
    """
    Strip markdown syntax from a single line to produce plain readable text:
    - Leading heading hashes, including indented ones ('   ## Heading' in code fences)
    - Leading list markers ('- ', '* ', '1. ', etc.)
    - Inline **bold** / __bold__ markers
    - Inline `code` backticks
    Returns the result with trailing whitespace stripped.
    Does NOT reflow table rows (| pipes are left alone).

    Bold (**) and backtick markers are removed unconditionally rather than only as
    matched pairs: lone markers survive otherwise — e.g. glob patterns like
    `**/*.test.tsx`, or a **bold** span that the source hard-wrapped across two lines.
    Inner text is preserved in every case. Single '*' (italic emphasis) and '__'
    (underscore bold — rare, and collides with code identifiers like __init__) are
    left untouched: the acceptance contract bans only #/**/backtick markers.
    """
    # Strip heading hashes (tolerate leading whitespace — indented comments in fences)
    line = re.sub(r"^\s*#+\s*", "", line)
    # Strip list markers (unordered and ordered)
    line = re.sub(r"^\s*([-*+]|\d+\.)\s+", "", line)
    # Strip matched __bold__ markers (kept as a pair to avoid mangling __identifiers__)
    line = re.sub(r"__(.+?)__", r"\1", line)
    # Remove bold markers and backticks unconditionally (lone-token safe)
    line = line.replace("**", "")
    line = line.replace("`", "")
    return line.rstrip()


def _split_long_token(token: str) -> list:
    """Hard-split a token longer than PAGE_WIDTH into PAGE_WIDTH-sized chunks."""
    return [token[i: i + PAGE_WIDTH] for i in range(0, len(token), PAGE_WIDTH)]


def wrap_text(text: str) -> list:
    """
    Greedy wrap text to PAGE_WIDTH characters.

    - Accumulates whitespace-delimited tokens onto a line.
    - If adding the next token would exceed PAGE_WIDTH, start a new line.
    - A single token longer than PAGE_WIDTH is hard-split into PAGE_WIDTH-sized
      chunks (each on its own line) so NO output line exceeds PAGE_WIDTH. This is
      required by the books.json contract; long URLs/identifiers wrap rather than
      overflow the fixed-width pixel reader.
    - Empty/whitespace-only input returns [].
    """
    if not text or not text.strip():
        return []
    tokens = text.split()
    if not tokens:
        return []
    lines = []
    current = ""
    for token in tokens:
        if len(token) > PAGE_WIDTH:
            # Flush the in-progress line, then emit the over-long token as chunks.
            if current:
                lines.append(current)
                current = ""
            lines.extend(_split_long_token(token))
        elif not current:
            current = token
        elif len(current) + 1 + len(token) <= PAGE_WIDTH:
            current += " " + token
        else:
            lines.append(current)
            current = token
    if current:
        lines.append(current)
    return lines


def paginate_text_lines(lines: list) -> list:
    """
    Slice a flat list of wrapped text lines into page dicts of at most
    LINES_PER_PAGE lines each.  Returns [] for empty input (the ≥1-page
    guarantee is enforced in build_book, not here).
    """
    if not lines:
        return []
    pages = []
    for start in range(0, len(lines), LINES_PER_PAGE):
        chunk = lines[start: start + LINES_PER_PAGE]
        pages.append({"type": "text", "lines": chunk})
    return pages


def build_books() -> list:
    """
    Build pre-paginated book objects from all docs/*.md files.

    Each book has:
      id          — doc_slug(path)
      domain      — int per _book_domain()
      title       — first H1 heading text, or titleized stem
      cover_slug  — "book-domain{n}" (n clamped to 1..5)
      pages       — list of page dicts; each is either:
                    {"type":"text","lines":[...]}
                    {"type":"diagram_anchor","slug":..., "fallback_text":...}

    Diagram-anchor slugs and indices are byte-for-byte identical to diagrams.json
    (same qualifying rule, same 0-based index within each doc).

    A doc that fails to parse emits a raw_text fallback book and a stderr warning.
    The returned list is in sorted-glob (alphabetical filename) order — deterministic.
    """
    books = []

    for fpath in sorted(DOCS_DIR.glob("*.md")):
        dslug = doc_slug(fpath)
        domain = _book_domain(fpath.stem)
        cover = _cover_slug(domain)
        title_fallback = fpath.stem.replace("-", " ").title()
        # Bind before the try so the except path (which references both) is safe
        # even if read_text() itself raises — never drop a book (Must Not).
        raw_text = ""
        title = title_fallback

        try:
            raw_text = fpath.read_text(encoding="utf-8")
            lines = raw_text.splitlines()

            # Extract title from first H1 heading
            title = title_fallback
            for ln in lines:
                h1 = re.match(r"^#\s+(.*)", ln)
                if h1:
                    title = h1.group(1).rstrip()
                    break

            # Walk lines, tracking fenced blocks (same logic as build_diagrams)
            in_fence = False
            fence_lines = []          # inner lines of current fenced block
            doc_diagram_idx = 0       # 0-based index, incremented only for qualifying blocks
            text_accumulator = []     # flat list of wrapped lines between diagram anchors
            pages = []

            def flush_accumulator():
                nonlocal text_accumulator
                if text_accumulator:
                    pages.extend(paginate_text_lines(text_accumulator))
                    text_accumulator = []

            i = 0
            while i < len(lines):
                line = lines[i]

                if line.strip().startswith("```") and not in_fence:
                    # Opening fence — start collecting inner lines
                    in_fence = True
                    fence_lines = []
                    i += 1
                    continue

                if line.strip().startswith("```") and in_fence:
                    # Closing fence — decide: qualifying diagram or plain text block
                    block = fence_lines  # inner lines, verbatim
                    qualifies = (
                        any(_is_leaf_line(ln) for ln in block)
                        and sum(_is_leaf_line(ln) for ln in block) >= 2
                    )

                    if qualifies:
                        # Flush text accumulator before inserting diagram anchor
                        flush_accumulator()

                        N = doc_diagram_idx + 1
                        slug = f"lib-diagram-{dslug}-{N}"
                        fallback_text = "\n".join(block)
                        pages.append({
                            "type": "diagram_anchor",
                            "slug": slug,
                            "fallback_text": fallback_text,
                        })
                        doc_diagram_idx += 1
                    else:
                        # Non-qualifying block: treat interior as text lines
                        for inner_ln in block:
                            cleaned = clean_text_line(inner_ln)
                            wrapped = wrap_text(cleaned)
                            text_accumulator.extend(wrapped)

                    in_fence = False
                    fence_lines = []
                    i += 1
                    continue

                if in_fence:
                    fence_lines.append(line)
                    i += 1
                    continue

                # Normal (non-fence) line: clean and wrap into accumulator
                cleaned = clean_text_line(line)
                wrapped = wrap_text(cleaned)
                text_accumulator.extend(wrapped)
                i += 1

            # Flush any remaining text
            flush_accumulator()

            # Guarantee at least one page
            if not pages:
                pages.append({"type": "text", "lines": []})

        except Exception as e:
            print(f"WARNING: failed to parse {fpath.name}: {e}", file=sys.stderr)
            # Fallback: raw text capped, or placeholder if even that fails
            try:
                raw_lines = wrap_text(raw_text[:500])
            except Exception:
                raw_lines = ["(content unavailable)"]
            if not raw_lines:
                raw_lines = ["(content unavailable)"]
            pages = [{"type": "text", "lines": raw_lines}]

        books.append({
            "id": dslug,
            "domain": domain,
            "title": title,
            "cover_slug": cover,
            "pages": pages,
        })

    return books


# ---------------------------------------------------------------------------
# Write helpers
# ---------------------------------------------------------------------------


def write_json(name: str, data: list, min_count: int = 10) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{name}.json"
    content = json.dumps(data, sort_keys=True, indent=2, ensure_ascii=False) + "\n"
    out_path.write_text(content, encoding="utf-8")
    print(f"wrote {name}.json ({len(data)} entries)")
    if len(data) < min_count:
        print(
            f"WARNING: {name}.json has only {len(data)} entries (minimum expected {min_count})",
            file=sys.stderr,
        )


# ---------------------------------------------------------------------------
# Validate
# ---------------------------------------------------------------------------

_VALID_DIFFICULTIES = {"easy", "normal", "hard"}
_SLUG_RE = re.compile(r"^lib-diagram-[a-z0-9-]+-\d+$")
_PIECE_SLUG_RE = re.compile(r"^lib-diagram-[a-z0-9-]+-\d+-piece-\d+$")
_COVER_SLUG_RE = re.compile(r"^book-domain[1-5]$")


def validate() -> None:
    """Load the four output files and assert invariants. Print a count summary."""
    errors: list[str] = []

    def load(name: str) -> list:
        path = OUT_DIR / f"{name}.json"
        if not path.exists():
            errors.append(f"{name}.json not found at {path}")
            return []
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)

    pairs = load("pairs")
    cloze = load("cloze")
    diagrams = load("diagrams")
    books = load("books")

    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    # --- pairs ---
    if len(pairs) < 20:
        errors.append(f"pairs: only {len(pairs)} entries (need ≥20)")
    for p in pairs:
        if not p.get("term"):
            errors.append(f"pair {p.get('id')}: empty term")
        if not p.get("definition"):
            errors.append(f"pair {p.get('id')}: empty definition")
        if p.get("domain") not in range(1, 6):
            errors.append(f"pair {p.get('id')}: domain {p.get('domain')} not in 1..5")
        if p.get("difficulty") not in _VALID_DIFFICULTIES:
            errors.append(f"pair {p.get('id')}: difficulty {p.get('difficulty')!r} invalid")

    # --- cloze ---
    if len(cloze) < 20:
        errors.append(f"cloze: only {len(cloze)} entries (need ≥20)")
    for c in cloze:
        tmpl = c.get("template", "")
        if tmpl.count("___") != 1:
            errors.append(f"cloze {c.get('id')}: template has {tmpl.count('___')} blanks (need 1)")
        if not c.get("answer"):
            errors.append(f"cloze {c.get('id')}: empty answer")

    # --- diagrams ---
    if len(diagrams) < 5:
        errors.append(f"diagrams: only {len(diagrams)} entries (need ≥5)")
    for d in diagrams:
        pieces = d.get("pieces", [])
        if len(pieces) < 2:
            errors.append(f"diagram {d.get('id')}: fewer than 2 pieces")
        slug = d.get("slug", "")
        if not _SLUG_RE.match(slug):
            errors.append(f"diagram {d.get('id')}: slug {slug!r} does not match pattern")
        for p in pieces:
            ps = p.get("sprite_slug", "")
            if not _PIECE_SLUG_RE.match(ps):
                errors.append(f"diagram {d.get('id')} piece {p.get('id')}: sprite_slug {ps!r} invalid")

    # --- books ---
    if len(books) != 10:
        errors.append(f"books: expected exactly 10 entries, got {len(books)}")
    for b in books:
        bid = b.get("id", "")
        if not isinstance(bid, str) or not bid:
            errors.append(f"book entry missing non-empty string id: {b}")
        if not isinstance(b.get("domain"), int):
            errors.append(f"book {bid}: domain is not an int")
        btitle = b.get("title", "")
        if not isinstance(btitle, str) or not btitle:
            errors.append(f"book {bid}: empty title")
        cover = b.get("cover_slug", "")
        if not _COVER_SLUG_RE.match(cover):
            errors.append(f"book {bid}: cover_slug {cover!r} does not match ^book-domain[1-5]$")
        bpages = b.get("pages")
        if not isinstance(bpages, list) or len(bpages) == 0:
            errors.append(f"book {bid}: pages must be a non-empty list")
            continue
        for pidx, pg in enumerate(bpages):
            ptype = pg.get("type")
            if ptype not in ("text", "diagram_anchor"):
                errors.append(f"book {bid} page {pidx}: type {ptype!r} not in {{text,diagram_anchor}}")
            elif ptype == "text":
                plines = pg.get("lines")
                if not isinstance(plines, list):
                    errors.append(f"book {bid} page {pidx}: text page missing 'lines' list")
                else:
                    for lno, ln in enumerate(plines):
                        if not isinstance(ln, str):
                            errors.append(f"book {bid} page {pidx} line {lno}: not a string")
                        elif _line_too_long(ln):
                            errors.append(
                                f"book {bid} page {pidx} line {lno}: "
                                f"exceeds PAGE_WIDTH={PAGE_WIDTH}: {ln!r}"
                            )
            elif ptype == "diagram_anchor":
                if not isinstance(pg.get("slug"), str) or not pg.get("slug"):
                    errors.append(f"book {bid} page {pidx}: diagram_anchor missing non-empty slug")
                if not isinstance(pg.get("fallback_text"), str) or not pg.get("fallback_text"):
                    errors.append(f"book {bid} page {pidx}: diagram_anchor missing non-empty fallback_text")

    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    books_ok = len(books)
    print(f"books: {books_ok} OK")
    print(f"pairs: {len(pairs)}, cloze: {len(cloze)}, diagrams: {len(diagrams)}, books: {books_ok}")
    sys.exit(0)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate DATAMON library minigame content banks from docs + quiz bank."
    )
    parser.add_argument("--pairs", action="store_true", help="Generate pairs.json")
    parser.add_argument("--cloze", action="store_true", help="Generate cloze.json")
    parser.add_argument("--diagrams", action="store_true", help="Generate diagrams.json")
    parser.add_argument("--books", action="store_true", help="Generate books.json")
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate on-disk output files and print count summary.",
    )
    args = parser.parse_args()

    # Default: generate all four if no generate flag is set and --validate is not standalone
    generate_any = args.pairs or args.cloze or args.diagrams or args.books
    if not generate_any and not args.validate:
        args.pairs = args.cloze = args.diagrams = args.books = True

    if args.books:
        write_json("books", build_books(), min_count=10)
    if args.pairs:
        write_json("pairs", build_pairs(), min_count=10)
    if args.cloze:
        write_json("cloze", build_cloze(), min_count=10)
    if args.diagrams:
        write_json("diagrams", build_diagrams(), min_count=5)

    if args.validate:
        validate()


if __name__ == "__main__":
    main()
