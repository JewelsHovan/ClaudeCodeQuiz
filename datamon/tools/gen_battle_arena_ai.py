#!/usr/bin/env python3
"""Explicit AI generation and fail-closed promotion for classic DATAMON arenas.

`--generate` is the only network/billable path. Provider responses, generated images, and the
append-only authorization ledger stay in ignored `.battle-arena-ai-raw/`. `--pipeline-only`
builds a review candidate without touching the accepted runtime batch. `--accept` verifies the
candidate and both review sheets before one rollback-safe atomic promotion.
"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
import math
import os
import re
import shutil
import tempfile
import time
import urllib.error
import urllib.request
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageOps, ImageStat

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
RAW_DIR = DATAMON / ".battle-arena-ai-raw"
OUT_DIR = DATAMON / "battle-arenas"
REVIEW_DIR = DATAMON / ".environment-work" / "review"
PROVIDER = "openrouter"
MODEL = "openai/gpt-5.4-image-2"
PROVENANCE = "openrouter:openai/gpt-5.4-image-2+deterministic-pillow-arena-v1"
BATCH = "classic-domain-arenas-v1"
DOMAINS = ("AGENT", "MCP", "CONFIG", "PROMPT", "CONTEXT")
WIDTH, HEIGHT = 1600, 864
PALETTE_MAX = 256
CURRENT_PROMPT_VERSION = 2
RESERVED_COST_PER_IMAGE = 0.30
DEFAULT_MAX_SPEND = 2.0
DEFAULT_CONCURRENCY = 2
AUTHORIZATION_CAP_USD = 50
# Successful art spend before ticket #055 arena generation: #053 plus the #055 shootout.
PRIOR_ART_SPEND_USD = 5.917484
ROOT_KEYS = {
    "schemaVersion", "batch", "reviewState", "review", "provider", "model", "provenance",
    "width", "height", "format", "paletteMax", "assetCount", "domains", "entries",
    "batchSha256", "authorizationCapUsd", "priorArtSpendUsd", "generationCostUsd",
    "authorizationSpendUsd",
}
REVIEW_KEYS = {"contactSheetSha256", "grayscaleContactSheetSha256", "reviewed"}
ENTRY_KEYS = {
    "id", "domain", "file", "promptVersion", "promptSha256", "referenceSha256",
    "rawSha256", "costUsd", "sha256", "width", "height",
}

# Version 1 is retained byte-for-byte as provenance for the accepted batch. Version 2 removes
# its contradictory request for background technicians; future candidates must be people-free.
MCP_ANCHOR_PROMPT_V1 = '''Create a production-ready BACKGROUND-ONLY pixel-art asset for DATAMON's MCP certification battle arena, using the supplied visual-direction mockup only for architecture, palette, camera, depth, and craftsmanship.

Remove every person, trainer, creature, portrait, HUD panel, dialogue box, button, label, letter, number, and readable symbol. Do not bake any gameplay UI into the image. Leave clean architectural breathing room where overlays will be drawn.

CAMERA AND GAME GEOMETRY: straight-on three-quarter interior view for an 800×432 logical stage, not isometric and not top-down. Reserve an empty grounded near platform at logical (160,398) for a large player trainer, an empty far platform at (657,252) for a smaller rival trainer, and an empty central-right projection plinth centered near (500,250) for a 128px creature. Keep the top-left wall region quiet enough for one compact status module. Keep the bottom-right edge visually quiet for a compact player HP module. Nothing important may be cut by the lower stage boundary at y=432.

ENVIRONMENT: an inhabited Claude Code certification incident-command theater inside a premium creative consultancy campus. Model Context Protocol identity appears through connected port machinery, tool-channel cable paths, schema-grid glass, server bays, technicians as extremely subtle abstract silhouettes only behind distant glass (no identifiable people), and violet/mint signal routing. A grounded circular-but-not-ring-shaped projector pedestal gives the intro a focal beacon before materialization. It must not resemble the rejected empty concentric neon circles.

ART: original polished late-16-bit handheld RPG pixel art; crisp intentional square clusters, hard stepped edges, tactile metal and walnut, luminous violet/mint/amber accents, enough midtone contrast to feel alive, no smooth 3D render, no fake scanline overlay, no blur, no gradients pretending to be pixel art. Strong near/mid/far depth. No franchise imitation.

Output one clean landscape environment image only. No frame or border around the image.'''

MCP_ANCHOR_PROMPT_V2 = MCP_ANCHOR_PROMPT_V1.replace(
    "technicians as extremely subtle abstract silhouettes only behind distant glass (no identifiable people), and ", ""
)

DOMAIN_DIRECTIONS = {
    "AGENT": """Retheme the supplied accepted arena into an AGENT OPERATIONS synthesis theater while preserving the exact camera, empty near/far platform positions, projector position, safe zones, material density, and pixel technique. Use cobalt/cyan task-graph conduits, branching coordinator nodes, bounded worker bays, and amber handoff signals. Architecture only: no people, creatures, text, letters, numbers, UI, portraits, icons, logos, or readable symbols.""",
    "CONFIG": """Retheme the supplied accepted arena into a CONFIGURATION assurance vault while preserving the exact camera, empty near/far platform positions, projector position, safe zones, material density, and pixel technique. Use emerald/amber policy conduits, layered permission gates, secure switchboards, hook-routing rails, and warm brass/walnut details. Architecture only: no people, creatures, text, letters, numbers, UI, portraits, icons, logos, or readable symbols.""",
    "PROMPT": """Retheme the supplied accepted arena into a PROMPT composition studio while preserving the exact camera, empty near/far platform positions, projector position, safe zones, material density, and pixel technique. Use coral/orange/rose signal ribbons, folded geometric acoustic panels, blank composition slates, controlled waveform lighting, and warm creative-workshop materials. Architecture only: no people, creatures, text, letters, numbers, UI, portraits, icons, logos, or readable symbols.""",
    "CONTEXT": """Retheme the supplied accepted arena into a CONTEXT memory observatory while preserving the exact camera, empty near/far platform positions, projector position, safe zones, material density, and pixel technique. Use cyan/indigo cache conduits, layered archive windows, bounded memory banks, compaction channels, and subtle rose recency markers. Architecture only: no people, creatures, text, letters, numbers, UI, portraits, icons, logos, or readable symbols.""",
}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO(); image.save(buffer, "PNG", optimize=False, compress_level=9); return buffer.getvalue()


def _manifest_text(manifest: dict) -> str:
    return json.dumps(manifest, indent=2) + "\n"


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_bytes(data); temporary.replace(path)


def _data_reference(path: Path) -> dict:
    media = "image/png" if path.suffix.lower() == ".png" else "image/jpeg"
    return {"type": "image_url", "image_url": {"url": f"data:{media};base64," + base64.b64encode(path.read_bytes()).decode()}}


def prompt_for(domain: str, version: int = CURRENT_PROMPT_VERSION) -> str:
    if domain not in DOMAINS: raise ValueError("unknown arena domain")
    if version not in (1, 2): raise ValueError("unknown arena prompt version")
    if domain == "MCP": return MCP_ANCHOR_PROMPT_V1 if version == 1 else MCP_ANCHOR_PROMPT_V2
    return f"""Create one production-ready BACKGROUND-ONLY DATAMON certification arena by editing the supplied MCP arena reference.\n\n{DOMAIN_DIRECTIONS[domain]}\n\nMaintain a straight-on three-quarter 800×432 battle-stage composition, polished late-16-bit handheld RPG pixel art, crisp square clusters, hard stepped edges, and strong near/mid/far depth. Do not imitate an existing franchise. Output only the clean landscape environment without an outer frame."""


def _request_image(prompt: str, reference: Path) -> tuple[bytes, dict]:
    payload = {
        "model": MODEL, "prompt": prompt, "n": 1, "resolution": "2K", "aspect_ratio": "16:9",
        "quality": "high", "background": "opaque", "input_references": [_data_reference(reference)],
    }
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/images", data=json.dumps(payload).encode(), method="POST",
        headers={"Authorization": "Bearer " + os.environ["OPENROUTER_API_KEY"], "Content-Type": "application/json",
                 "HTTP-Referer": "https://github.com/JewelsHovan/ClaudeCodeQuiz", "X-Title": "DATAMON domain arenas"},
    )
    # A billable image request is never retried automatically: an ambiguous timeout may already
    # have incurred cost, so a human must reconcile the ledger/provider before another call.
    started = time.time()
    try:
        with urllib.request.urlopen(request, timeout=480) as response: result = json.load(response)
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")[:1200]
        raise RuntimeError(f"OpenRouter HTTP {error.code}: {detail}") from error
    item = (result.get("data") or [None])[0] or {}; encoded = item.get("b64_json")
    if not encoded: raise RuntimeError("OpenRouter returned no image bytes")
    return base64.b64decode(encoded), {
        "usage": result.get("usage") or {}, "seconds": round(time.time() - started, 2),
        "response": result,
    }


def _ledger_path() -> Path:
    return RAW_DIR / "generation-ledger.json"


def _load_events() -> list[dict]:
    path = _ledger_path()
    if not path.exists(): return []
    ledger = json.loads(path.read_text())
    values = ledger.get("events")
    if isinstance(values, list): return [dict(value) for value in values if isinstance(value, dict)]
    # Migrate the original per-domain dictionary in memory without rewriting evidence.
    legacy = ledger.get("entries")
    if isinstance(legacy, dict):
        events = []
        for domain in DOMAINS:
            value = legacy.get(domain)
            if not isinstance(value, dict): continue
            event = dict(value); prompt_hash = event.get("promptSha256")
            event["promptVersion"] = 2 if prompt_hash == _sha(prompt_for(domain, 2).encode()) else 1
            event["eventId"] = f"legacy-{domain.lower()}-{str(event.get('rawSha256', ''))[:12]}"
            event["status"] = "generated"; events.append(event)
        return events
    return []


def _write_events(events: list[dict]) -> None:
    ledger = {
        "schemaVersion": 2, "provider": PROVIDER, "model": MODEL,
        "authorization": {"capUsd": AUTHORIZATION_CAP_USD, "priorSpendUsd": PRIOR_ART_SPEND_USD},
        "events": events,
    }
    _atomic_write(_ledger_path(), _manifest_text(ledger).encode())


def _event_cost(event: dict) -> float:
    value = event.get("cost")
    return float(value) if (not isinstance(value, bool) and isinstance(value, (int, float)) and
                            math.isfinite(float(value)) and value > 0) else 0.0


def _accounted_event_cost(event: dict) -> float:
    measured = _event_cost(event)
    if measured > 0: return measured
    reserved = event.get("reservedCostUsd")
    if (event.get("status") != "generated" and not isinstance(reserved, bool) and isinstance(reserved, (int, float)) and
            math.isfinite(float(reserved)) and reserved > 0):
        return float(reserved)
    return 0.0


def _authorization_spend(events: list[dict]) -> float:
    return round(PRIOR_ART_SPEND_USD + sum(_accounted_event_cost(event) for event in events), 6)


def _has_unresolved_attempts(events: list[dict]) -> list[str]:
    unresolved = {"reserved", "ambiguous-provider-error", "ambiguous-cost"}
    return [str(event.get("eventId")) for event in events
            if event.get("status") in unresolved or (event.get("status") == "generated" and _event_cost(event) <= 0)]


def generate_raw(only: set[str] | None, missing_only: bool, max_spend: float, concurrency: int,
                 new_candidate: bool = False) -> dict:
    if not os.environ.get("OPENROUTER_API_KEY"): raise RuntimeError("OPENROUTER_API_KEY is required for --generate")
    if isinstance(max_spend, bool) or not isinstance(max_spend, (int, float)) or not math.isfinite(float(max_spend)) or max_spend <= 0:
        raise RuntimeError("--max-spend must be a positive finite number")
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    style_reference = RAW_DIR / "style-reference.png"
    if not style_reference.exists(): raise RuntimeError("Missing ignored style-reference.png for arena generation")
    events = _load_events(); results = {}; session_cost = 0.0

    planned = []
    for domain in DOMAINS:
        if only and domain not in only: continue
        raw_path = RAW_DIR / (domain.lower() + ".png")
        if missing_only and raw_path.exists(): continue
        planned.append(domain)
    unresolved = _has_unresolved_attempts(events)
    if planned and unresolved:
        raise RuntimeError("Generation blocked until ambiguous attempts are manually reconciled: " + ", ".join(unresolved))
    if planned and (OUT_DIR / "manifest.json").exists():
        try: accepted = json.loads((OUT_DIR / "manifest.json").read_text()).get("reviewState") == "accepted"
        except Exception: accepted = False
        if accepted and not new_candidate:
            raise RuntimeError("Accepted arena batch is locked; a newly approved candidate requires --new-candidate")
    reservation = len(planned) * RESERVED_COST_PER_IMAGE
    if reservation > max_spend + 1e-9:
        raise RuntimeError(f"Refusing generation: ${reservation:.2f} reservation would exceed ${max_spend:.2f} session cap")
    current_authorized = _authorization_spend(events)
    if current_authorized + reservation > AUTHORIZATION_CAP_USD + 1e-9:
        raise RuntimeError(f"Refusing generation: authorization-wide spend plus reservation would exceed ${AUTHORIZATION_CAP_USD:.2f}")

    def rows_for(stage: str):
        rows = []
        for domain in planned:
            if (stage == "anchor") != (domain == "MCP"): continue
            reference = style_reference if domain == "MCP" else RAW_DIR / "mcp.png"
            if not reference.exists(): raise RuntimeError(f"Missing arena reference before {domain}: {reference}")
            rows.append((domain, reference))
        return rows

    def run_one(row):
        domain, reference, prompt = row
        raw, meta = _request_image(prompt, reference)
        return domain, reference, prompt, raw, meta

    for stage in ("anchor", "variants"):
        base_rows = rows_for(stage)
        if not base_rows: continue
        attempts = []
        # Persist each reservation before any network submission. A crash therefore consumes the
        # reservation and blocks retries until a human reconciles the provider account.
        for domain, reference in base_rows:
            prompt = prompt_for(domain, CURRENT_PROMPT_VERSION)
            event_id = f"{len(events)+1:04d}-{domain.lower()}-attempt"
            event = {
                "eventId": event_id, "status": "reserved", "reservedCostUsd": RESERVED_COST_PER_IMAGE,
                "id": domain.lower(), "domain": domain, "model": MODEL,
                "promptVersion": CURRENT_PROMPT_VERSION, "promptSha256": _sha(prompt.encode()),
                "referenceSha256": _sha(reference.read_bytes()), "rawSha256": None, "cost": None,
                "seconds": None, "responseArchive": None,
            }
            events.append(event); attempts.append((domain, reference, prompt, event))
        _write_events(events)
        failures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(concurrency, DEFAULT_CONCURRENCY))) as pool:
            future_rows = {pool.submit(run_one, (domain, reference, prompt)): (domain, reference, prompt, event)
                           for domain, reference, prompt, event in attempts}
            for future in concurrent.futures.as_completed(future_rows):
                domain, reference, prompt, event = future_rows[future]
                try:
                    _, _, _, raw, meta = future.result()
                except Exception as error:
                    event["status"] = "ambiguous-provider-error"; event["error"] = str(error)[:1200]
                    _write_events(events); failures.append(f"{domain}: {error}"); continue
                raw_sha = _sha(raw); event["rawSha256"] = raw_sha
                event["seconds"] = meta.get("seconds") if isinstance(meta, dict) else None
                attempt_raw = f"attempts/{event['eventId']}.png"; event["rawArchive"] = attempt_raw
                _atomic_write(RAW_DIR / attempt_raw, raw)
                response = meta.get("response") if isinstance(meta, dict) else None
                usage = meta.get("usage") if isinstance(meta, dict) else None
                archived_response = response if isinstance(response, dict) else {
                    "kind": "normalized-adapter-metadata", "usage": usage or {},
                    "seconds": event["seconds"], "rawSha256": raw_sha,
                }
                response_archive = f"responses/{event['eventId']}.json"
                response_bytes = _manifest_text(archived_response).encode()
                _atomic_write(RAW_DIR / response_archive, response_bytes)
                event["responseArchive"] = response_archive; event["responseArchiveSha256"] = _sha(response_bytes)
                # Response and raw evidence are durable before measured-cost validation.
                _write_events(events)
                cost = usage.get("cost") if isinstance(usage, dict) else None
                if (isinstance(cost, bool) or not isinstance(cost, (int, float)) or
                        not math.isfinite(float(cost)) or cost <= 0):
                    event["status"] = "ambiguous-cost"; _write_events(events)
                    failures.append(f"{domain}: OpenRouter response omitted a positive numeric usage.cost"); continue
                event["cost"] = float(cost); session_cost = round(session_cost + float(cost), 6)
                if float(cost) > RESERVED_COST_PER_IMAGE + 1e-9:
                    event["status"] = "rejected-over-reservation"; _write_events(events)
                    failures.append(f"{domain}: measured cost ${float(cost):.6f} exceeded ${RESERVED_COST_PER_IMAGE:.2f} reservation"); continue
                if session_cost > max_spend + 1e-9:
                    event["status"] = "rejected-session-cap"; _write_events(events)
                    failures.append(f"{domain}: measured session spend exceeded cap"); continue
                _atomic_write(RAW_DIR / (domain.lower() + ".png"), raw)
                event["status"] = "generated"; _write_events(events); results[domain] = dict(event)
                print(f"generated {domain}: ${float(cost):.6f}, session ${session_cost:.6f}, authorization ${_authorization_spend(events):.6f}")
        if failures:
            raise RuntimeError("Arena generation requires reconciliation:\n" + "\n".join(failures))
    return {"generated": len(results), "sessionCost": session_cost, "authorizationSpend": _authorization_spend(events), "model": MODEL}


def process_raw(path: Path) -> Image.Image:
    with Image.open(path) as opened: image = opened.convert("RGB")
    if image.width < 1200 or image.height < 700: raise RuntimeError(f"Arena raw image too small: {path}")
    crop_height = round(image.width / (800 / 432))
    if crop_height > image.height: raise RuntimeError(f"Arena raw aspect cannot produce stage crop: {path}")
    top = round((image.height - crop_height) * 0.49)
    image = image.crop((0, top, image.width, top + crop_height)).resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    return image.quantize(colors=PALETTE_MAX, method=Image.Quantize.FASTOCTREE,
                          dither=Image.Dither.NONE).convert("RGB")


def render_contact_sheet(directory: Path | None = None) -> tuple[Image.Image, Image.Image]:
    root = Path(directory or OUT_DIR); sheet = Image.new("RGB", (800, 5 * 450), (4, 9, 17)); draw = ImageDraw.Draw(sheet)
    for index, domain in enumerate(DOMAINS):
        with Image.open(root / (domain.lower() + ".png")) as opened:
            image = opened.convert("RGB").resize((800, 432), Image.Resampling.LANCZOS)
        y = index * 450; sheet.paste(image, (0, y + 18)); draw.text((8, y + 3), domain + " CERTIFICATION ARENA", fill=(240, 244, 250))
    return sheet, ImageOps.grayscale(sheet).convert("RGB")


def write_contact_sheet(directory: Path | None = None) -> tuple[Path, Path]:
    REVIEW_DIR.mkdir(parents=True, exist_ok=True); color, grayscale = render_contact_sheet(directory)
    color_path = REVIEW_DIR / "t55-domain-arenas.png"; gray_path = REVIEW_DIR / "t55-domain-arenas-grayscale.png"
    _atomic_write(color_path, _png_bytes(color)); _atomic_write(gray_path, _png_bytes(grayscale))
    return color_path, gray_path


def _selected_records(events: list[dict]) -> dict[str, dict]:
    selected = {}
    for domain in DOMAINS:
        identifier = domain.lower(); raw_path = RAW_DIR / (identifier + ".png")
        reference = RAW_DIR / ("style-reference.png" if domain == "MCP" else "mcp.png")
        if not raw_path.exists() or not reference.exists(): raise RuntimeError(f"Arena raw/reference missing: {domain}")
        raw_sha, ref_sha = _sha(raw_path.read_bytes()), _sha(reference.read_bytes())
        for event in reversed(events):
            version = event.get("promptVersion", 1)
            try: expected_prompt = _sha(prompt_for(domain, version).encode())
            except Exception: continue
            if (event.get("status", "generated") == "generated" and event.get("id") == identifier and
                    event.get("domain") == domain and event.get("model") == MODEL and
                    event.get("referenceSha256") == ref_sha and event.get("promptSha256") == expected_prompt and
                    event.get("rawSha256") == raw_sha and _event_cost(event) > 0):
                selected[domain] = event; break
        if domain not in selected: raise RuntimeError(f"Arena ledger provenance/cost mismatch: {domain}")
    return selected


def _candidate_dir() -> Path:
    return RAW_DIR / "candidate"


def build_candidate(directory: Path | None = None) -> dict:
    events = _load_events()
    if not events: raise RuntimeError("Arena generation ledger missing")
    selected = _selected_records(events); target = Path(directory or _candidate_dir())
    shutil.rmtree(target, ignore_errors=True); target.mkdir(parents=True)
    entries = []; aggregate = hashlib.sha256()
    try:
        for domain in DOMAINS:
            identifier = domain.lower(); raw_path = RAW_DIR / (identifier + ".png"); record = selected[domain]
            version = int(record.get("promptVersion", 1)); data = _png_bytes(process_raw(raw_path))
            (target / (identifier + ".png")).write_bytes(data); aggregate.update(data)
            entries.append({
                "id": identifier, "domain": domain, "file": identifier + ".png", "promptVersion": version,
                "promptSha256": _sha(prompt_for(domain, version).encode()),
                "referenceSha256": str(record["referenceSha256"]), "rawSha256": str(record["rawSha256"]),
                "costUsd": _event_cost(record), "sha256": _sha(data), "width": WIDTH, "height": HEIGHT,
            })
        generation_cost = round(sum(entry["costUsd"] for entry in entries), 6)
        manifest = {
            "schemaVersion": 1, "batch": BATCH, "reviewState": "pending",
            "review": {"contactSheetSha256": None, "grayscaleContactSheetSha256": None, "reviewed": False},
            "provider": PROVIDER, "model": MODEL, "provenance": PROVENANCE, "width": WIDTH, "height": HEIGHT,
            "format": "RGB", "paletteMax": PALETTE_MAX, "assetCount": 5, "domains": list(DOMAINS),
            "entries": entries, "batchSha256": aggregate.hexdigest(),
            "authorizationCapUsd": AUTHORIZATION_CAP_USD, "priorArtSpendUsd": PRIOR_ART_SPEND_USD,
            "generationCostUsd": generation_cost, "authorizationSpendUsd": _authorization_spend(events),
        }
        (target / "manifest.json").write_text(_manifest_text(manifest))
        errors, _ = validate(target, require_accepted=False)
        if errors: raise RuntimeError("Invalid arena review candidate:\n" + "\n".join(errors))
    except Exception:
        shutil.rmtree(target, ignore_errors=True); raise
    if directory is None: write_contact_sheet(target)
    return manifest


# Compatibility name for local tooling; unlike the original implementation this never promotes.
build_arenas = build_candidate


def _is_number(value) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(float(value))


def validate(directory: Path | None = None, require_accepted: bool = True) -> tuple[list[str], int]:
    root = Path(directory or OUT_DIR); errors = []; manifest_path = root / "manifest.json"
    if not manifest_path.exists(): return ["arena manifest missing"], 0
    try: manifest = json.loads(manifest_path.read_text())
    except Exception as error: return [f"invalid arena manifest: {error}"], 0
    if not isinstance(manifest, dict) or set(manifest) != ROOT_KEYS: errors.append("arena manifest root schema mismatch")
    if (manifest.get("schemaVersion") != 1 or manifest.get("batch") != BATCH or manifest.get("provider") != PROVIDER or
            manifest.get("model") != MODEL or manifest.get("provenance") != PROVENANCE or manifest.get("width") != WIDTH or
            manifest.get("height") != HEIGHT or manifest.get("format") != "RGB" or manifest.get("paletteMax") != PALETTE_MAX or
            manifest.get("assetCount") != 5 or manifest.get("domains") != list(DOMAINS) or
            manifest.get("authorizationCapUsd") != AUTHORIZATION_CAP_USD or
            manifest.get("priorArtSpendUsd") != PRIOR_ART_SPEND_USD):
        errors.append("arena manifest identity mismatch")
    state, review = manifest.get("reviewState"), manifest.get("review")
    if state not in ("pending", "accepted"): errors.append("arena review state invalid")
    if require_accepted and state != "accepted": errors.append("arena batch is not accepted")
    if not isinstance(review, dict) or set(review) != REVIEW_KEYS: errors.append("arena review schema mismatch")
    elif state == "accepted":
        if (review.get("reviewed") is not True or
                not re.fullmatch(r"[0-9a-f]{64}", str(review.get("contactSheetSha256", ""))) or
                not re.fullmatch(r"[0-9a-f]{64}", str(review.get("grayscaleContactSheetSha256", "")))):
            errors.append("accepted arena lacks color/grayscale review receipts")
        else:
            try:
                color, gray = render_contact_sheet(root)
                if _sha(_png_bytes(color)) != review["contactSheetSha256"]: errors.append("arena color review receipt drift")
                if _sha(_png_bytes(gray)) != review["grayscaleContactSheetSha256"]: errors.append("arena grayscale review receipt drift")
            except Exception as error: errors.append(f"arena review cannot be reconstructed: {error}")
    elif isinstance(review, dict) and review != {"contactSheetSha256": None, "grayscaleContactSheetSha256": None, "reviewed": False}:
        errors.append("pending arena may not carry an acceptance receipt")
    entries = manifest.get("entries")
    if not isinstance(entries, list): return errors + ["arena entries must be an array"], 0
    if [entry.get("domain") if isinstance(entry, dict) else None for entry in entries] != list(DOMAINS): errors.append("arena domain order mismatch")
    expected_files = {"manifest.json"} | {domain.lower() + ".png" for domain in DOMAINS}
    actual_files = {path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file()}
    for extra in sorted(actual_files - expected_files): errors.append("unexpected arena output: " + extra)
    for missing in sorted(expected_files - actual_files): errors.append("missing arena output: " + missing)
    total = 0; aggregate = hashlib.sha256(); hashes = set(); costs = []; grayscale_samples = []
    for index, domain in enumerate(DOMAINS):
        if index >= len(entries) or not isinstance(entries[index], dict): continue
        entry = entries[index]; identifier = domain.lower(); path = root / (identifier + ".png")
        if set(entry) != ENTRY_KEYS: errors.append(identifier + ": arena entry schema mismatch")
        version = entry.get("promptVersion")
        try: expected_prompt = _sha(prompt_for(domain, version).encode())
        except Exception: expected_prompt = None
        if (entry.get("id") != identifier or entry.get("domain") != domain or entry.get("file") != identifier + ".png" or
                entry.get("width") != WIDTH or entry.get("height") != HEIGHT or entry.get("promptSha256") != expected_prompt):
            errors.append(identifier + ": arena declaration mismatch")
        cost = entry.get("costUsd")
        if not _is_number(cost) or cost <= 0 or cost > RESERVED_COST_PER_IMAGE: errors.append(identifier + ": invalid measured generation cost")
        else: costs.append(float(cost))
        for field in ("promptSha256", "referenceSha256", "rawSha256", "sha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", str(entry.get(field, ""))): errors.append(identifier + f": invalid {field}")
        if not path.exists(): continue
        data = path.read_bytes(); total += len(data); aggregate.update(data); hashes.add(_sha(data))
        if _sha(data) != entry.get("sha256"): errors.append(identifier + ": arena hash mismatch")
        try:
            with Image.open(path) as opened:
                opened.load(); image = opened.convert("RGB")
                if opened.format != "PNG" or opened.mode != "RGB" or opened.size != (WIDTH, HEIGHT): errors.append(identifier + ": arena PNG contract mismatch")
        except Exception as error: errors.append(f"{identifier}: unreadable arena: {error}"); continue
        if image.getcolors(maxcolors=PALETTE_MAX + 1) is None: errors.append(identifier + ": arena palette exceeds bound")
        grayscale = ImageOps.grayscale(image)
        luminance = ImageStat.Stat(grayscale)
        if luminance.stddev[0] < 22 or not 35 <= luminance.mean[0] <= 190: errors.append(identifier + ": arena contrast/brightness outside bound")
        sample = grayscale.resize((64, 35), Image.Resampling.LANCZOS)
        dhash_source = grayscale.resize((17, 9), Image.Resampling.LANCZOS)
        pixels = list(dhash_source.get_flattened_data())
        dhash = tuple(pixels[y * 17 + x] > pixels[y * 17 + x + 1] for y in range(9) for x in range(16))
        grayscale_samples.append((domain, sample, dhash))
    generation_cost = round(sum(costs), 6)
    if manifest.get("generationCostUsd") != generation_cost: errors.append("arena generation cost aggregate mismatch")
    auth_spend = manifest.get("authorizationSpendUsd")
    if (not _is_number(auth_spend) or auth_spend < round(PRIOR_ART_SPEND_USD + generation_cost, 6) or
            auth_spend > AUTHORIZATION_CAP_USD): errors.append("arena authorization-wide spend invalid")
    if len(hashes) != 5: errors.append("arena backgrounds are not individually distinct")
    for left_index, (left_domain, left_sample, left_hash) in enumerate(grayscale_samples):
        for right_domain, right_sample, right_hash in grayscale_samples[left_index + 1:]:
            mean_difference = ImageStat.Stat(ImageChops.difference(left_sample, right_sample)).mean[0]
            hamming = sum(left != right for left, right in zip(left_hash, right_hash))
            if mean_difference < 4 or hamming < 10:
                errors.append(f"{left_domain}/{right_domain}: arena silhouettes are not grayscale-distinct")
    if manifest.get("batchSha256") != aggregate.hexdigest(): errors.append("arena aggregate hash mismatch")
    if manifest_path.read_bytes() != _manifest_text(manifest).encode(): errors.append("arena manifest serialization is not canonical")
    return errors, total


def accept(expected_sha: str) -> None:
    candidate = _candidate_dir()
    errors, _ = validate(candidate, require_accepted=False)
    if errors: raise RuntimeError("Arena candidate is invalid before acceptance:\n" + "\n".join(errors))
    color_path, gray_path = write_contact_sheet(candidate); color_sha, gray_sha = _sha(color_path.read_bytes()), _sha(gray_path.read_bytes())
    if expected_sha != color_sha: raise RuntimeError(f"Arena contact SHA mismatch: expected {expected_sha}, actual {color_sha}")
    staging = OUT_DIR.parent / ("." + OUT_DIR.name + ".accept-staging")
    backup = OUT_DIR.parent / ("." + OUT_DIR.name + ".accept-backup")
    shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(backup, ignore_errors=True)
    had_output = OUT_DIR.exists()
    try:
        shutil.copytree(candidate, staging)
        manifest_path = staging / "manifest.json"; manifest = json.loads(manifest_path.read_text())
        manifest["reviewState"] = "accepted"
        manifest["review"] = {"contactSheetSha256": color_sha, "grayscaleContactSheetSha256": gray_sha, "reviewed": True}
        manifest_path.write_text(_manifest_text(manifest))
        errors, _ = validate(staging)
        if errors: raise RuntimeError("Accepted arena staging validation failed:\n" + "\n".join(errors))
        if OUT_DIR.exists(): OUT_DIR.replace(backup)
        staging.replace(OUT_DIR)
        errors, _ = validate(OUT_DIR)
        if errors: raise RuntimeError("Accepted arena post-promotion validation failed:\n" + "\n".join(errors))
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        if backup.exists():
            shutil.rmtree(OUT_DIR, ignore_errors=True); backup.replace(OUT_DIR)
        elif not had_output:
            shutil.rmtree(OUT_DIR, ignore_errors=True)
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True); shutil.rmtree(backup, ignore_errors=True)


def snapshot(directory: Path | None = None) -> dict[str, bytes]:
    root = Path(directory or OUT_DIR)
    return {path.relative_to(root).as_posix(): path.read_bytes() for path in sorted(root.rglob("*")) if path.is_file()} if root.exists() else {}


def validate_twice() -> None:
    accepted_before = snapshot(OUT_DIR)
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="arena-determinism-", dir=RAW_DIR) as temporary:
        root = Path(temporary); first_dir, second_dir = root / "first", root / "second"
        first = build_candidate(first_dir); second = build_candidate(second_dir)
        if snapshot(first_dir) != snapshot(second_dir): raise RuntimeError("Arena candidates differ across clean generations")
        if accepted_before:
            accepted_manifest = json.loads((OUT_DIR / "manifest.json").read_text())
            if (first["entries"] != accepted_manifest.get("entries") or first["batchSha256"] != accepted_manifest.get("batchSha256") or
                    first["generationCostUsd"] != accepted_manifest.get("generationCostUsd")):
                raise RuntimeError("Deterministic candidate differs from accepted arena bytes/provenance")
    if snapshot(OUT_DIR) != accepted_before: raise RuntimeError("Determinism check mutated the accepted arena batch")


def main() -> int:
    parser = argparse.ArgumentParser(); parser.add_argument("--generate", action="store_true"); parser.add_argument("--missing", action="store_true")
    parser.add_argument("--new-candidate", action="store_true", help="explicitly unlock billable generation after an accepted batch")
    parser.add_argument("--only", default=""); parser.add_argument("--max-spend", type=float, default=DEFAULT_MAX_SPEND)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY); parser.add_argument("--pipeline-only", action="store_true")
    parser.add_argument("--accept", metavar="CONTACT_SHA"); parser.add_argument("--validate", action="store_true"); parser.add_argument("--validate-twice", action="store_true")
    args = parser.parse_args(); only = {value.strip().upper() for value in args.only.split(",") if value.strip()} or None
    if only and not only.issubset(DOMAINS): raise RuntimeError("Unknown arena domain in --only")
    if args.generate: print(json.dumps(generate_raw(only, args.missing, args.max_spend, args.concurrency, args.new_candidate), indent=2))
    if args.pipeline_only:
        build_candidate(); color, gray = write_contact_sheet(_candidate_dir())
        print(f"Pending arena review: {color}\nColor SHA-256: {_sha(color.read_bytes())}\nGrayscale SHA-256: {_sha(gray.read_bytes())}")
    if args.validate_twice:
        validate_twice(); print("Accepted arena batch and provenance remain byte-deterministic without promotion.")
    if args.accept: accept(args.accept); print("Battle arena batch accepted atomically.")
    if args.validate:
        errors, total = validate()
        if errors:
            for error in errors: print("FAIL: " + error)
            return 1
        print(f"Battle arenas valid: 5 reviewed 1600x864 PNGs, {total} bytes.")
    if not any((args.generate, args.pipeline_only, args.validate_twice, args.accept, args.validate)): parser.print_help()
    return 0


if __name__ == "__main__": raise SystemExit(main())
