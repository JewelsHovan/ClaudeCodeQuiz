#!/usr/bin/env python3
"""Opt-in AI concept generation + deterministic source-sprite preparation for Battlemon.

`--generate` is the only network/billable path. It uses the exact OpenRouter model recorded
below, enforces a per-run spend cap, and writes full-resolution responses only to ignored
`datamon/.battlemon-ai-raw/`. `--pipeline-only` is offline and deterministically promotes
those raw images into compact tracked source sprites. `--accept CONTACT_SHEET_SHA` records a
human review tied to the exact ignored contact sheet; the public sheet generator accepts only
that reviewed source manifest.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shutil
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
RAW_DIR = DATAMON / ".battlemon-ai-raw"
SOURCE_DIR = DATAMON / "battlemons-source"
REVIEW_DIR = DATAMON / ".environment-work" / "review"
MODEL = "google/gemini-3-pro-image"
PROVIDER = "openrouter"
SOURCE_PROVENANCE = "openrouter:google/gemini-3-pro-image+deterministic-pillow-v1"
SOURCE_SIZE = 128
RESERVED_COST_PER_IMAGE = 0.16
DOMAIN_ORDER = ("AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT")
MONS = {
    "AGENT": ("Rogue Subagent", "Infinite Loop", "Stop Reason", "Task Spawner", "Orphan Process", "Stale Coordinator", "Fork Bomb"),
    "MCP": ("Schema Mismatch", "Tool Sprawl", "Stdio Zombie", "JSON-RPC Gremlin", "Deprecated SSE", "Scope Creep Server", "isError Imp"),
    "CONFIG": ("Hook Loop", "Permission Prompt", "CLAUDE.md Bloat", "Settings Drift", "Deny Rule", "Headless Hang", "Exit Code 2"),
    "PROMPT": ("Prompt Injector", "XML Tag Soup", "Vague Modifier", "Hallucinator", "Malformed JSON", "Chatty Preamble", "Forced Enum"),
    "CONTEXT": ("Context Rot", "Lost Middle", "Token Gobbler", "Cache Miss", "Compaction Crash", "Rate Limiter", "Stale Summary"),
}
PILOTS = {
    "AGENT": "agent-rogue-subagent", "MCP": "mcp-schema-mismatch",
    "CONFIG": "config-hook-loop", "PROMPT": "prompt-prompt-injector",
    "CONTEXT": "context-context-rot",
}
PALETTES = {
    "AGENT": "cobalt-blue primary body, electric-cyan signal lights, dark navy outline, and one tiny amber alert mark",
    "MCP": "violet primary body, mint connector accents, dark navy outline, and one tiny amber warning mark",
    "CONFIG": "emerald primary armor, brass control details, dark navy outline, and one restrained coral status accent",
    "PROMPT": "burnt-orange primary body, warm ivory planes, dark navy outline, and one restrained teal syntax accent",
    "CONTEXT": "cyan primary body, deep navy memory plates, dark navy outline, and one restrained rose cache accent",
}
DESIGNS = {
    "agent-rogue-subagent": "a compact signal-fox drone with a pointed mask head, antenna ears, one orbit-node shoulder that remains physically connected, quick mechanical paws, and a forked data-stream tail",
    "agent-infinite-loop": "an agile ouroboros monitor-lizard whose long cable tail loops cleanly through a ring on its back, with repeating signal fins and bright focused eyes",
    "agent-stop-reason": "a stout sentinel beetle with an octagonal shield carapace, two decisive brake-claw forelegs, compact antennae, and a low immovable stance; use shape only, no stop-sign text",
    "agent-task-spawner": "a scheduler spider-drone with one central face/core, six readable legs, and three small node pods physically attached along its abdomen like queued tasks; still one creature",
    "agent-orphan-process": "a wistful but battle-ready ghost-hound process with a clearly severed tether plug at the end of one tail, hollow signal ears, and a drifting lower silhouette that stays connected",
    "agent-stale-coordinator": "a clockwork dispatch owl with a frozen baton wing, offset dial feathers, a small hourglass chest, and stern luminous eyes; no numerals or text",
    "agent-fork-bomb": "a branching ram-porcupine with forked circuit horns, duplicated quill branches, sturdy hooves, and an explosive compact silhouette",
    "mcp-schema-mismatch": "a compact port imp with a square protocol-core body, two plug-prong horns, visibly mismatched connector claws, a loose cable tail, and bright alert eyes",
    "mcp-tool-sprawl": "a many-tool adapter crab with one cohesive shell body, four differently shaped but attached tool claws, socket eyes, and a bundled cable tail; readable rather than cluttered",
    "mcp-stdio-zombie": "an undead terminal toad with a pipe-shaped mouth, one input hose and one output hose, sleepy luminous eyes, and a hunched connected silhouette; no terminal text",
    "mcp-json-rpc-gremlin": "a curly-braced gremlin suggested through hooked ear shapes, holding two attached request/response orb cuffs, with a mischievous bilateral silhouette; no literal braces or letters",
    "mcp-deprecated-sse": "a leaky stream eel with a broken broadcast antenna fin, segmented connector scales, a drooping event-stream tail, and one obsolete-looking plug crest",
    "mcp-scope-creep-server": "an expanding server-snail with a compact rack-shell that sprouts two extra attached bays, sturdy little feet, and one probing cable eyestalk; one creature only",
    "mcp-iserror-imp": "a sharp warning-diamond imp with reversible mask-like eyes, two validation claws, a kinked error tail, and a compact triangular silhouette; no punctuation or text",
    "config-hook-loop": "a low armored config tortoise with a circular hook tail that reconnects to its shell, keyed dorsal tabs, sturdy feet, and a focused monitor-like face",
    "config-permission-prompt": "a gatekeeper armadillo with a keyhole-shaped negative space in its attached shield shell, two approval stamp paws, and alert guarded eyes; no text",
    "config-claude-md-bloat": "an overstuffed paper-puffer beast with a book-like layered body, too many attached folded page fins, tiny feet, and a determined face; blank pages only, no lettering",
    "config-settings-drift": "a compass crab with two misaligned dial claws, an off-center calibration crest, six stable legs, and a visibly skewed but cohesive instrument shell; no numbers",
    "config-deny-rule": "a compact barrier bulldog-ram with a red crossbar brow, blocky shield shoulders, planted paws, and an unyielding forward stance; no words or sign icon",
    "config-headless-hang": "a cute eerie floating automation suit with its small luminous core suspended below an empty collar, dangling cable arms, an attached hourglass charm, and no severed gore",
    "config-exit-code-2": "a two-tailed emergency gecko with paired route-arrow fins implied by silhouette, two bright status eyes, spring-loaded feet, and a compact ready-to-exit pose; no numeral or text",
    "prompt-prompt-injector": "an origami needle-beak bird with one sharp insertion quill, folded command wings, a ribbon tail, and clever focused eyes; magical-tech rather than medical",
    "prompt-xml-tag-soup": "a cauldron-shell crab whose two hooked bracket-like claws stir attached ribbon noodles, with a round cohesive body and expressive eyes; no literal markup or text",
    "prompt-vague-modifier": "a fog chameleon with a crisp core body but softly stepped cloud fins, an uncertain forked tail, shifting eyebrow plates, and a readable low silhouette",
    "prompt-hallucinator": "a mirage moth with large angular wings containing false-eye geometric spots, a small real face, antennae, and a shimmering but hard-edged connected silhouette",
    "prompt-malformed-json": "a fractured syntax golem with mismatched interlocking armor halves, comma-like ear fins suggested only by shape, one offset hand, and a sturdy original silhouette; no literal characters",
    "prompt-chatty-preamble": "a confident speaker-parrot with an extravagantly long but attached ribbon tongue, layered speech-feather chest, expressive eyes, and compact feet; no speech bubbles or text",
    "prompt-forced-enum": "a locked four-faced die beetle with four rigid choice fins, a clasped shell, symmetrical clamp legs, and one stubborn face; no pips, numbers, letters, or UI",
    "context-context-rot": "a memory manta with broad cyan wings, three stacked dark memory-window plates on its back, a frayed cache tail, and a few worn rose pixels; still alert and battle-ready",
    "context-lost-middle": "a long archive bookworm whose body visibly skips through a central portal gap bridged by one thin connected memory thread, with clear head and tail segments; no book text",
    "context-token-gobbler": "a hungry token pelican-hippo with a large pouch mouth holding attached blank square tiles, tiny eager wings, sturdy feet, and a funny greedy expression",
    "context-cache-miss": "a quick cache squirrel with an empty open basket-shell attached to its back, a question-shaped curled tail suggested only by silhouette, and searching luminous eyes; no punctuation",
    "context-compaction-crash": "a compressed accordion armadillo with visibly squashed layered memory plates, one bent antenna, braced feet, and a resilient flattened silhouette",
    "context-rate-limiter": "an hourglass snail with a narrow waist shell, a gate-bar tail, measured eyestalks, and deliberate little feet; no numbers, clocks, or text",
    "context-stale-summary": "a dusty scroll owl with layered blank summary-feather tabs, faded rose edge markers, a drooping bookmark tail, and wise tired eyes; no writing",
}
ROOT_KEYS = {"schemaVersion", "batch", "reviewState", "review", "provider", "model", "provenance", "sourceSize", "entries"}
ENTRY_KEYS = {"id", "name", "domain", "file", "promptSha256", "rawSha256", "sourceSha256", "width", "height"}
_lock = threading.Lock()


def stable_id(domain: str, name: str) -> str:
    return domain.lower() + "-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def canonical_pairs():
    return [(domain, name, stable_id(domain, name)) for domain in DOMAIN_ORDER for name in MONS[domain]]


def prompt_for(domain: str, name: str, identifier: str, has_reference: bool) -> str:
    reference = ("Match ONLY the supplied reference image's polished pixel technique, outline weight, cluster density, and friendly professional proportions. "
                 "Do not copy its anatomy, body plan, face, limbs, props, or silhouette. " if has_reference else "")
    return f"""Create exactly ONE original DATAMON battle creature sprite named {name}. It embodies a failure mode in {domain} certification work: {DESIGNS[identifier]}.\n{reference}ART DIRECTION: polished late-16-bit handheld RPG pixel art, game-ready creature sprite, crisp intentional square pixel clusters, hard stepped edges, restrained 12-to-16-color palette, {PALETTES[domain]}. Cute, clever, professional, and unmistakable at 64x64 scale. Strong color-independent silhouette. Original design; do not imitate or include any existing game character.\nCOMPOSITION: one complete creature only, centered, full silhouette visible with generous padding, facing slightly left in a confident battle stance. Flat solid chroma magenta #ff00ff across the entire background including every gap. No transparency, floor, cast shadow, glow, scenery, frame, grid, labels, letters, words, UI, extra creature, detached effects, or sprite sheet."""


