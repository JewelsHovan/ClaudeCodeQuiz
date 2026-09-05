#!/usr/bin/env python3
"""Rebuild the reviewed vertical-only repair from frozen, locally cached source sheets.

The provider's first two accepted poses form one half-cycle. Opposite leg phases are
baked below the upper thigh, without flipping faces, hair parts, buttons or sleeves.
No renderer, speed, scale, horizontal animation or idle asset is changed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

import gen_walk_assets as walk

HERE = Path(__file__).resolve().parent
RECIPE = HERE / 'vertical_walk_repairs.json'
SOURCE_ROOT = HERE.parent / '.walk-gen-cache' / 'vertical-v1'
SPLIT_FRACTION = .66
BLEND_ROWS = 4


def leg_geometry(frame: Image.Image) -> tuple[int, int]:
    alpha = np.asarray(frame.convert('RGBA'))[:, :, 3]
    ys, _ = np.where(alpha >= 128)
    if not len(ys):
        raise ValueError('empty vertical walk frame')
    y0, y1 = int(ys.min()), int(ys.max())
    split = y0 + round((y1 - y0 + 1) * SPLIT_FRACTION)
    # The mid-thigh silhouette excludes hands and supplies the pelvis reflection axis.
    centers = []
    for row in alpha[split + BLEND_ROWS:split + BLEND_ROWS + 8]:
        xs = np.flatnonzero(row >= 128)
        if len(xs):
            centers.append(int(xs.min()) + int(xs.max()))
    if not centers:
        raise ValueError('vertical walk frame has no connected thighs')
    return split, round(float(np.median(centers)))


def opposite_leg_phase(frame: Image.Image) -> Image.Image:
    """Reflect only the leg artwork, retaining original upper-body identity pixels."""
    source = np.asarray(frame.convert('RGBA')).copy()
    split, axis2 = leg_geometry(frame)
    reflected = np.zeros_like(source)
    source_x = axis2 - np.arange(frame.width)
    valid = (source_x >= 0) & (source_x < frame.width)
    reflected[:, valid] = source[:, source_x[valid]]
    # Fail closed rather than silently clipping a shoe outside the padded canvas.
    lost = (axis2 - np.arange(frame.width) < 0) | (axis2 - np.arange(frame.width) >= frame.width)
    if np.any(source[split:, lost, 3] >= 128):
        raise ValueError('opposite leg phase would clip visible artwork')
    result = source.copy()
    result[split + BLEND_ROWS:] = reflected[split + BLEND_ROWS:]
    # Premultiplied blending avoids a hard trouser-shading seam or magenta alpha halos.
    for row in range(BLEND_ROWS):
        y = split + row
        t = (row + 1) / (BLEND_ROWS + 1)
        a, b = source[y].astype(float), reflected[y].astype(float)
        alpha = a[:, 3:4] * (1 - t) + b[:, 3:4] * t
        premul = a[:, :3] * a[:, 3:4] * (1 - t) + b[:, :3] * b[:, 3:4] * t
        rgb = np.divide(premul, alpha, out=np.zeros_like(premul), where=alpha > 0)
        result[y] = np.rint(np.concatenate([rgb, alpha], axis=1)).astype(np.uint8)
    return Image.fromarray(result)


def build(source_root: Path, output_root: Path) -> None:
    recipe = json.loads(RECIPE.read_text())
    for entry in recipe['views']:
        slug, direction = entry['slug'], entry['direction']
        source = source_root / entry['source']
        if hashlib.sha256(source.read_bytes()).hexdigest() != entry['sourceSha256']:
            raise ValueError(f'unreviewed source sheet: {source}')
        candidates = walk.slice_sheet(source, f'{slug}/{direction}')
        if candidates is None:
            raise ValueError(f'cannot slice: {source}')
        first, second = [candidates[i] for i in entry['halfCycle']]
        frames = [first, second, opposite_leg_phase(first), opposite_leg_phase(second)]
        folder = output_root / slug
        folder.mkdir(parents=True, exist_ok=True)
        for i, frame in enumerate(frames):
            frame.save(folder / f'{direction}_{i}.png')


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, default=SOURCE_ROOT)
    parser.add_argument('--output-dir', type=Path, required=True, help='Review staging directory, not the runtime tree')
    args = parser.parse_args()
    if args.output_dir.resolve() == walk.OUT_ROOT.resolve():
        parser.error('stage first; promote only visually accepted files and regenerate anchors separately')
    build(args.source_dir, args.output_dir)


if __name__ == '__main__':
    main()
