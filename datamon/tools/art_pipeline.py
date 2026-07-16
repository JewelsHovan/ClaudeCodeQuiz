#!/usr/bin/env python3
"""Deterministic DATAMON HD environment-art pipeline (ticket #044).

Generated files are staged under ``datamon/.environment-work``. A batch can only
become active after complete schema/pixel validation and a review record tied to
the exact deterministic contact-sheet SHA. Promotion installs immutable assets
first and atomically replaces ``environment/manifest.json`` last.
"""

from __future__ import annotations

import argparse
import datetime as _datetime
import hashlib
import json
import os
import re
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Iterable, Optional

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError as exc:  # fail closed: decode/detail checks are mandatory
    raise RuntimeError("Pillow is required by the DATAMON art pipeline") from exc


DATAMON_ROOT = Path(__file__).resolve().parent.parent
BATCH_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,63}$")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,95}$")
KINDS = {"tile", "prop", "overlay", "ambient"}
ALPHA_MODES = {"opaque", "binary", "soft"}
REVIEW_STATES = {"pending", "reviewed", "accepted"}
REQUIRED_FIELDS = (
    "id", "kind", "slug", "file", "widthPx", "heightPx", "sourceScale",
    "sourceWidthPx", "sourceHeightPx", "alphaMode", "scene", "fallback",
    "provenance", "reviewState", "batchId",
)
PILOT_BATCH_ID = "batch-agent-wing"
PILOT_REQUIRED_IDS = frozenset({
    "hd-brick-red", "hd-brick-white", "hd-window-industrial",
    "hd-hardwood-detail", "hd-agent-wing-lighting", "hd-starry-painting",
    "hd-tv", "hd-kallax", "hd-couch", "hd-arc-lamp", "hd-rug",
    "hd-radiator", "hd-collaboration-table", "hd-amb-windows",
    "hd-amb-tv", "hd-amb-lamp", "hd-amb-table",
})
CUTOUT_IDS = frozenset({
    "hd-starry-painting", "hd-tv", "hd-kallax", "hd-couch",
    "hd-arc-lamp", "hd-radiator", "hd-collaboration-table",
})


@dataclass(frozen=True)
class PipelinePaths:
    root: Path
    work: Path
    staging: Path
    review: Path
    history: Path
    accepted: Path
    manifest: Path
    lock: Path


def paths_for(root: Path) -> PipelinePaths:
    root = Path(root).resolve()
    work = root / ".environment-work"
    return PipelinePaths(
        root=root,
        work=work,
        staging=work / "staging",
        review=work / "review",
        history=work / "history",
        accepted=root / "environment" / "accepted",
        manifest=root / "environment" / "manifest.json",
        lock=work / ".pipeline.lock",
    )


DEFAULT_PATHS = paths_for(DATAMON_ROOT)
# Backward-compatible path constants used by local scripts.
ENV_WORK = DEFAULT_PATHS.work
STAGING = DEFAULT_PATHS.staging
REVIEW = DEFAULT_PATHS.review
HISTORY = DEFAULT_PATHS.history
ACCEPTED = DEFAULT_PATHS.accepted
MANIFEST_PATH = DEFAULT_PATHS.manifest
LOCK_FILE = DEFAULT_PATHS.lock


def canonical_json(value) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_hex(Path(path).read_bytes())


def _safe_batch_id(batch_id: str) -> bool:
    return isinstance(batch_id, str) and bool(BATCH_RE.fullmatch(batch_id))


def _safe_relative_file(value: object) -> bool:
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and all(part not in ("", ".", "..") for part in path.parts)


def _positive_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def assert_staging_destination(destination: Path, paths: PipelinePaths = DEFAULT_PATHS) -> Path:
    """Reject generator output anywhere except the ignored staging root."""
    destination = Path(destination).resolve()
    if not _inside(destination, paths.staging):
        raise ValueError(f"Generated output must stay under {paths.staging}")
    if _inside(destination, paths.accepted):
        raise ValueError("Generated output cannot target environment/accepted")
    return destination


def _entry_prefix(index: int, entry: object) -> str:
    eid = entry.get("id", "?") if isinstance(entry, dict) else "?"
    return f"entry[{index}] ({eid}):"