def _data_reference(path: Path) -> dict:
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": "data:image/png;base64," + data}}


def _request_image(prompt: str, reference: Path | None) -> tuple[bytes, dict]:
    payload = {"model": MODEL, "prompt": prompt, "n": 1, "resolution": "1K", "aspect_ratio": "1:1"}
    if reference is not None:
        payload["input_references"] = [_data_reference(reference)]
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/images", data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"], "Content-Type": "application/json",
                 "HTTP-Referer": "https://github.com/JewelsHovan/ClaudeCodeQuiz", "X-Title": "DATAMON Battlemon assets"},
    )
    started = time.time()
    last_error = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                result = json.load(response)
            item = result.get("data", [None])[0] or {}
            encoded = item.get("b64_json")
            if not encoded:
                raise RuntimeError("OpenRouter returned no image bytes")
            return base64.b64decode(encoded), {
                "usage": result.get("usage") or {}, "seconds": round(time.time() - started, 2),
            }
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:1200]
            last_error = RuntimeError(f"OpenRouter HTTP {error.code}: {detail}")
            if error.code < 500 and error.code != 429:
                break
        except Exception as error:  # transient transport/provider failure
            last_error = error
        time.sleep(2 ** attempt)
    raise RuntimeError(str(last_error))


def generate_raw(only: set[str] | None, missing_only: bool, max_spend: float, concurrency: int) -> dict:
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise RuntimeError("OPENROUTER_API_KEY is required for --generate")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    ledger_path = RAW_DIR / "generation-ledger.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {"model": MODEL, "entries": {}}
    session_cost = 0.0
    results = {}

    def candidates(stage: str):
        rows = []
        for domain, name, identifier in canonical_pairs():
            is_pilot = identifier == PILOTS[domain]
            if stage == "anchor" and identifier != "mcp-schema-mismatch":
                continue
            if stage == "pilots" and (not is_pilot or identifier == "mcp-schema-mismatch"):
                continue
            if stage == "species" and is_pilot:
                continue
            if only and identifier not in only:
                continue
            if missing_only and (RAW_DIR / (identifier + ".png")).exists():
                continue
            reference_id = None if stage == "anchor" else (
                "mcp-schema-mismatch" if stage == "pilots" else PILOTS[domain]
            )
            reference = RAW_DIR / (reference_id + ".png") if reference_id else None
            if reference is not None and not reference.exists():
                raise RuntimeError(f"Missing style pilot before {identifier}: {reference}")
            rows.append((domain, name, identifier, reference))
        return rows

    def run_one(row):
        domain, name, identifier, reference = row
        prompt = prompt_for(domain, name, identifier, reference is not None)
        raw, meta = _request_image(prompt, reference)
        return row, prompt, raw, meta

    # Bootstrap in three bounded barriers so a clean raw directory first creates the MCP
    # style anchor, then four domain pilots, then the remaining 30 referenced species.
    for stage in ("anchor", "pilots", "species"):
        rows = candidates(stage)
        if not rows:
            continue
        reserved_cost = len(rows) * RESERVED_COST_PER_IMAGE
        if session_cost + reserved_cost > max_spend + 1e-9:
            raise RuntimeError(
                f"Refusing generation: ${reserved_cost:.2f} reserved for {len(rows)} images would exceed "
                f"the explicit ${max_spend:.2f} session cap"
            )
        with ThreadPoolExecutor(max_workers=max(1, min(concurrency, 4))) as pool:
            futures = [pool.submit(run_one, row) for row in rows]
            for future in as_completed(futures):
                row, prompt, raw, meta = future.result()
                domain, name, identifier, reference = row
                raw_cost = (meta["usage"] or {}).get("cost")
                if isinstance(raw_cost, bool) or not isinstance(raw_cost, (int, float)) or raw_cost <= 0:
                    raise RuntimeError("OpenRouter response omitted a positive numeric usage.cost; stopping fail-closed")
                cost = float(raw_cost)
                with _lock:
                    session_cost += cost
                    if session_cost > max_spend:
                        raise RuntimeError(f"Generation spend ${session_cost:.4f} exceeded cap ${max_spend:.2f}")
                    path = RAW_DIR / (identifier + ".png")
                    path.write_bytes(raw)
                    record = {
                        "id": identifier, "domain": domain, "name": name, "model": MODEL,
                        "reference": reference.stem if reference else None,
                        "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                        "rawSha256": hashlib.sha256(raw).hexdigest(),
                        "cost": cost, "seconds": meta["seconds"], "usage": meta["usage"],
                    }
                    ledger["entries"][identifier] = record
                    results[identifier] = record
                    ledger_path.write_text(json.dumps(ledger, indent=2) + "\n")
                    print(f"generated {identifier}: ${cost:.4f}, session ${session_cost:.4f}")
    return {"generated": len(results), "sessionCost": session_cost, "model": MODEL}


