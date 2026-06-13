#!/usr/bin/env python3
"""Deterministic generator for DATAMON's shared directional body-frame rig.

Emits 8 sprite-sheet PNGs (128×44 RGBA, 4 frames × 32 wide) into
datamon/sprites/anim/.  Each sheet is a gait+direction combo used by the
overworld walk/run animation system (ticket #012).

Sheet layout  :  4 frames left-to-right, x = i*32, y = 0..43
Head zone     :  y ∈ [0, 18) — left TRANSPARENT so game.js composites the
                 per-character pixelHead on top.  Neckline held at a CONSTANT
                 frame-local y across all 4 frames of every sheet so the
                 composited head never drifts vertically.
Body zone     :  y ∈ [18, 44) — torso + arms + legs painted here.

Walk frames   :  f0 contact/rest (also the idle frame), f1 left-leg forward,
                 f2 passing/contact, f3 right-leg forward.  Smooth loop f3→f0.
Run frames    :  wider stride + slight (1px) forward torso lean + more
                 pronounced arm pump.  Same neckline y.

Directions    :  down (front), up (back), left (profile), right (mirror of left).
                 right is baked in Python — JS does NOT mirror at runtime.

Run:  uv run --with pillow python datamon/tools/gen_anim.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageOps

# ---------- constants ---------------------------------------------------------
FW, FH = 32, 44          # per-frame pixel dimensions
NFRAMES = 4
DIRS = ["down", "up", "left", "right"]
HEAD_ANCHOR_Y = 18       # neckline row (exclusive) — must match game.js ANIM_HEAD_ANCHOR_Y

HERE = os.path.dirname(os.path.abspath(__file__))
OUT  = os.path.normpath(os.path.join(HERE, "..", "sprites", "anim"))

# ---------- GBA-style trainer body palette (RGBA) ----------------------------
CLEAR       = (0, 0, 0, 0)
JACKET      = (71, 102, 171, 255)    # indigo/blue jacket
JACKET_DK   = (49,  73, 130, 255)    # jacket shadow / outline
JACKET_LT   = (110, 142, 208, 255)   # jacket highlight
TROUSER     = (45,  50,  70, 255)    # dark trousers
TROUSER_DK  = (28,  32,  50, 255)    # trouser shadow
SHOE        = (24,  18,  12, 255)    # very dark shoes
SKIN        = (220, 168, 112, 255)   # hands / lower arms
SKIN_DK     = (190, 138,  82, 255)   # hand shadow
OUTLINE     = (20,  18,  14, 255)    # 1px hard edge outline


def new_sheet() -> Image.Image:
    """Transparent 128×44 canvas for one gait+dir sheet."""
    return Image.new("RGBA", (FW * NFRAMES, FH), CLEAR)


def r(d: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, fill) -> None:
    """rectangle helper (coords INCLUSIVE, mirrors gen_tiles convention)."""
    d.rectangle([x0, y0, x1, y1], fill=fill)


# ---------- per-direction frame drawers ---------------------------------------

def draw_body_down(d: ImageDraw.ImageDraw, fx: int,
                   lleg_fwd: int, rleg_fwd: int,
                   larm_dx: int, rarm_dx: int,
                   lean: int = 0) -> None:
    """
    Draw one front-facing (down) body frame into draw-context d at tile x-offset fx.
    lleg_fwd / rleg_fwd : y-offset of lower leg (0 = contact, +2 = stride).
    larm_dx / rarm_dx   : x-offset of lower arm (swing).
    lean                : y-offset of whole torso (0 or +1 for run lean).

    Head zone y∈[0,18) stays transparent — no drawing there.
    Neckline at y=18 is the TOP of the torso block.
    """
    ox, oy = fx, lean   # frame x-origin; oy shifts torso for run lean

    # --- outline / torso body (y 18..33) ---
    r(d, ox+8,  18+oy, ox+23, 33+oy, JACKET_DK)       # outline rect
    r(d, ox+9,  19+oy, ox+22, 32+oy, JACKET)           # jacket fill
    r(d, ox+9,  19+oy, ox+22, 21+oy, JACKET_LT)        # chest highlight
    # belt seam
    r(d, ox+9,  32+oy, ox+22, 33+oy, TROUSER_DK)

    # --- left arm (viewer's left = character's right) ---
    lax = ox + 6 + larm_dx
    r(d, lax,   22+oy, lax+3, 28+oy, JACKET_DK)        # upper arm outline
    r(d, lax+1, 22+oy, lax+2, 27+oy, JACKET)
    r(d, lax,   28+oy, lax+3, 31+oy, SKIN_DK)          # hand outline
    r(d, lax+1, 28+oy, lax+2, 30+oy, SKIN)

    # --- right arm ---
    rax = ox + 23 - rarm_dx
    r(d, rax,   22+oy, rax+3, 28+oy, JACKET_DK)
    r(d, rax+1, 22+oy, rax+2, 27+oy, JACKET)
    r(d, rax,   28+oy, rax+3, 31+oy, SKIN_DK)
    r(d, rax+1, 28+oy, rax+2, 30+oy, SKIN)

    # --- legs (trousers y 33..40, shoes y 41..43) ---
    #   left leg
    r(d, ox+10, 33+oy, ox+15, 40+lleg_fwd, TROUSER_DK)  # outline
    r(d, ox+11, 33+oy, ox+14, 39+lleg_fwd, TROUSER)
    r(d, ox+10, 40+lleg_fwd, ox+15, 43, SHOE)

    #   right leg
    r(d, ox+17, 33+oy, ox+21, 40+rleg_fwd, TROUSER_DK)
    r(d, ox+17, 33+oy, ox+20, 39+rleg_fwd, TROUSER)
    r(d, ox+17, 40+rleg_fwd, ox+21, 43, SHOE)

    # --- outer outline strokes ---
    r(d, ox+8,  18+oy, ox+8,  33+oy, OUTLINE)           # left side
    r(d, ox+23, 18+oy, ox+23, 33+oy, OUTLINE)           # right side
    r(d, ox+8,  18+oy, ox+23, 18+oy, OUTLINE)           # top (neckline)


def draw_body_up(d: ImageDraw.ImageDraw, fx: int,
                 lleg_fwd: int, rleg_fwd: int,
                 larm_dx: int, rarm_dx: int,
                 lean: int = 0) -> None:
    """
    Back-facing (up) body frame.  No face visible.  Same torso silhouette.
    """
    ox, oy = fx, lean

    # --- torso back ---
    r(d, ox+8,  18+oy, ox+23, 33+oy, JACKET_DK)
    r(d, ox+9,  19+oy, ox+22, 32+oy, JACKET)
    # back yoke seam
    r(d, ox+9,  22+oy, ox+22, 23+oy, JACKET_DK)
    r(d, ox+9,  32+oy, ox+22, 33+oy, TROUSER_DK)

    # --- arms (back view — just visible at sides) ---
    lax = ox + 5 + larm_dx
    r(d, lax,   23+oy, lax+3, 30+oy, JACKET_DK)
    r(d, lax+1, 23+oy, lax+2, 29+oy, JACKET)

    rax = ox + 24 - rarm_dx
    r(d, rax,   23+oy, rax+3, 30+oy, JACKET_DK)
    r(d, rax+1, 23+oy, rax+2, 29+oy, JACKET)

    # --- legs ---
    r(d, ox+10, 33+oy, ox+15, 40+lleg_fwd, TROUSER_DK)
    r(d, ox+11, 33+oy, ox+14, 39+lleg_fwd, TROUSER)
    r(d, ox+10, 40+lleg_fwd, ox+15, 43, SHOE)

    r(d, ox+17, 33+oy, ox+21, 40+rleg_fwd, TROUSER_DK)
    r(d, ox+17, 33+oy, ox+20, 39+rleg_fwd, TROUSER)
    r(d, ox+17, 40+rleg_fwd, ox+21, 43, SHOE)

    r(d, ox+8,  18+oy, ox+8,  33+oy, OUTLINE)
    r(d, ox+23, 18+oy, ox+23, 33+oy, OUTLINE)
    r(d, ox+8,  18+oy, ox+23, 18+oy, OUTLINE)


def draw_body_left(d: ImageDraw.ImageDraw, fx: int,
                   leg_phase: int,
                   arm_phase: int,
                   lean: int = 0) -> None:
    """
    Left-profile body frame.
    leg_phase: 0=contact, 1=fwd stride, 2=back stride (for visible leg).
    arm_phase: 0=neutral, 1=fwd, -1=back (for visible arm).
    """
    ox, oy = fx, lean

    # --- torso (thinner profile, ~10px wide centered around x=14) ---
    r(d, ox+11, 18+oy, ox+20, 33+oy, JACKET_DK)
    r(d, ox+12, 19+oy, ox+19, 32+oy, JACKET)
    r(d, ox+12, 19+oy, ox+19, 21+oy, JACKET_LT)
    r(d, ox+12, 32+oy, ox+19, 33+oy, TROUSER_DK)

    # --- front arm (near side, swings forward) ---
    fax_base = ox + 9 + arm_phase
    r(d, fax_base,   22+oy, fax_base+3, 29+oy, JACKET_DK)
    r(d, fax_base+1, 22+oy, fax_base+2, 28+oy, JACKET)
    r(d, fax_base,   29+oy, fax_base+3, 32+oy, SKIN_DK)
    r(d, fax_base+1, 29+oy, fax_base+2, 31+oy, SKIN)

    # --- back arm (far side, slight hint) ---
    bax = ox + 18
    r(d, bax, 23+oy, bax+2, 29+oy, JACKET_DK)

    # --- visible front leg ---
    fleg_y = 33 + oy
    fleg_off = leg_phase * 2        # 0, 2, or -2 (back)
    fleg_knee = max(fleg_y, min(fleg_y + 7 + fleg_off, FH - 2))
    fleg_kneei = max(fleg_y, min(fleg_y + 6 + fleg_off, FH - 2))
    r(d, ox+12, fleg_y,  ox+17, fleg_knee,  TROUSER_DK)
    r(d, ox+13, fleg_y,  ox+16, fleg_kneei, TROUSER)
    if fleg_knee < FH - 1:
        r(d, ox+12, fleg_knee, ox+17, FH - 1, SHOE)

    # --- back leg (partially occluded) ---
    bleg_off = -leg_phase * 2
    bleg_knee = max(fleg_y, min(fleg_y + 6 + bleg_off, FH - 2))
    r(d, ox+13, fleg_y,  ox+18, bleg_knee,  TROUSER_DK)
    if bleg_knee < FH - 1:
        r(d, ox+13, bleg_knee, ox+18, FH - 1, SHOE)

    # outline
    r(d, ox+11, 18+oy, ox+11, 33+oy, OUTLINE)
    r(d, ox+20, 18+oy, ox+20, 33+oy, OUTLINE)
    r(d, ox+11, 18+oy, ox+20, 18+oy, OUTLINE)


# ---------- sheet builders ---------------------------------------------------

def walk_frames_down() -> Image.Image:
    """4-frame walk cycle, front-facing."""
    img = new_sheet()
    d = ImageDraw.Draw(img)
    # f0 contact/rest  f1 left-leg fwd  f2 passing  f3 right-leg fwd
    params = [
        # (lleg, rleg, larm_dx, rarm_dx)
        (0, 0,  0,  0),   # f0 rest
        (2, 0,  0, -2),   # f1 left leg forward, right arm forward
        (0, 0,  0,  0),   # f2 passing contact (same as rest)
        (0, 2, -2,  0),   # f3 right leg forward, left arm forward
    ]
    for i, (ll, rl, lad, rad) in enumerate(params):
        draw_body_down(d, i * FW, ll, rl, lad, rad, lean=0)
    return img


def walk_frames_up() -> Image.Image:
    img = new_sheet()
    d = ImageDraw.Draw(img)
    params = [
        (0, 0,  0,  0),
        (2, 0,  0, -2),
        (0, 0,  0,  0),
        (0, 2, -2,  0),
    ]
    for i, (ll, rl, lad, rad) in enumerate(params):
        draw_body_up(d, i * FW, ll, rl, lad, rad, lean=0)
    return img


def walk_frames_left() -> Image.Image:
    img = new_sheet()
    d = ImageDraw.Draw(img)
    # leg_phase: 0=contact, 1=stride-fwd, 0=contact, -1=stride-back
    # arm_phase: opposite of visible leg
    params = [
        (0,  0),   # f0 rest
        (1, -1),   # f1 leg forward, arm back
        (0,  0),   # f2 contact
        (-1, 1),   # f3 leg back, arm forward
    ]
    for i, (lp, ap) in enumerate(params):
        draw_body_left(d, i * FW, lp, ap, lean=0)
    return img


def run_frames_down() -> Image.Image:
    """4-frame run cycle, front-facing — wider stride, lean +1px, bigger arm pump."""
    img = new_sheet()
    d = ImageDraw.Draw(img)
    # larger stride ±3, lean=1
    params = [
        (0, 0,  0,  0, 0),   # f0 rest
        (3, 0,  0, -3, 1),   # f1 left-leg stride
        (0, 0,  0,  0, 1),   # f2 passing
        (0, 3, -3,  0, 1),   # f3 right-leg stride
    ]
    for i, (ll, rl, lad, rad, lean) in enumerate(params):
        draw_body_down(d, i * FW, ll, rl, lad, rad, lean=lean)
    return img


def run_frames_up() -> Image.Image:
    img = new_sheet()
    d = ImageDraw.Draw(img)
    params = [
        (0, 0,  0,  0, 0),
        (3, 0,  0, -3, 1),
        (0, 0,  0,  0, 1),
        (0, 3, -3,  0, 1),
    ]
    for i, (ll, rl, lad, rad, lean) in enumerate(params):
        draw_body_up(d, i * FW, ll, rl, lad, rad, lean=lean)
    return img


def run_frames_left() -> Image.Image:
    img = new_sheet()
    d = ImageDraw.Draw(img)
    # bigger stride, lean
    params = [
        (0,  0,  0),
        (2, -2,  1),
        (0,  0,  1),
        (-2, 2,  1),
    ]
    for i, (lp, ap, lean) in enumerate(params):
        draw_body_left(d, i * FW, lp, ap, lean=lean)
    return img


# ---------- main --------------------------------------------------------------

SHEETS = {
    "walk_down":  walk_frames_down,
    "walk_up":    walk_frames_up,
    "walk_left":  walk_frames_left,
    "run_down":   run_frames_down,
    "run_up":     run_frames_up,
    "run_left":   run_frames_left,
}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    generated = {}

    # Build the 6 "primary" sheets (down / up / left for walk + run)
    for key, fn in SHEETS.items():
        img = fn()
        path = os.path.join(OUT, f"{key}.png")
        img.save(path, "PNG", optimize=False, compress_level=6)
        print(f"wrote {path}")
        generated[key] = img

    # right = horizontal mirror of left (baked, not done at runtime)
    for gait in ("walk", "run"):
        left_img = generated[f"{gait}_left"]
        # Mirror each 32×44 frame individually, then reassemble
        right_img = new_sheet()
        for i in range(NFRAMES):
            frame_box = (i * FW, 0, (i + 1) * FW, FH)
            frame_crop = left_img.crop(frame_box)
            mirrored = ImageOps.mirror(frame_crop)
            right_img.paste(mirrored, (i * FW, 0))
        path = os.path.join(OUT, f"{gait}_right.png")
        right_img.save(path, "PNG", optimize=False, compress_level=6)
        print(f"wrote {path}")
        generated[f"{gait}_right"] = right_img

    # self-check: open each PNG, assert size + mode
    errors = []
    expected_keys = [f"{g}_{d}" for g in ("walk", "run") for d in DIRS]
    for key in expected_keys:
        path = os.path.join(OUT, f"{key}.png")
        with Image.open(path) as im:
            if im.size != (FW * NFRAMES, FH):
                errors.append(f"{key}.png: size {im.size}, expected ({FW * NFRAMES},{FH})")
            if im.mode != "RGBA":
                errors.append(f"{key}.png: mode {im.mode}, expected RGBA")
    if errors:
        for e in errors:
            print(f"ERROR: {e}")
        raise SystemExit(1)

    print(f"OK: all {len(expected_keys)} anim sheets generated to {OUT} — each {FW * NFRAMES}×{FH} RGBA")


if __name__ == "__main__":
    main()