def _schema_errors(entry: object, index: int) -> list[str]:
    prefix = _entry_prefix(index, entry)
    if not isinstance(entry, dict):
        return [f"{prefix} must be an object"]
    errors: list[str] = []
    for field in REQUIRED_FIELDS:
        if field not in entry:
            errors.append(f"{prefix} missing required field '{field}'")
    if errors:
        return errors

    if not isinstance(entry["id"], str) or not ID_RE.fullmatch(entry["id"]):
        errors.append(f"{prefix} id must be a safe lowercase slug")
    if entry["kind"] not in KINDS:
        errors.append(f"{prefix} invalid kind '{entry['kind']}'")
    if not isinstance(entry["slug"], str) or not ID_RE.fullmatch(entry["slug"]):
        errors.append(f"{prefix} slug must be a safe lowercase slug")
    if not _safe_relative_file(entry["file"]) or not str(entry["file"]).lower().endswith(".png"):
        errors.append(f"{prefix} file must be a safe relative PNG path")

    for field in ("widthPx", "heightPx", "sourceWidthPx", "sourceHeightPx", "sourceScale"):
        if not _positive_int(entry[field]):
            errors.append(f"{prefix} {field} must be a positive integer")
    if errors:
        return errors

    if entry["sourceScale"] not in (1, 2):
        errors.append(f"{prefix} sourceScale must be 1 or 2")
    expected_frame_w = entry["widthPx"] * entry["sourceScale"]
    expected_frame_h = entry["heightPx"] * entry["sourceScale"]
    if entry["sourceWidthPx"] != expected_frame_w:
        errors.append(
            f"{prefix} sourceWidthPx must equal widthPx*sourceScale "
            f"({expected_frame_w}), got {entry['sourceWidthPx']}"
        )
    if entry["sourceHeightPx"] != expected_frame_h:
        errors.append(
            f"{prefix} sourceHeightPx must equal heightPx*sourceScale "
            f"({expected_frame_h}), got {entry['sourceHeightPx']}"
        )

    if entry["alphaMode"] not in ALPHA_MODES:
        errors.append(f"{prefix} invalid alphaMode '{entry['alphaMode']}'")
    if entry["reviewState"] not in REVIEW_STATES:
        errors.append(f"{prefix} invalid reviewState '{entry['reviewState']}'")
    if not isinstance(entry["scene"], str) or not entry["scene"]:
        errors.append(f"{prefix} scene must be a non-empty string")
    if not isinstance(entry["fallback"], str) or not entry["fallback"]:
        errors.append(f"{prefix} fallback must be a non-empty string")
    provenance = entry["provenance"]
    if not isinstance(provenance, str) or not provenance:
        errors.append(f"{prefix} provenance must be a non-empty string")
    elif re.search(r"(?:headshots?|\.environment-work|[/\\]raw[/\\])", provenance, re.I):
        errors.append(f"{prefix} provenance must not expose raw/headshot/work paths")
    if not _safe_batch_id(entry["batchId"]):
        errors.append(f"{prefix} batchId is unsafe")

    animation = entry.get("animation")
    if animation is not None:
        if entry["kind"] != "ambient" or not isinstance(animation, dict):
            errors.append(f"{prefix} only ambient entries may declare animation")
        else:
            if not _positive_int(animation.get("frames")) or animation["frames"] < 2:
                errors.append(f"{prefix} animation.frames must be an integer >= 2")
            if not _positive_int(animation.get("fps")) or animation["fps"] > 12:
                errors.append(f"{prefix} animation.fps must be in 1..12")
            if animation.get("layout") != "horizontal":
                errors.append(f"{prefix} animation.layout must be 'horizontal'")
    elif entry["kind"] == "ambient":
        errors.append(f"{prefix} ambient entries require horizontal animation metadata")

    if entry["kind"] == "prop":
        for field in ("tileW", "tileH"):
            if not _positive_int(entry.get(field)):
                errors.append(f"{prefix} prop {field} must be a positive integer")
        for field in ("anchorX", "anchorY"):
            if not isinstance(entry.get(field), int) or isinstance(entry.get(field), bool):
                errors.append(f"{prefix} prop {field} must be an integer")

    placement = entry.get("placement")
    if placement is not None:
        if not isinstance(placement, dict):
            errors.append(f"{prefix} placement must be an object")
        elif not all(isinstance(placement.get(key), int) and not isinstance(placement.get(key), bool)
                     for key in ("col", "row")):
            errors.append(f"{prefix} placement col/row must be integers")

    if entry["id"] == "hd-collaboration-table":
        if entry.get("collision") != "none":
            errors.append(f"{prefix} collaboration table collision must be 'none'")
        if placement is None or placement.get("col") != 1 or placement.get("row") != 5:
            errors.append(f"{prefix} collaboration table placement must be (1,5)")

    if entry["id"] in CUTOUT_IDS and entry["alphaMode"] == "opaque":
        errors.append(f"{prefix} cutout prop cannot declare opaque alpha")
    return errors