def _background_pixel(pixel) -> bool:
    r, g, b, _ = pixel
    # Providers sometimes shade requested #ff00ff toward a darker pink gradient.
    # Flood connectivity from the image edge prevents similarly hued creature accents
    # behind their dark outline from being removed.
    return r >= 120 and b >= 100 and g <= 140 and r + b - 2 * g >= 160


def _key_connected_background(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load(); width, height = rgba.size
    queue = deque(); seen = set()
    for x in range(width):
        for y in (0, height - 1):
            if _background_pixel(pixels[x, y]): queue.append((x, y)); seen.add((x, y))
    for y in range(height):
        for x in (0, width - 1):
            if _background_pixel(pixels[x, y]): queue.append((x, y)); seen.add((x, y))
    while queue:
        x, y = queue.popleft(); r, g, b, _ = pixels[x, y]; pixels[x, y] = (r, g, b, 0)
        for nx, ny in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
            if 0 <= nx < width and 0 <= ny < height and (nx, ny) not in seen and _background_pixel(pixels[nx, ny]):
                seen.add((nx, ny)); queue.append((nx, ny))
    return rgba


def _keep_largest_component(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA"); width, height = rgba.size; pixels = rgba.load()
    solid = {(x, y) for y in range(height) for x in range(width) if pixels[x, y][3] >= 128}
    components = []
    while solid:
        start = solid.pop(); component = {start}; queue = [start]
        while queue:
            x, y = queue.pop()
            for point in ((x+1,y),(x-1,y),(x,y+1),(x,y-1)):
                if point in solid: solid.remove(point); component.add(point); queue.append(point)
        components.append(component)
    if not components:
        return Image.new("RGBA", rgba.size)
    keep = max(components, key=len)
    for y in range(height):
        for x in range(width):
            if (x, y) not in keep: pixels[x, y] = (0, 0, 0, 0)
            elif pixels[x, y][3] < 128: pixels[x, y] = (0, 0, 0, 0)
            else: pixels[x, y] = (*pixels[x, y][:3], 255)
    return rgba


def process_raw(raw_path: Path) -> Image.Image:
    with Image.open(raw_path) as opened:
        image = opened.convert("RGBA")
    # The providers return 1K square PNGs. A nearest preflight reduction keeps their
    # intentional pixel clusters while bounding flood-fill/component memory to 256².
    if image.size != (256, 256): image = image.resize((256, 256), Image.Resampling.NEAREST)
    image = _keep_largest_component(_key_connected_background(image))
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError(f"No keyed creature silhouette: {raw_path}")
    image = image.crop(bbox)
    scale = min(120 / image.width, 120 / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    image = image.resize(size, Image.Resampling.NEAREST)
    alpha = image.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    quantized = image.convert("RGB").quantize(colors=24, method=Image.Quantize.FASTOCTREE,
                                                dither=Image.Dither.NONE).convert("RGBA")
    quantized.putalpha(alpha)
    output = Image.new("RGBA", (SOURCE_SIZE, SOURCE_SIZE), (0, 0, 0, 0))
    output.alpha_composite(quantized, ((SOURCE_SIZE - image.width) // 2, SOURCE_SIZE - 4 - image.height))
    return output


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO(); image.save(buffer, "PNG", optimize=False, compress_level=9); return buffer.getvalue()


def build_sources(review_state: str = "pending", review: dict | None = None) -> dict:
    if review_state not in ("pending", "accepted"):
        raise ValueError("review_state must be pending or accepted")
    ledger_path = RAW_DIR / "generation-ledger.json"
    ledger = json.loads(ledger_path.read_text()) if ledger_path.exists() else {"entries": {}}
    staging = SOURCE_DIR.parent / ("." + SOURCE_DIR.name + ".staging")
    backup = SOURCE_DIR.parent / ("." + SOURCE_DIR.name + ".backup")
    shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(backup, ignore_errors=True); staging.mkdir(parents=True)
    entries = []
    for domain, name, identifier in canonical_pairs():
        raw_path = RAW_DIR / (identifier + ".png")
        if not raw_path.exists():
            raise FileNotFoundError(f"Missing AI raw source: {raw_path}")
        prompt = prompt_for(domain, name, identifier, identifier != "mcp-schema-mismatch")
        record = ledger.get("entries", {}).get(identifier)
        raw = raw_path.read_bytes()
        expected_reference = None if identifier == "mcp-schema-mismatch" else (
            "mcp-schema-mismatch" if identifier == PILOTS[domain] else PILOTS[domain]
        )
        expected_prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()
        expected_raw_hash = hashlib.sha256(raw).hexdigest()
        if (not isinstance(record, dict) or record.get("id") != identifier or record.get("domain") != domain or
                record.get("name") != name or record.get("model") != MODEL or
                record.get("reference") != expected_reference or record.get("promptSha256") != expected_prompt_hash or
                record.get("rawSha256") != expected_raw_hash):
            raise RuntimeError(f"Generation ledger provenance mismatch: {identifier}")
        source = _png_bytes(process_raw(raw_path))
        (staging / (identifier + ".png")).write_bytes(source)
        entries.append({
            "id": identifier, "name": name, "domain": domain, "file": identifier + ".png",
            "promptSha256": expected_prompt_hash,
            "rawSha256": expected_raw_hash, "sourceSha256": hashlib.sha256(source).hexdigest(),
            "width": SOURCE_SIZE, "height": SOURCE_SIZE,
        })
    manifest = {
        "schemaVersion": 1, "batch": "battlemon-ai-sources-v1", "reviewState": review_state,
        "review": review, "provider": PROVIDER, "model": MODEL, "provenance": SOURCE_PROVENANCE,
        "sourceSize": SOURCE_SIZE, "entries": entries,
    }
    (staging / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    errors = validate_sources(staging, require_accepted=False)
    if errors:
        shutil.rmtree(staging, ignore_errors=True)
        raise RuntimeError("Invalid Battlemon source candidate:\n" + "\n".join(errors))
    had_output = SOURCE_DIR.exists()
    try:
        if had_output: SOURCE_DIR.replace(backup)
        staging.replace(SOURCE_DIR)
    except Exception:
        shutil.rmtree(SOURCE_DIR, ignore_errors=True)
        if backup.exists(): backup.replace(SOURCE_DIR)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(backup, ignore_errors=True)
    write_contact_sheet()
    return manifest


def render_contact_sheet(directory: Path | None = None) -> tuple[Image.Image, Image.Image]:
    source_root = Path(directory or SOURCE_DIR)
    sheet = Image.new("RGBA", (7 * 150, 5 * 164), (5, 10, 18, 255)); draw = ImageDraw.Draw(sheet)
    for row, domain in enumerate(DOMAIN_ORDER):
        for column, name in enumerate(MONS[domain]):
            identifier = stable_id(domain, name)
            with Image.open(source_root / (identifier + ".png")) as opened: image = opened.convert("RGBA")
            x, y = column * 150 + 11, row * 164 + 18; sheet.alpha_composite(image, (x, y))
            draw.text((column * 150 + 5, row * 164 + 3), identifier, fill=(232, 223, 200, 255))
    return sheet, ImageOps.grayscale(sheet).convert("RGB")


def write_contact_sheet() -> Path:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    sheet, grayscale = render_contact_sheet()
    path = REVIEW_DIR / "t53-battlemon-ai-sources.png"
    path.write_bytes(_png_bytes(sheet))
    grayscale.save(REVIEW_DIR / "t53-battlemon-ai-sources-grayscale.png", "PNG", optimize=False, compress_level=9)
    return path


def validate_sources(directory: Path | None = None, require_accepted: bool = True) -> list[str]:
    output = Path(directory or SOURCE_DIR); errors = []; manifest_path = output / "manifest.json"
    if not manifest_path.exists(): return ["source manifest missing"]
    try: manifest = json.loads(manifest_path.read_text())
    except Exception as error: return [f"invalid source manifest: {error}"]
    if not isinstance(manifest, dict) or set(manifest) != ROOT_KEYS: errors.append("source manifest root schema mismatch")
    if (manifest.get("schemaVersion") != 1 or manifest.get("batch") != "battlemon-ai-sources-v1" or
        manifest.get("provider") != PROVIDER or manifest.get("model") != MODEL or
        manifest.get("provenance") != SOURCE_PROVENANCE or manifest.get("sourceSize") != 128):
        errors.append("source manifest identity mismatch")
    if require_accepted and manifest.get("reviewState") != "accepted": errors.append("source batch is not accepted")
    if manifest.get("reviewState") == "accepted":
        review = manifest.get("review")
        if (not isinstance(review, dict) or review.get("reviewed") is not True or
                not re.fullmatch(r"[0-9a-f]{64}", str(review.get("contactSheetSha256", "")))):
            errors.append("accepted source batch lacks contact-sheet review hash")
        else:
            try:
                actual_review_hash = hashlib.sha256(_png_bytes(render_contact_sheet(output)[0])).hexdigest()
                if actual_review_hash != review["contactSheetSha256"]:
                    errors.append("accepted source review hash does not match current contact sheet")
            except Exception as error:
                errors.append(f"accepted source review cannot be reconstructed: {error}")
    entries = manifest.get("entries")
    if not isinstance(entries, list): return errors + ["source entries must be an array"]
    expected = canonical_pairs(); actual_ids = [entry.get("id") if isinstance(entry, dict) else None for entry in entries]
    if actual_ids != [identifier for _, _, identifier in expected]: errors.append("source taxonomy/order mismatch")
    expected_files = {"manifest.json"} | {identifier + ".png" for _, _, identifier in expected}
    actual_files = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
    for extra in sorted(actual_files - expected_files): errors.append("unexpected source output: " + extra)
    for missing in sorted(expected_files - actual_files): errors.append("missing source output: " + missing)
    for index, (domain, name, identifier) in enumerate(expected):
        if index >= len(entries) or not isinstance(entries[index], dict): continue
        entry = entries[index]
        if set(entry) != ENTRY_KEYS: errors.append(identifier + ": source entry schema mismatch")
        if (entry.get("id") != identifier or entry.get("name") != name or entry.get("domain") != domain or
            entry.get("file") != identifier + ".png" or entry.get("width") != 128 or entry.get("height") != 128):
            errors.append(identifier + ": source declaration mismatch")
        for field in ("promptSha256", "rawSha256", "sourceSha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", str(entry.get(field, ""))): errors.append(identifier + f": invalid {field}")
        expected_prompt_hash = hashlib.sha256(
            prompt_for(domain, name, identifier, identifier != "mcp-schema-mismatch").encode()
        ).hexdigest()
        if entry.get("promptSha256") != expected_prompt_hash:
            errors.append(identifier + ": prompt provenance mismatch")
        path = output / (identifier + ".png")
        if not path.exists(): continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry.get("sourceSha256"): errors.append(identifier + ": source hash mismatch")
        try:
            with Image.open(path) as opened:
                opened.load(); image = opened.convert("RGBA")
                if opened.format != "PNG" or opened.mode != "RGBA" or opened.size != (128, 128): errors.append(identifier + ": source PNG contract mismatch")
        except Exception as error: errors.append(f"{identifier}: unreadable source: {error}"); continue
        alpha = set(image.getchannel("A").tobytes())
        if not alpha.issubset({0, 255}) or not ({0, 255} <= alpha): errors.append(identifier + ": source binary alpha mismatch")
        if image.getcolors(maxcolors=33) is None: errors.append(identifier + ": source exceeds 32 colors")
    return errors


def accept_sources(expected_sha: str) -> None:
    contact = write_contact_sheet(); actual = hashlib.sha256(contact.read_bytes()).hexdigest()
    if expected_sha != actual: raise RuntimeError(f"Contact-sheet SHA mismatch: expected {expected_sha}, actual {actual}")
    manifest_path = SOURCE_DIR / "manifest.json"; manifest = json.loads(manifest_path.read_text())
    manifest["reviewState"] = "accepted"; manifest["review"] = {"contactSheetSha256": actual, "reviewed": True}
    temporary = manifest_path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(manifest_path)
    errors = validate_sources()
    if errors: raise RuntimeError("Accepted source validation failed:\n" + "\n".join(errors))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--missing", action="store_true")
    parser.add_argument("--only", default="")
    parser.add_argument("--max-spend", type=float, default=6.0)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--pipeline-only", action="store_true")
    parser.add_argument("--accept", metavar="CONTACT_SHEET_SHA")
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    only = {value.strip() for value in args.only.split(",") if value.strip()} or None
    if args.generate:
        print(json.dumps(generate_raw(only, args.missing, args.max_spend, args.concurrency), indent=2))
    if args.pipeline_only:
        build_sources(); path = write_contact_sheet()
        print(f"Pending review: {path}")
        print("Contact sheet SHA-256: " + hashlib.sha256(path.read_bytes()).hexdigest())
    if args.accept: accept_sources(args.accept); print("Battlemon AI source batch accepted.")
    if args.validate:
        errors = validate_sources()
        if errors:
            for error in errors: print("FAIL: " + error)
            return 1
        print("Battlemon AI source batch valid: 35 reviewed 128x128 PNGs.")
    if not any((args.generate, args.pipeline_only, args.accept, args.validate)):
        parser.print_help()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
