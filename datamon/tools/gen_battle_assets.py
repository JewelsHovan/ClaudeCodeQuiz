#!/usr/bin/env python3
"""Build deterministic six-state runtime sheets from reviewed AI Battlemon sources.

The accepted 128×128 source sprites are curated outputs of the explicit billable workflow in
`gen_battlemon_ai_sources.py`. This script is offline and byte-deterministic: it validates the
reviewed source batch, derives bounded animation frames with Pillow, validates a sibling
candidate, writes contact sheets, and atomically swaps the public `battlemons/` directory.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageOps

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
SOURCE_DIR = DATAMON / "battlemons-source"
OUT_DIR = DATAMON / "battlemons"
REVIEW_DIR = DATAMON / ".environment-work" / "review"
DOMAIN_ORDER = ("AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT")
MONS = {
    "AGENT": ("Rogue Subagent", "Infinite Loop", "Stop Reason", "Task Spawner", "Orphan Process", "Stale Coordinator", "Fork Bomb"),
    "MCP": ("Schema Mismatch", "Tool Sprawl", "Stdio Zombie", "JSON-RPC Gremlin", "Deprecated SSE", "Scope Creep Server", "isError Imp"),
    "CONFIG": ("Hook Loop", "Permission Prompt", "CLAUDE.md Bloat", "Settings Drift", "Deny Rule", "Headless Hang", "Exit Code 2"),
    "PROMPT": ("Prompt Injector", "XML Tag Soup", "Vague Modifier", "Hallucinator", "Malformed JSON", "Chatty Preamble", "Forced Enum"),
    "CONTEXT": ("Context Rot", "Lost Middle", "Token Gobbler", "Cache Miss", "Compaction Crash", "Rate Limiter", "Stale Summary"),
}
STATES = ("idle-a", "idle-b", "sendout", "attack", "hit", "faint")
FRAME_SIZE = 128
SHEET_SIZE = (FRAME_SIZE * len(STATES), FRAME_SIZE)
BATCH_ID = "classic-battlemon-v2"
PROVENANCE = "reviewed-openrouter-gemini3pro+pillow-animation-v1"
SOURCE_BATCH = "battlemon-ai-sources-v1"
SOURCE_MODEL = "google/gemini-3-pro-image"
BYTE_BUDGET = 2 * 1024 * 1024
DOMAIN_COLORS = {
    "AGENT": (59, 130, 246, 255), "MCP": (168, 85, 247, 255),
    "CONFIG": (34, 197, 94, 255), "PROMPT": (249, 115, 22, 255),
    "CONTEXT": (6, 182, 212, 255),
}
ROOT_KEYS = {
    "schemaVersion", "batch", "reviewState", "provenance", "sourceBatch", "sourceModel",
    "sourceReviewSha256", "format", "layout", "frameCount", "frameWidth", "frameHeight",
    "states", "assetCount", "entries", "batchSha256",
}
ENTRY_KEYS = {
    "id", "name", "domain", "variant", "file", "frameWidth", "frameHeight", "frames",
    "sourceSha256", "sha256", "silhouetteFamily",
}


def stable_id(domain: str, name: str) -> str:
    return domain.lower() + "-" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def canonical_pairs():
    return [(domain, name, variant)
            for domain in DOMAIN_ORDER for variant, name in enumerate(MONS[domain])]


def canonical_ids():
    return [stable_id(domain, name) for domain, name, _ in canonical_pairs()]


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO(); image.save(buffer, "PNG", optimize=False, compress_level=9); return buffer.getvalue()


def _manifest_text(manifest: dict) -> str:
    return json.dumps(manifest, indent=2) + "\n"


def _source_contract() -> tuple[dict, dict[str, dict]]:
    manifest_path = SOURCE_DIR / "manifest.json"
    if not manifest_path.exists():
        raise RuntimeError("Reviewed Battlemon source manifest is missing")
    manifest = json.loads(manifest_path.read_text())
    if (manifest.get("schemaVersion") != 1 or manifest.get("batch") != SOURCE_BATCH or
            manifest.get("reviewState") != "accepted" or manifest.get("model") != SOURCE_MODEL or
            manifest.get("sourceSize") != 128 or not isinstance(manifest.get("entries"), list)):
        raise RuntimeError("Battlemon source batch is not the accepted AI source contract")
    review = manifest.get("review")
    if not isinstance(review, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(review.get("contactSheetSha256", ""))):
        raise RuntimeError("Battlemon source batch lacks a contact-sheet review receipt")
    entries = manifest["entries"]
    expected = canonical_pairs()
    if [entry.get("id") for entry in entries] != canonical_ids():
        raise RuntimeError("Battlemon source taxonomy/order mismatch")
    by_id = {}
    for index, (domain, name, _) in enumerate(expected):
        entry = entries[index]; identifier = stable_id(domain, name)
        path = SOURCE_DIR / (identifier + ".png")
        if (entry.get("name") != name or entry.get("domain") != domain or entry.get("file") != identifier + ".png" or
                not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != entry.get("sourceSha256")):
            raise RuntimeError("Battlemon source declaration/hash mismatch: " + identifier)
        with Image.open(path) as opened:
            if opened.format != "PNG" or opened.mode != "RGBA" or opened.size != (128, 128):
                raise RuntimeError("Battlemon source PNG mismatch: " + identifier)
        by_id[identifier] = entry
    return manifest, by_id


def _compose_scaled(source: Image.Image, width: int, height: int, x: int, bottom: int) -> Image.Image:
    frame = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    resized = source.resize((max(1, width), max(1, height)), Image.Resampling.NEAREST)
    frame.alpha_composite(resized, (x, bottom - resized.height))
    return frame


def _hard_alpha(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA"); alpha = rgba.getchannel("A").point(lambda value: 255 if value >= 128 else 0)
    rgba.putalpha(alpha); return rgba


def animation_frame(source: Image.Image, state: str, domain: str) -> Image.Image:
    """Derive one semantic frame without changing the reviewed creature identity."""
    source = source.convert("RGBA")
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        return Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    body = source.crop(bbox)
    width, height = body.size
    center_x = (128 - width) // 2
    bottom = 124
    if state == "idle-a":
        frame = _compose_scaled(body, width, height, center_x, bottom)
    elif state == "idle-b":
        frame = _compose_scaled(body, width, height, center_x + 1, bottom - 2)
    elif state == "sendout":
        frame = _compose_scaled(body, round(width * 0.78), round(height * 0.82),
                                round((128 - width * 0.78) / 2), bottom)
    elif state == "attack":
        rotated = body.rotate(5, resample=Image.Resampling.NEAREST, expand=True)
        scale = min(116 / rotated.width, 116 / rotated.height, 1.08)
        rw, rh = round(rotated.width * scale), round(rotated.height * scale)
        frame = _compose_scaled(rotated, rw, rh, max(0, (128 - rw) // 2 - 7), bottom - 1)
        draw = ImageDraw.Draw(frame); accent = DOMAIN_COLORS[domain]
        draw.polygon([(2, 57), (21, 49), (15, 58), (31, 58), (8, 74), (13, 63)], fill=accent)
    elif state == "hit":
        bright = ImageEnhance.Brightness(body).enhance(1.18)
        frame = _compose_scaled(bright, width, height, min(128 - width, center_x + 6), bottom)
        draw = ImageDraw.Draw(frame)
        draw.line((5, 24, 25, 34), fill=(248, 250, 252, 255), width=4)
        draw.line((8, 40, 27, 40), fill=(248, 250, 252, 255), width=4)
    elif state == "faint":
        gray = ImageOps.grayscale(body).convert("RGBA")
        gray.putalpha(body.getchannel("A"))
        faint_h = max(20, round(height * 0.58))
        faint_w = min(120, round(width * 1.04))
        frame = _compose_scaled(gray, faint_w, faint_h, (128 - faint_w) // 2, bottom)
        draw = ImageDraw.Draw(frame); face_y = max(45, bottom - faint_h + round(faint_h * 0.43))
        for face_x in (52, 74):
            draw.line((face_x - 4, face_y - 4, face_x + 4, face_y + 4), fill=(17, 24, 39, 255), width=3)
            draw.line((face_x + 4, face_y - 4, face_x - 4, face_y + 4), fill=(17, 24, 39, 255), width=3)
    else:
        raise ValueError("Unknown state: " + state)
    return _hard_alpha(frame)


def build_into(target: Path) -> dict:
    source_manifest, source_entries = _source_contract()
    target = Path(target)
    if target.exists(): shutil.rmtree(target)
    target.mkdir(parents=True)
    entries = []; aggregate = hashlib.sha256()
    for domain, name, variant in canonical_pairs():
        identifier = stable_id(domain, name); source_path = SOURCE_DIR / (identifier + ".png")
        with Image.open(source_path) as opened: source = opened.convert("RGBA")
        sheet = Image.new("RGBA", SHEET_SIZE, (0, 0, 0, 0))
        for frame_index, state in enumerate(STATES):
            sheet.alpha_composite(animation_frame(source, state, domain), (frame_index * 128, 0))
        data = _png_bytes(sheet); (target / (identifier + ".png")).write_bytes(data); aggregate.update(data)
        entries.append({
            "id": identifier, "name": name, "domain": domain, "variant": variant,
            "file": identifier + ".png", "frameWidth": 128, "frameHeight": 128,
            "frames": list(STATES), "sourceSha256": source_entries[identifier]["sourceSha256"],
            "sha256": hashlib.sha256(data).hexdigest(), "silhouetteFamily": domain.lower(),
        })
    manifest = {
        "schemaVersion": 1, "batch": BATCH_ID, "reviewState": "accepted", "provenance": PROVENANCE,
        "sourceBatch": SOURCE_BATCH, "sourceModel": SOURCE_MODEL,
        "sourceReviewSha256": source_manifest["review"]["contactSheetSha256"],
        "format": "RGBA", "layout": "horizontal", "frameCount": 6,
        "frameWidth": 128, "frameHeight": 128, "states": list(STATES),
        "assetCount": 35, "entries": entries, "batchSha256": aggregate.hexdigest(),
    }
    (target / "manifest.json").write_text(_manifest_text(manifest))
    return manifest


def snapshot(directory: Path | None = None) -> dict[str, bytes]:
    root = Path(directory or OUT_DIR)
    return {path.relative_to(root).as_posix(): path.read_bytes()
            for path in sorted(root.rglob("*")) if path.is_file()} if root.exists() else {}


def validate(directory: Path | None = None) -> tuple[list[str], int]:
    output = Path(directory or OUT_DIR); errors = []; manifest_path = output / "manifest.json"
    try: source_manifest, source_entries = _source_contract()
    except Exception as error: return [str(error)], 0
    if not manifest_path.exists(): return ["manifest.json missing"], 0
    manifest_bytes = manifest_path.read_bytes()
    try: manifest = json.loads(manifest_bytes)
    except Exception as error: return [f"invalid manifest JSON: {error}"], 0
    if not isinstance(manifest, dict) or set(manifest) != ROOT_KEYS: errors.append("manifest root schema mismatch")
    if (manifest.get("schemaVersion") != 1 or manifest.get("batch") != BATCH_ID or
        manifest.get("reviewState") != "accepted" or manifest.get("provenance") != PROVENANCE or
        manifest.get("sourceBatch") != SOURCE_BATCH or manifest.get("sourceModel") != SOURCE_MODEL or
        manifest.get("sourceReviewSha256") != source_manifest["review"]["contactSheetSha256"] or
        manifest.get("format") != "RGBA" or manifest.get("layout") != "horizontal"):
        errors.append("manifest identity/source provenance mismatch")
    for key, expected in (("frameCount", 6), ("frameWidth", 128), ("frameHeight", 128), ("assetCount", 35)):
        if type(manifest.get(key)) is not int or manifest.get(key) != expected: errors.append("manifest " + key + " mismatch")
    if manifest.get("states") != list(STATES): errors.append("manifest states/order mismatch")
    if not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get("batchSha256", ""))): errors.append("invalid batchSha256")
    entries = manifest.get("entries")
    if not isinstance(entries, list): return errors + ["manifest entries must be an array"], 0
    if [entry.get("id") if isinstance(entry, dict) else None for entry in entries] != canonical_ids():
        errors.append("manifest IDs/order do not match canonical taxonomy")
    expected_files = {"manifest.json"} | {identifier + ".png" for identifier in canonical_ids()}
    actual_files = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
    for missing in sorted(expected_files - actual_files): errors.append("missing output: " + missing)
    for extra in sorted(actual_files - expected_files): errors.append("unexpected output: " + extra)
    aggregate = hashlib.sha256(); total = 0; source_hashes = set()
    for index, (domain, name, variant) in enumerate(canonical_pairs()):
        if index >= len(entries) or not isinstance(entries[index], dict): continue
        entry = entries[index]; identifier = stable_id(domain, name); path = output / (identifier + ".png")
        if set(entry) != ENTRY_KEYS: errors.append(identifier + ": entry schema mismatch")
        if (entry.get("id") != identifier or entry.get("name") != name or entry.get("domain") != domain or
            entry.get("variant") != variant or entry.get("file") != identifier + ".png" or
            entry.get("frameWidth") != 128 or entry.get("frameHeight") != 128 or
            entry.get("frames") != list(STATES) or entry.get("sourceSha256") != source_entries[identifier]["sourceSha256"] or
            entry.get("silhouetteFamily") != domain.lower()): errors.append(identifier + ": canonical declaration mismatch")
        source_hashes.add(entry.get("sourceSha256"))
        if not path.exists(): continue
        data = path.read_bytes(); total += len(data); aggregate.update(data)
        if hashlib.sha256(data).hexdigest() != entry.get("sha256"): errors.append(identifier + ": hash mismatch")
        try:
            with Image.open(path) as opened:
                opened.load(); image = opened.convert("RGBA")
                if opened.format != "PNG" or opened.mode != "RGBA" or opened.size != SHEET_SIZE:
                    errors.append(identifier + ": sheet PNG contract mismatch")
        except Exception as error: errors.append(f"{identifier}: unreadable sheet: {error}"); continue
        alpha = set(image.getchannel("A").tobytes())
        if not alpha.issubset({0, 255}) or not ({0, 255} <= alpha): errors.append(identifier + ": binary alpha mismatch")
        frames = [image.crop((i * 128, 0, (i + 1) * 128, 128)) for i in range(6)]
        if len({frame.tobytes() for frame in frames}) != 6 or any(frame.getchannel("A").getbbox() is None for frame in frames):
            errors.append(identifier + ": semantic frames are empty/duplicated")
    if len(source_hashes) != 35: errors.append("runtime sheets do not reference 35 distinct reviewed AI sources")
    if manifest.get("batchSha256") != aggregate.hexdigest(): errors.append("aggregate hash mismatch")
    if total > BYTE_BUDGET: errors.append(f"PNG byte budget exceeded: {total} > {BYTE_BUDGET}")
    if manifest_bytes != _manifest_text(manifest).encode(): errors.append("manifest serialization is not canonical")
    return errors, total


def write_contact_sheets(directory: Path | None = None) -> None:
    output = Path(directory or OUT_DIR); REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    color = Image.new("RGBA", (7 * 150, 5 * 164), (5, 10, 18, 255)); draw = ImageDraw.Draw(color)
    for row, domain in enumerate(DOMAIN_ORDER):
        for column, name in enumerate(MONS[domain]):
            identifier = stable_id(domain, name)
            with Image.open(output / (identifier + ".png")) as opened: frame = opened.convert("RGBA").crop((0, 0, 128, 128))
            color.alpha_composite(frame, (column * 150 + 11, row * 164 + 18))
            draw.text((column * 150 + 5, row * 164 + 3), identifier, fill=(232, 223, 200, 255))
    color.save(REVIEW_DIR / "t53-battlemon-codex-color.png", "PNG", optimize=False, compress_level=9)
    ImageOps.grayscale(color).convert("RGB").save(REVIEW_DIR / "t53-battlemon-codex-grayscale.png", "PNG", optimize=False, compress_level=9)
    states = Image.new("RGBA", (6 * 150, 5 * 164), (5, 10, 18, 255)); state_draw = ImageDraw.Draw(states)
    for row, domain in enumerate(DOMAIN_ORDER):
        identifier = stable_id(domain, MONS[domain][0])
        with Image.open(output / (identifier + ".png")) as opened: sheet = opened.convert("RGBA")
        for column, state in enumerate(STATES):
            states.alpha_composite(sheet.crop((column * 128, 0, (column + 1) * 128, 128)), (column * 150 + 11, row * 164 + 18))
            state_draw.text((column * 150 + 5, row * 164 + 3), state.upper(), fill=(232, 223, 200, 255))
    states.save(REVIEW_DIR / "t53-battlemon-states.png", "PNG", optimize=False, compress_level=9)


def build_all() -> dict[str, bytes]:
    OUT_DIR.parent.mkdir(parents=True, exist_ok=True)
    staging = OUT_DIR.parent / ("." + OUT_DIR.name + ".staging")
    backup = OUT_DIR.parent / ("." + OUT_DIR.name + ".backup")
    shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(backup, ignore_errors=True)
    build_into(staging); errors, _ = validate(staging)
    if errors:
        shutil.rmtree(staging, ignore_errors=True)
        raise RuntimeError("Battlemon candidate is invalid:\n" + "\n".join(errors))
    write_contact_sheets(staging)
    had_output = OUT_DIR.exists()
    try:
        if had_output: OUT_DIR.replace(backup)
        staging.replace(OUT_DIR)
    except Exception:
        shutil.rmtree(OUT_DIR, ignore_errors=True)
        if backup.exists(): backup.replace(OUT_DIR)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(backup, ignore_errors=True)
    return snapshot()


def main() -> int:
    validate_only = "--validate" in sys.argv; validate_twice = "--validate-twice" in sys.argv
    if validate_only:
        errors, total = validate()
        if errors:
            for error in errors: print("FAIL: " + error, file=sys.stderr)
            return 1
        print(f"Battlemon assets valid: 35 AI-derived PNGs, {total} bytes."); return 0
    first = build_all(); errors, total = validate()
    if validate_twice:
        second = build_all(); second_errors, total = validate(); errors.extend(second_errors)
        if first != second: errors.append("outputs differ across clean generations")
    if errors:
        for error in errors: print("FAIL: " + error, file=sys.stderr)
        return 1
    manifest = json.loads((OUT_DIR / "manifest.json").read_text())
    print(f"Battlemon assets valid{' twice' if validate_twice else ''}: 35 AI-derived PNGs, {total} bytes, batch SHA-256 {manifest['batchSha256']}.")
    print("Review: " + str(REVIEW_DIR / "t53-battlemon-codex-color.png")); return 0


if __name__ == "__main__":
    raise SystemExit(main())