def _trivial_nearest_frame(frame: Image.Image, logical_w: int, logical_h: int, scale: int) -> bool:
    rgba = frame.convert("RGBA")
    px = rgba.load()
    for ly in range(logical_h):
        for lx in range(logical_w):
            base = px[lx * scale, ly * scale]
            for oy in range(scale):
                for ox in range(scale):
                    if px[lx * scale + ox, ly * scale + oy] != base:
                        return False
    return True


def _pixel_errors(image: Image.Image, entry: dict, prefix: str) -> list[str]:
    errors: list[str] = []
    rgba = image.convert("RGBA")
    alpha_channel = rgba.getchannel("A")
    alpha_data = (alpha_channel.get_flattened_data() if hasattr(alpha_channel, "get_flattened_data")
                  else alpha_channel.getdata())
    alpha_values = set(alpha_data)
    mode = entry["alphaMode"]
    if mode == "opaque" and alpha_values != {255}:
        errors.append(f"{prefix} declared opaque but contains transparent pixels")
    elif mode == "binary":
        if not alpha_values.issubset({0, 255}):
            errors.append(f"{prefix} declared binary but contains soft alpha")
        if not ({0, 255} <= alpha_values):
            errors.append(f"{prefix} binary cutout must contain transparent and opaque pixels")
    elif mode == "soft" and not any(0 < alpha < 255 for alpha in alpha_values):
        errors.append(f"{prefix} declared soft but contains no intermediate alpha")

    max_colors = entry.get("maxColors", 128)
    if not _positive_int(max_colors) or max_colors > 256:
        errors.append(f"{prefix} maxColors must be a positive integer <= 256")
    else:
        colors = rgba.getcolors(maxcolors=max_colors + 1)
        if colors is None:
            errors.append(f"{prefix} exceeds maxColors={max_colors}")

    if entry["sourceScale"] > 1:
        frames = entry.get("animation", {}).get("frames", 1)
        frame_w = entry["sourceWidthPx"]
        for frame_index in range(frames):
            frame = rgba.crop((frame_index * frame_w, 0, (frame_index + 1) * frame_w, rgba.height))
            if _trivial_nearest_frame(frame, entry["widthPx"], entry["heightPx"], entry["sourceScale"]):
                errors.append(
                    f"{prefix} frame {frame_index} is a trivial nearest-neighbour "
                    f"sourceScale-{entry['sourceScale']} upscale"
                )
    return errors


def validate_batch(batch_dir: Path, manifest_entries: list, *,
                   required_ids: Optional[Iterable[str]] = None) -> list[str]:
    """Validate a complete batch. One error invalidates the entire atomic batch."""
    batch_dir = Path(batch_dir)
    errors: list[str] = []
    if not batch_dir.is_dir():
        return [f"Batch directory does not exist: {batch_dir}"]
    if not isinstance(manifest_entries, list) or not manifest_entries:
        return ["Manifest must be a non-empty array"]

    ids: set[str] = set()
    files: set[str] = set()
    batch_ids: set[str] = set()
    structurally_valid: list[tuple[int, dict]] = []
    for index, entry in enumerate(manifest_entries):
        entry_errors = _schema_errors(entry, index)
        errors.extend(entry_errors)
        if entry_errors:
            continue
        if entry["id"] in ids:
            errors.append(f"{_entry_prefix(index, entry)} duplicate id '{entry['id']}'")
        ids.add(entry["id"])
        if entry["file"] in files:
            errors.append(f"{_entry_prefix(index, entry)} duplicate file '{entry['file']}'")
        files.add(entry["file"])
        batch_ids.add(entry["batchId"])
        structurally_valid.append((index, entry))

    if len(batch_ids) > 1:
        errors.append(f"Manifest mixes batch IDs: {sorted(batch_ids)}")
    inferred_required = set(required_ids) if required_ids is not None else (
        set(PILOT_REQUIRED_IDS) if batch_ids == {PILOT_BATCH_ID} else None
    )
    if inferred_required is not None:
        missing = sorted(inferred_required - ids)
        extra = sorted(ids - inferred_required)
        if missing:
            errors.append(f"Batch missing required members: {', '.join(missing)}")
        if extra:
            errors.append(f"Batch contains unexpected members: {', '.join(extra)}")

    png_files = {
        path.relative_to(batch_dir).as_posix()
        for path in batch_dir.rglob("*.png") if path.is_file()
    }
    missing_files = sorted(files - png_files)
    unexpected_files = sorted(png_files - files)
    if missing_files:
        errors.append(f"Batch missing declared PNG files: {', '.join(missing_files)}")
    if unexpected_files:
        errors.append(f"Batch contains undeclared PNG files: {', '.join(unexpected_files)}")

    for index, entry in structurally_valid:
        prefix = _entry_prefix(index, entry)
        file_path = batch_dir / PurePosixPath(entry["file"])
        if not file_path.is_file() or not _inside(file_path, batch_dir):
            continue
        try:
            with Image.open(file_path) as opened:
                if opened.format != "PNG":
                    errors.append(f"{prefix} file is not a PNG")
                    continue
                opened.load()
                image = opened.convert("RGBA")
        except Exception as exc:
            errors.append(f"{prefix} failed to decode PNG: {exc}")
            continue

        frames = entry.get("animation", {}).get("frames", 1)
        expected_w = entry["sourceWidthPx"] * frames
        expected_h = entry["sourceHeightPx"]
        if image.size != (expected_w, expected_h):
            errors.append(
                f"{prefix} dimension mismatch: expected {expected_w}×{expected_h}, "
                f"got {image.width}×{image.height}"
            )
            continue
        errors.extend(_pixel_errors(image, entry, prefix))
    return errors


def stage_batch(batch_id: str, source_dir: Path, manifest_entries: list,
                paths: PipelinePaths = DEFAULT_PATHS) -> Path:
    """Copy a complete source set into ignored staging; never write accepted output."""
    if not _safe_batch_id(batch_id):
        raise ValueError("Unsafe batch ID")
    source_dir = Path(source_dir).resolve()
    if not source_dir.is_dir():
        raise FileNotFoundError(source_dir)
    if _inside(source_dir, paths.accepted):
        raise ValueError("Source directory must not be inside environment/accepted")
    target = assert_staging_destination(paths.staging / batch_id, paths)
    paths.staging.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f".{batch_id}-", dir=paths.staging))
    try:
        for entry in manifest_entries:
            if not isinstance(entry, dict) or not _safe_relative_file(entry.get("file")):
                raise ValueError("Manifest contains an unsafe file path")
            source = source_dir / PurePosixPath(entry["file"])
            if not source.is_file() or not _inside(source, source_dir):
                raise FileNotFoundError(source)
            destination = tmp / PurePosixPath(entry["file"])
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        (tmp / "manifest.json").write_bytes(canonical_json(manifest_entries))
        errors = validate_batch(tmp, manifest_entries)
        if errors:
            raise ValueError("Batch validation failed:\n" + "\n".join(errors))
        if target.exists():
            shutil.rmtree(target)
        os.replace(tmp, target)
        return target
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def batch_content_sha(batch_dir: Path, manifest_entries: list) -> str:
    digest = hashlib.sha256()
    digest.update(canonical_json(manifest_entries))
    for entry in sorted(manifest_entries, key=lambda item: item["id"]):
        digest.update(entry["id"].encode())
        digest.update(b"\0")
        digest.update((batch_dir / entry["file"]).read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def _font(size: int):
    try:
        return ImageFont.truetype("DejaVuSansMono.ttf", size)
    except OSError:
        return ImageFont.load_default()


def _checker(size: tuple[int, int], cell: int = 8) -> Image.Image:
    image = Image.new("RGBA", size, (22, 33, 48, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, min(size[0] - 1, x + cell - 1),
                                min(size[1] - 1, y + cell - 1)), fill=(35, 49, 67, 255))
    return image


def _fit_nearest(image: Image.Image, bounds: tuple[int, int]) -> Image.Image:
    ratio = min(bounds[0] / image.width, bounds[1] / image.height)
    ratio = max(ratio, 1 / max(image.width, image.height))
    size = (max(1, int(image.width * ratio)), max(1, int(image.height * ratio)))
    return image.resize(size, Image.Resampling.NEAREST)


def _composite_at(base: Image.Image, image: Image.Image, xy: tuple[int, int]):
    base.alpha_composite(image.convert("RGBA"), xy)


def _agent_room_preview(batch_dir: Path, entries: list[dict]) -> Image.Image:
    """Deterministic 2× room mock-up using frame zero for the G1 visual gate."""
    by_id = {entry["id"]: entry for entry in entries}
    images = {eid: Image.open(batch_dir / entry["file"]).convert("RGBA")
              for eid, entry in by_id.items()}
    room = Image.new("RGBA", (768, 704), (8, 20, 38, 255))  # 12×11 logical tiles at 2×

    floor = images.get("hd-hardwood-detail")
    if floor:
        for y in range(64, room.height, 64):
            for x in range(0, room.width, 64):
                _composite_at(room, floor, (x, y))

    brick_red = images.get("hd-brick-red")
    brick_white = images.get("hd-brick-white")
    window = images.get("hd-window-industrial")
    for x in range(0, room.width, 64):
        wall = brick_white if x in (0, 384, 704) else brick_red
        if wall:
            _composite_at(room, wall, (x, 0))
    if window:
        for x in range(64, 384, 64):
            _composite_at(room, window, (x, 0))

    # Existing lounge placements at exact 2× logical coordinates where practical.
    placements = {
        "hd-starry-painting": (64, 12),
        "hd-tv": (384, 12),
        "hd-kallax": (256, 64),
        "hd-couch": (64, 256),
        "hd-arc-lamp": (448, 256),
        "hd-rug": (64, 512),
        "hd-radiator": (640, 64),
        "hd-collaboration-table": (64, 320),
    }
    # Soft grounding shadow beneath the seating group.
    d = ImageDraw.Draw(room, "RGBA")
    d.ellipse((48, 242, 454, 462), fill=(2, 7, 16, 66))
    for eid, xy in placements.items():
        image = images.get(eid)
        if image:
            _composite_at(room, image, xy)
    couch = images.get("hd-couch")
    if couch:
        _composite_at(room, couch, (64, 384))

    # Frame-zero ambient overlays.
    ambient_positions = {
        "hd-amb-windows": (64, 0),
        "hd-amb-tv": (384, 12),
        "hd-amb-lamp": (448, 256),
        "hd-amb-table": (64, 320),
    }
    for eid, xy in ambient_positions.items():
        entry = by_id.get(eid)
        strip = images.get(eid)
        if entry and strip:
            frame = strip.crop((0, 0, entry["sourceWidthPx"], entry["sourceHeightPx"]))
            _composite_at(room, frame, xy)

    lighting = images.get("hd-agent-wing-lighting")
    if lighting:
        # One bounded practical-light cluster; never repeat it into a visible tile grid.
        _composite_at(room, lighting, (64, 64))
    return room


def generate_contact_sheet(batch_dir: Path, manifest_entries: list,
                           output_dir: Optional[Path] = None) -> tuple[Path, str]:
    """Render a byte-deterministic review sheet; no wall-clock metadata is embedded."""
    batch_dir = Path(batch_dir)
    errors = validate_batch(batch_dir, manifest_entries)
    if errors:
        raise ValueError("Batch validation failed:\n" + "\n".join(errors))
    output_dir = Path(output_dir) if output_dir is not None else DEFAULT_PATHS.review
    output_dir.mkdir(parents=True, exist_ok=True)
    batch_id = manifest_entries[0]["batchId"]
    sheet_path = output_dir / f"contact-sheet-{batch_id}.png"
    content_sha = batch_content_sha(batch_dir, manifest_entries)

    cols, cell_w, cell_h = 4, 440, 236
    rows = (len(manifest_entries) + cols - 1) // cols
    hero_h = 790 if batch_id == PILOT_BATCH_ID else 0
    header_h, footer_h = 72, 44
    sheet = Image.new("RGBA", (cols * cell_w, header_h + hero_h + rows * cell_h + footer_h),
                      (8, 20, 38, 255))
    draw = ImageDraw.Draw(sheet, "RGBA")
    title_font, label_font, small_font = _font(24), _font(14), _font(11)
    draw.rectangle((0, 0, sheet.width, header_h - 1), fill=(12, 27, 48, 255))
    draw.text((20, 14), f"DATAMON G1 · {batch_id} · {len(manifest_entries)} members",
              fill=(69, 215, 232, 255), font=title_font)
    draw.text((20, 46), "SOURCE 2x / LOGICAL 1x · frame zero for motion · alpha shown on checker",
              fill=(232, 223, 200, 255), font=small_font)

    grid_y = header_h
    if hero_h:
        room = _agent_room_preview(batch_dir, manifest_entries)
        checker = _checker((room.width + 24, room.height + 24), 12)
        checker.alpha_composite(room, (12, 12))
        sheet.alpha_composite(checker, (20, header_h + 42))
        draw.text((20, header_h + 12), "AGENT WING · staged room composite · frame 0",
                  fill=(242, 179, 93, 255), font=label_font)
        notes_x = 830
        notes = [
            "AFTER-HOURS CONSULTING STUDIO", "", "- subtle staggered walnut grain",
            "- tileable brick + recessed mortar", "- industrial rain / reflections",
            "- woven seating + grounded shadows", "- restrained books / work objects",
            "- fixture-origin upper-left light", "", "REVIEW GATE",
            "Pending human decision.", "No accepted files are active.",
            "No portrait or billable generation.", "", f"Batch content SHA:",
            content_sha[:32], content_sha[32:],
        ]
        y = header_h + 60
        for line in notes:
            color = (232, 223, 200, 255)
            if line in ("AFTER-HOURS CONSULTING STUDIO", "REVIEW GATE"):
                color = (69, 215, 232, 255)
            draw.text((notes_x, y), line, fill=color, font=label_font if line else small_font)
            y += 31
        grid_y += hero_h

    for index, entry in enumerate(manifest_entries):
        col, row = index % cols, index // cols
        x0, y0 = col * cell_w, grid_y + row * cell_h
        draw.rectangle((x0, y0, x0 + cell_w - 1, y0 + cell_h - 1),
                       fill=(9, 24, 43, 255), outline=(35, 55, 76, 255), width=1)
        draw.text((x0 + 12, y0 + 10), f"{entry['slug']} · {entry['kind']}",
                  fill=(232, 223, 200, 255), font=label_font)
        frames = entry.get("animation", {}).get("frames", 1)
        source_label = (f"frame {entry['sourceWidthPx']}×{entry['sourceHeightPx']} · "
                        f"sheet {entry['sourceWidthPx'] * frames}×{entry['sourceHeightPx']}"
                        if frames > 1 else
                        f"source {entry['sourceWidthPx']}×{entry['sourceHeightPx']}")
        draw.text((x0 + 12, y0 + 31),
                  f"{source_label} · {entry['alphaMode']} · {entry['reviewState']}",
                  fill=(148, 163, 184, 255), font=small_font)

        image = Image.open(batch_dir / entry["file"]).convert("RGBA")
        first = image.crop((0, 0, entry["sourceWidthPx"], entry["sourceHeightPx"]))
        source_preview = _fit_nearest(first, (245, 142))
        logical = first.resize((entry["widthPx"], entry["heightPx"]), Image.Resampling.LANCZOS)
        logical_preview = _fit_nearest(logical, (145, 112))
        panel = _checker((265, 150), 8)
        panel.alpha_composite(source_preview,
                              ((panel.width - source_preview.width) // 2,
                               (panel.height - source_preview.height) // 2))
        sheet.alpha_composite(panel, (x0 + 12, y0 + 55))
        logical_panel = _checker((145, 112), 8)
        logical_panel.alpha_composite(logical_preview,
                                      ((145 - logical_preview.width) // 2,
                                       (112 - logical_preview.height) // 2))
        sheet.alpha_composite(logical_panel, (x0 + 286, y0 + 55))
        draw.text((x0 + 300, y0 + 171), "logical 1x", fill=(148, 163, 184, 255), font=small_font)

        if frames > 1:
            film_y = y0 + 208
            frame_w = entry["sourceWidthPx"]
            film = Image.new("RGBA", (400, 20), (8, 20, 38, 255))
            each_w = max(1, 396 // frames)
            for fi in range(frames):
                frame = image.crop((fi * frame_w, 0, (fi + 1) * frame_w, image.height))
                thumb = _fit_nearest(frame, (each_w - 2, 18))
                film.alpha_composite(thumb, (fi * each_w + 1, (20 - thumb.height) // 2))
            sheet.alpha_composite(film, (x0 + 12, film_y))
            draw.text((x0 + 345, y0 + 31),
                      f"{frames}f @{entry['animation']['fps']}fps", fill=(69, 215, 232, 255), font=small_font)

    footer_y = sheet.height - footer_h
    draw.rectangle((0, footer_y, sheet.width, sheet.height), fill=(12, 27, 48, 255))
    draw.text((18, footer_y + 13), f"CONTENT SHA-256 {content_sha} · deterministic recipe v2",
              fill=(148, 163, 184, 255), font=small_font)
    sheet.save(sheet_path, "PNG", optimize=False, compress_level=9)
    return sheet_path, sha256_file(sheet_path)


def _atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    except Exception:
        Path(name).unlink(missing_ok=True)
        raise


def mark_reviewed(batch_id: str, contact_sheet_sha: str, accepted: bool,
                  paths: PipelinePaths = DEFAULT_PATHS) -> Path:
    """Record a human decision tied to the current exact sheet; never auto-promote."""
    if not _safe_batch_id(batch_id) or not re.fullmatch(r"[0-9a-f]{64}", contact_sheet_sha or ""):
        raise ValueError("Unsafe batch ID or contact-sheet SHA")
    sheet = paths.review / f"contact-sheet-{batch_id}.png"
    if not sheet.is_file() or sha256_file(sheet) != contact_sheet_sha:
        raise ValueError("Contact-sheet SHA does not match the current staged review sheet")
    staging_manifest = paths.staging / batch_id / "manifest.json"
    entries = json.loads(staging_manifest.read_text())
    if {entry.get("batchId") for entry in entries} != {batch_id}:
        raise ValueError("Staging manifest batch ID mismatch")
    errors = validate_batch(paths.staging / batch_id, entries)
    if errors:
        raise ValueError("Batch validation failed:\n" + "\n".join(errors))

    record = {
        "batchId": batch_id,
        "contactSheetSha": contact_sheet_sha,
        "accepted": bool(accepted),
        "reviewedAt": _datetime.datetime.now(_datetime.timezone.utc).replace(microsecond=0).isoformat()
            .replace("+00:00", "Z"),
    }
    record_path = paths.review / f"review-{batch_id}.json"
    _atomic_write(record_path, canonical_json(record))
    if accepted:
        reviewed_entries = [dict(entry, reviewState="reviewed") for entry in entries]
        _atomic_write(staging_manifest, canonical_json(reviewed_entries))
    return record_path


def _tree_digest(manifest_bytes: bytes, accepted: Path) -> str:
    digest = hashlib.sha256()
    digest.update(manifest_bytes)
    if accepted.exists():
        for path in sorted((p for p in accepted.rglob("*") if p.is_file()),
                           key=lambda item: item.relative_to(accepted).as_posix()):
            digest.update(path.relative_to(accepted).as_posix().encode())
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
    return digest.hexdigest()


def _snapshot_history(paths: PipelinePaths, manifest_bytes: bytes) -> Path:
    key = _tree_digest(manifest_bytes, paths.accepted)
    target = paths.history / key
    if target.exists():
        return target
    paths.history.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix=f".{key}-", dir=paths.history))
    try:
        (tmp / "manifest.json").write_bytes(manifest_bytes)
        if paths.accepted.exists():
            shutil.copytree(paths.accepted, tmp / "accepted")
        os.replace(tmp, target)
        # Existing content-addressed snapshots are never replaced or mutated.
        return target
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def _acquire_lock(paths: PipelinePaths):
    paths.work.mkdir(parents=True, exist_ok=True)
    try:
        fd = os.open(paths.lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        age = time.time() - paths.lock.stat().st_mtime
        if age <= 300:
            raise RuntimeError("Another art-pipeline operation holds the lock")
        paths.lock.unlink(missing_ok=True)
        fd = os.open(paths.lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as handle:
        handle.write(str(os.getpid()))


def _release_lock(paths: PipelinePaths):
    paths.lock.unlink(missing_ok=True)


def _read_active_manifest(paths: PipelinePaths) -> tuple[list, bytes]:
    if not paths.manifest.exists():
        return [], b"[]\n"
    raw = paths.manifest.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, list):
        raise ValueError("Active environment manifest must be an array")
    return value, raw


def accept_batch(batch_id: str, manifest_entries: list,
                 paths: PipelinePaths = DEFAULT_PATHS, *, inject_failure: Optional[str] = None) -> Path:
    """Install immutable assets, then atomically commit the active manifest last."""
    if not _safe_batch_id(batch_id):
        raise ValueError("Unsafe batch ID")
    staging_dir = paths.staging / batch_id
    if not staging_dir.is_dir():
        raise FileNotFoundError(f"Staging batch '{batch_id}' not found")
    if {entry.get("batchId") for entry in manifest_entries} != {batch_id}:
        raise ValueError("Every manifest entry must use the promoted batch ID")
    if any(entry.get("reviewState") != "reviewed" for entry in manifest_entries):
        raise ValueError("Every member must be reviewed together before acceptance")
    errors = validate_batch(staging_dir, manifest_entries)
    if errors:
        raise ValueError("Batch validation failed:\n" + "\n".join(errors))

    review_path = paths.review / f"review-{batch_id}.json"
    if not review_path.is_file():
        raise ValueError("Missing review record")
    review = json.loads(review_path.read_text())
    sheet = paths.review / f"contact-sheet-{batch_id}.png"
    if (review.get("batchId") != batch_id or review.get("accepted") is not True or
            not sheet.is_file() or review.get("contactSheetSha") != sha256_file(sheet)):
        raise ValueError("Review record is rejected, stale, or tied to another contact sheet")

    _acquire_lock(paths)
    old_entries: list = []
    old_manifest_bytes = b"[]\n"
    accepted_target = paths.accepted / batch_id
    temp_target: Optional[Path] = None
    manifest_committed = False
    try:
        old_entries, old_manifest_bytes = _read_active_manifest(paths)
        if accepted_target.exists() or any(entry.get("batchId") == batch_id for entry in old_entries):
            raise ValueError(f"Accepted batch '{batch_id}' is immutable and already exists")
        _snapshot_history(paths, old_manifest_bytes)
        paths.accepted.mkdir(parents=True, exist_ok=True)
        temp_target = Path(tempfile.mkdtemp(prefix=f".{batch_id}-", dir=paths.accepted))
        for entry in manifest_entries:
            source = staging_dir / entry["file"]
            destination = temp_target / entry["file"]
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, destination)
        os.replace(temp_target, accepted_target)
        temp_target = None
        if inject_failure == "after-assets" or os.environ.get("DATAMON_ART_PIPELINE_FAIL") == "after-assets":
            raise RuntimeError("Injected failure after asset install")

        accepted_entries = [dict(entry, reviewState="accepted") for entry in manifest_entries]
        new_entries = old_entries + accepted_entries
        _atomic_write(paths.manifest, canonical_json(new_entries))  # commit marker: LAST
        manifest_committed = True
        if inject_failure == "after-manifest":
            raise RuntimeError("Injected failure after manifest commit")
        return accepted_target
    except Exception:
        if manifest_committed:
            _atomic_write(paths.manifest, old_manifest_bytes)
        if accepted_target.exists():
            shutil.rmtree(accepted_target)
        if temp_target and temp_target.exists():
            shutil.rmtree(temp_target)
        raise
    finally:
        _release_lock(paths)


def rollback_batch(batch_id: str, paths: PipelinePaths = DEFAULT_PATHS) -> bool:
    """Deactivate one batch with a history snapshot; active manifest changes atomically."""
    if not _safe_batch_id(batch_id):
        raise ValueError("Unsafe batch ID")
    _acquire_lock(paths)
    try:
        entries, manifest_bytes = _read_active_manifest(paths)
        retained = [entry for entry in entries if entry.get("batchId") != batch_id]
        if len(retained) == len(entries):
            return False
        _snapshot_history(paths, manifest_bytes)
        _atomic_write(paths.manifest, canonical_json(retained))
        target = paths.accepted / batch_id
        if target.exists():
            shutil.rmtree(target)
        return True
    finally:
        _release_lock(paths)


def validate_active(paths: PipelinePaths = DEFAULT_PATHS) -> list[str]:
    entries, _ = _read_active_manifest(paths)
    errors: list[str] = []
    by_batch: dict[str, list] = {}
    for entry in entries:
        by_batch.setdefault(entry.get("batchId", ""), []).append(entry)
    for batch_id, batch_entries in by_batch.items():
        errors.extend(validate_batch(paths.accepted / batch_id, batch_entries))
        if any(entry.get("reviewState") != "accepted" for entry in batch_entries):
            errors.append(f"Active batch {batch_id} contains a non-accepted entry")
    return errors


def _load_manifest(path: Path) -> list:
    value = json.loads(Path(path).read_text())
    if not isinstance(value, list):
        raise ValueError("Manifest must be an array")
    return value


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    stage = sub.add_parser("stage")
    stage.add_argument("batch_id")
    stage.add_argument("source_dir", type=Path)
    stage.add_argument("manifest", type=Path)
    validate = sub.add_parser("validate")
    validate.add_argument("batch_dir", type=Path)
    validate.add_argument("manifest", type=Path)
    sub.add_parser("validate-active")
    contact = sub.add_parser("contact-sheet")
    contact.add_argument("batch_dir", type=Path)
    contact.add_argument("manifest", type=Path)
    contact.add_argument("output_dir", type=Path, nargs="?")
    reviewed = sub.add_parser("mark-reviewed")
    reviewed.add_argument("batch_id")
    reviewed.add_argument("contact_sha")
    reviewed.add_argument("accepted", choices=("true", "false"))
    accept = sub.add_parser("accept")
    accept.add_argument("batch_id")
    accept.add_argument("manifest", type=Path)
    rollback = sub.add_parser("rollback")
    rollback.add_argument("batch_id")
    args = parser.parse_args(argv)

    if args.command == "stage":
        result = stage_batch(args.batch_id, args.source_dir, _load_manifest(args.manifest))
        print(f"Staged: {result}")
    elif args.command == "validate":
        errors = validate_batch(args.batch_dir, _load_manifest(args.manifest))
        if errors:
            print("VALIDATION FAILED:")
            for error in errors:
                print(f"  - {error}")
            return 1
        print("Validation passed.")
    elif args.command == "validate-active":
        errors = validate_active()
        if errors:
            print("ACTIVE MANIFEST VALIDATION FAILED:")
            for error in errors:
                print(f"  - {error}")
            return 1
        print("Active environment manifest valid.")
    elif args.command == "contact-sheet":
        result, digest = generate_contact_sheet(args.batch_dir, _load_manifest(args.manifest), args.output_dir)
        print(f"Contact sheet: {result}")
        print(f"SHA-256: {digest}")
    elif args.command == "mark-reviewed":
        result = mark_reviewed(args.batch_id, args.contact_sha, args.accepted == "true")
        print(f"Review record: {result}")
    elif args.command == "accept":
        result = accept_batch(args.batch_id, _load_manifest(args.manifest))
        print(f"Accepted: {result}")
    elif args.command == "rollback":
        print("Rollback succeeded." if rollback_batch(args.batch_id) else "Batch was not active.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
