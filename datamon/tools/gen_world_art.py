#!/usr/bin/env python3
"""Deterministic 2× Agent Wing art recipe for ticket #044.

The recipe uses new Pillow primitives and physical-pixel texture clusters. It never
reads/upscales legacy art and never writes ``environment/accepted``. Output remains
ignored staging material until the exact G1 contact sheet is reviewed by a human.
"""

from __future__ import annotations

import hashlib
import json
import random
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
BATCH_ID = "batch-agent-wing"
BATCH_DIR = DATAMON / ".environment-work" / "staging" / BATCH_ID

# Incident Command anchors plus a restrained material palette.
P = {
    "midnight": (8, 20, 38, 255),
    "midnight2": (12, 29, 49, 255),
    "cobalt": (47, 111, 237, 255),
    "cyan": (69, 215, 232, 255),
    "amber": (242, 179, 93, 255),
    "brick": (123, 70, 56, 255),
    "bone": (232, 223, 200, 255),
    "coral": (249, 115, 91, 255),
    "walnut": (91, 61, 38, 255),
    "walnut_dark": (48, 34, 27, 255),
    "walnut_light": (131, 91, 54, 255),
    "steel": (45, 55, 72, 255),
    "steel_light": (103, 113, 125, 255),
    "glass": (25, 54, 78, 255),
    "paper": (224, 217, 198, 255),
    "ceramic": (204, 207, 201, 255),
    "fabric": (62, 70, 72, 255),
    "fabric_light": (83, 91, 91, 255),
    "rug": (74, 59, 60, 255),
}
CLEAR = (0, 0, 0, 0)


def rgba(rgb, alpha=255):
    return tuple(rgb[:3]) + (alpha,)


def shade(color, amount, alpha=None):
    a = color[3] if alpha is None else alpha
    return tuple(max(0, min(255, channel + amount)) for channel in color[:3]) + (a,)


def canvas(size, fill=CLEAR):
    return Image.new("RGBA", size, fill)


def soft_shadow(image, boxes):
    """Draw stepped pixel-soft grounding shadows, largest/softest first."""
    layer = canvas(image.size)
    draw = ImageDraw.Draw(layer)
    for box, alpha in boxes:
        draw.ellipse(box, fill=(2, 8, 15, alpha))
    image.alpha_composite(layer)


def draw_wrapped_rect(draw, box, fill, size=(64, 64)):
    x0, y0, x1, y1 = box
    for dx in (-size[0], 0, size[0]):
        for dy in (-size[1], 0, size[1]):
            draw.rectangle((x0 + dx, y0 + dy, x1 + dx, y1 + dy), fill=fill)


# ---- 64×64 architecture / surface members -------------------------------

def brick_tile(base, painted=False):
    """Tileable recessed mortar, staggered courses, face depth, and restrained wear."""
    mortar = (63, 55, 53, 255) if not painted else (127, 122, 113, 255)
    image = canvas((64, 64), mortar)
    draw = ImageDraw.Draw(image)
    rng = random.Random(4402 if painted else 4401)
    pitch, brick_w = 32, 29
    for row, y in enumerate(range(0, 64, 16)):
        offset = -16 if row % 2 else 0
        for start in range(offset - pitch, 96, pitch):
            variant = ((start // pitch) + row * 3) % 5
            if painted:
                body = (196 + variant * 3, 191 + variant * 2, 180 + variant, 255)
                top = shade(body, 14)
                bottom = shade(body, -18)
            else:
                body = shade(base, (-8, 2, 7, -3, 4)[variant])
                top = shade(body, 13)
                bottom = shade(body, -18)
            draw_wrapped_rect(draw, (start + 1, y + 2, start + brick_w, y + 14), body)
            draw_wrapped_rect(draw, (start + 2, y + 2, start + brick_w - 1, y + 3), top)
            draw_wrapped_rect(draw, (start + 1, y + 13, start + brick_w, y + 14), bottom)
            # Uneven fired-clay/paint clusters at physical source resolution.
            for _ in range(6):
                px = start + rng.randrange(3, brick_w - 1)
                py = y + rng.randrange(5, 13)
                tone = shade(body, rng.choice((-15, -9, 9, 12)))
                draw_wrapped_rect(draw, (px, py, px, py), tone)
            if painted and (row + variant) % 3 == 0:
                # A tiny chipped edge exposes umber without turning the wall noisy.
                draw_wrapped_rect(draw, (start + 21, y + 11, start + 23, y + 12), P["brick"])
    # Mortar highlight/shadow makes joints read recessed rather than a bright grid.
    for y in (0, 16, 32, 48):
        draw.line((0, y, 63, y), fill=shade(mortar, -14))
        draw.line((0, (y + 1) % 64, 63, (y + 1) % 64), fill=shade(mortar, 12))
    return image


def draw_brick_red():
    return brick_tile(P["brick"], painted=False)


def draw_brick_white():
    return brick_tile(P["bone"], painted=True)


def draw_hardwood_detail():
    """Subtle walnut boards with staggered joints and fine, non-grid grain."""
    image = canvas((64, 64), P["walnut"])
    draw = ImageDraw.Draw(image)
    rng = random.Random(4410)
    row_colors = [(91, 62, 40, 255), (98, 67, 42, 255), (85, 57, 37, 255), (94, 63, 39, 255)]
    joint_offsets = (19, 47, 30, 56)
    for row in range(4):
        y0 = row * 16
        body = row_colors[row]
        draw.rectangle((0, y0, 63, y0 + 15), fill=body)
        draw.line((0, y0, 63, y0), fill=shade(body, 10))
        draw.line((0, y0 + 15, 63, y0 + 15), fill=shade(body, -18))
        # Long broken fibres; low contrast and never a full orange lattice.
        for grain in range(5):
            gy = y0 + 3 + grain * 2 + (row + grain) % 2
            start = (row * 11 + grain * 17) % 23 - 6
            while start < 64:
                length = 6 + rng.randrange(4, 13)
                tone = shade(body, rng.choice((-10, -7, 7, 9)))
                draw.line((start, gy, min(63, start + length), gy), fill=tone)
                if length > 11 and gy + 1 < y0 + 15:
                    draw.point((min(63, start + length // 2), gy + 1), fill=tone)
                start += length + rng.randrange(5, 12)
        # Staggered end joints, one subtle shadow/highlight pair per course.
        for joint in (joint_offsets[row], joint_offsets[row] - 64):
            if -1 <= joint <= 64:
                draw.line((joint, y0 + 1, joint, y0 + 14), fill=shade(body, -22))
                if joint + 1 < 64:
                    draw.line((joint + 1, y0 + 2, joint + 1, y0 + 13), fill=shade(body, 8))
        # Sparse pores establish true physical-source detail without visual noise.
        for _ in range(5):
            draw.point((rng.randrange(64), y0 + rng.randrange(3, 14)), fill=shade(body, -13))
    return image


def draw_window_industrial():
    """Moody steel-framed rainy night pane with city depth and warm room reflection."""
    image = canvas((64, 64), P["steel"])
    draw = ImageDraw.Draw(image)
    # Deep reveal and glass.
    draw.rectangle((3, 3, 60, 60), fill=(20, 27, 39, 255))
    draw.rectangle((6, 6, 57, 57), fill=P["glass"])
    for y in range(7, 58):
        tone = (20 + y // 8, 45 + y // 10, 67 + y // 7, 255)
        draw.line((7, y, 56, y), fill=tone)
    # Distant skyline and a few practical windows.
    skyline = [(7, 39, 17, 57), (18, 34, 27, 57), (29, 43, 38, 57),
               (39, 31, 47, 57), (49, 37, 56, 57)]
    for index, box in enumerate(skyline):
        draw.rectangle(box, fill=(12, 24, 39, 255))
        if index in (1, 3):
            draw.point((box[0] + 3, box[1] + 7), fill=rgba(P["amber"], 255))
            draw.point((box[0] + 6, box[1] + 12), fill=(91, 146, 158, 255))
    # Upper-left interior reflection, broken into crisp pixel clusters.
    draw.polygon(((8, 8), (26, 8), (45, 28), (38, 31)), fill=(69, 103, 119, 255))
    draw.polygon(((9, 10), (14, 10), (35, 31), (31, 32)), fill=(139, 129, 105, 255))
    # Rain is directional—not random flicker—and has one-pixel source detail.
    for x, y, length in ((10, 21, 6), (18, 12, 8), (28, 27, 7), (36, 15, 5),
                         (46, 23, 9), (53, 10, 6), (14, 48, 5), (42, 46, 6)):
        draw.line((x, y, x - 2, y + length), fill=(102, 149, 168, 255), width=1)
        draw.point((x, y), fill=(172, 199, 204, 255))
    # Powder-coated frame and upper-left edge light.
    draw.rectangle((0, 0, 63, 4), fill=(29, 37, 49, 255))
    draw.rectangle((0, 59, 63, 63), fill=(25, 31, 42, 255))
    draw.rectangle((0, 0, 4, 63), fill=(35, 44, 57, 255))
    draw.rectangle((59, 0, 63, 63), fill=(23, 30, 42, 255))
    draw.line((4, 5, 58, 5), fill=(91, 105, 114, 255))
    draw.line((5, 5, 5, 58), fill=(78, 91, 102, 255))
    return image


def draw_agent_wing_lighting():
    """Dithered upper-left practical light; no smooth vector gradient."""
    image = canvas((64, 64))
    pixels = image.load()
    bayer = ((0, 8, 2, 10), (12, 4, 14, 6), (3, 11, 1, 9), (15, 7, 13, 5))
    alpha_steps = (0, 16, 24, 34, 46, 60, 76)
    for y in range(64):
        for x in range(64):
            distance = x * 0.78 + y * 1.05
            strength = max(0, 72 - int(distance))
            level = min(len(alpha_steps) - 1, strength // 11)
            if level and bayer[y % 4][x % 4] < min(16, level * 3):
                alpha = alpha_steps[level]
                pixels[x, y] = rgba(P["amber"], alpha)
            elif x > 44 and y > 44 and (x + y) % 5 == 0:
                pixels[x, y] = (8, 20, 38, 14)
    # Small fixture-facing highlight in the source pixel grid.
    draw = ImageDraw.Draw(image)
    draw.rectangle((1, 1, 18, 2), fill=(255, 236, 190, 88))
    draw.rectangle((1, 3, 10, 3), fill=(255, 236, 190, 52))
    return image


# ---- Cutout props --------------------------------------------------------

def draw_starry_painting():
    image = canvas((128, 64))
    draw = ImageDraw.Draw(image)
    # Real transparent wall margin surrounds a dimensional walnut frame.
    draw.rectangle((7, 7, 120, 56), fill=(39, 27, 23, 255))
    draw.rectangle((9, 8, 118, 10), fill=P["walnut_light"])
    draw.rectangle((9, 11, 12, 53), fill=(116, 78, 44, 255))
    draw.rectangle((13, 11, 116, 53), fill=P["midnight"])
    # A restrained night painting: one flowing cobalt/cyan current and bone stars.
    draw.line((18, 38, 30, 31, 43, 34, 57, 25, 72, 29, 88, 19, 110, 24),
              fill=(40, 87, 154, 255), width=3)
    draw.line((18, 40, 31, 34, 44, 37, 58, 28, 73, 32, 89, 22, 110, 27),
              fill=(54, 137, 167, 255), width=1)
    for x, y in ((22, 18), (34, 26), (48, 15), (64, 20), (79, 14),
                 (95, 31), (105, 16), (55, 43), (82, 40)):
        draw.point((x, y), fill=P["bone"])
        if (x + y) % 3 == 0:
            draw.point((x + 1, y), fill=(180, 178, 158, 255))
    draw.ellipse((67, 19, 74, 26), fill=rgba(P["amber"]))
    draw.point((70, 18), fill=(255, 239, 195, 255))
    draw.line((13, 54, 116, 54), fill=(27, 20, 19, 255))
    return image


def draw_tv():
    image = canvas((128, 64))
    soft_shadow(image, [((32, 54, 100, 63), 28), ((39, 55, 93, 62), 50)])
    draw = ImageDraw.Draw(image)
    # Thin monitor with visible transparent margins and a real stand/cable silhouette.
    draw.rounded_rectangle((9, 4, 118, 48), radius=4, fill=(24, 31, 42, 255))
    draw.line((13, 5, 114, 5), fill=(81, 92, 104, 255), width=1)
    draw.rectangle((14, 9, 113, 43), fill=P["midnight"])
    draw.rectangle((18, 13, 109, 15), fill=(30, 80, 102, 255))
    draw.rectangle((18, 18, 74, 19), fill=rgba(P["cyan"]))
    draw.rectangle((18, 25, 103, 26), fill=(35, 74, 92, 255))
    draw.rectangle((18, 31, 85, 32), fill=(26, 61, 79, 255))
    # Status topology rather than a generic neon dashboard.
    for x, height in ((22, 5), (35, 9), (48, 6), (61, 12), (74, 8), (87, 14), (100, 7)):
        draw.rectangle((x, 39 - height, x + 3, 39), fill=(55, 137, 151, 255))
        draw.point((x + 1, 38 - height), fill=P["cyan"])
    draw.rectangle((58, 48, 70, 55), fill=P["steel"])
    draw.polygon(((44, 57), (84, 57), (91, 60), (37, 60)), fill=(39, 48, 61, 255))
    draw.line((113, 42, 119, 51, 117, 58), fill=(25, 29, 35, 255), width=1)
    draw.point((116, 57), fill=rgba(P["cyan"]))
    return image


def draw_kallax():
    image = canvas((128, 128))
    soft_shadow(image, [((9, 111, 119, 126), 28), ((16, 113, 112, 124), 44)])
    draw = ImageDraw.Draw(image)
    # Dark powder-coated/walnut unit, viewed slightly from above.
    draw.rounded_rectangle((9, 8, 118, 115), radius=3, fill=P["walnut_dark"])
    draw.polygon(((12, 9), (115, 9), (109, 15), (17, 15)), fill=P["walnut_light"])
    draw.rectangle((15, 16, 112, 108), fill=(25, 31, 36, 255))
    draw.rectangle((61, 14, 67, 111), fill=(55, 43, 34, 255))
    draw.rectangle((13, 60, 115, 67), fill=(56, 43, 33, 255))
    # Recessed cubbies and low-saturation work objects.
    cubbies = ((18, 19, 58, 56), (70, 19, 109, 56),
               (18, 70, 58, 105), (70, 70, 109, 105))
    for box in cubbies:
        draw.rectangle(box, fill=(17, 24, 30, 255))
        draw.line((box[0], box[1], box[2], box[1]), fill=(11, 17, 23, 255))
    book_colors = ((112, 86, 61, 255), (95, 111, 105, 255), (92, 89, 104, 255),
                   (145, 123, 84, 255), (74, 96, 105, 255))
    x = 21
    for index, width in enumerate((4, 5, 3, 6, 4)):
        height = (24, 28, 21, 26, 23)[index]
        draw.rectangle((x, 54 - height, x + width, 54), fill=book_colors[index])
        draw.line((x, 54 - height, x + width, 54 - height), fill=shade(book_colors[index], 18))
        x += width + 2
    # Ceramic bowl + folded paper in the upper-right cubby.
    draw.ellipse((78, 39, 100, 52), fill=(105, 111, 106, 255))
    draw.arc((78, 35, 100, 48), 0, 180, fill=P["bone"], width=2)
    draw.polygon(((75, 23), (101, 23), (98, 31), (78, 30)), fill=(164, 157, 139, 255))
    draw.line((79, 26, 95, 26), fill=(83, 91, 91, 255))
    # Two archival boxes and a tiny blue status light—not rainbow toys.
    draw.rectangle((22, 79, 53, 102), fill=(66, 76, 77, 255))
    draw.rectangle((25, 82, 50, 86), fill=(128, 119, 99, 255))
    draw.rectangle((75, 82, 101, 103), fill=(82, 69, 57, 255))
    draw.rectangle((78, 86, 98, 89), fill=(143, 132, 108, 255))
    draw.point((104, 101), fill=rgba(P["cyan"]))
    # Feet and upper-left edge highlight.
    draw.rectangle((18, 113, 28, 120), fill=(31, 28, 27, 255))
    draw.rectangle((99, 113, 109, 120), fill=(31, 28, 27, 255))
    draw.line((11, 11, 11, 108), fill=(111, 77, 47, 255))
    return image


def draw_couch():
    image = canvas((128, 64))
    soft_shadow(image, [((5, 43, 123, 63), 24), ((12, 47, 117, 61), 48)])
    draw = ImageDraw.Draw(image)
    # Woven charcoal/olive upholstery with readable top-down depth.
    draw.rounded_rectangle((7, 13, 121, 52), radius=9, fill=(47, 53, 53, 255))
    draw.rounded_rectangle((11, 8, 117, 30), radius=7, fill=P["fabric"])
    draw.line((15, 10, 113, 10), fill=P["fabric_light"], width=2)
    draw.rounded_rectangle((13, 25, 61, 49), radius=6, fill=(70, 77, 76, 255))
    draw.rounded_rectangle((66, 25, 114, 49), radius=6, fill=(65, 73, 72, 255))
    draw.line((63, 27, 63, 48), fill=(37, 44, 44, 255), width=2)
    draw.rounded_rectangle((5, 20, 16, 52), radius=5, fill=(53, 59, 58, 255))
    draw.rounded_rectangle((112, 20, 123, 52), radius=5, fill=(45, 51, 51, 255))
    # Bone lumbar cushion and one restrained amber pillow.
    draw.rounded_rectangle((40, 14, 68, 30), radius=4, fill=(181, 174, 155, 255))
    draw.line((44, 16, 64, 16), fill=P["bone"])
    draw.polygon(((77, 15), (99, 17), (96, 35), (74, 32)), fill=(142, 104, 62, 255))
    draw.line((78, 16, 97, 18), fill=(193, 143, 78, 255))
    # Fine woven clusters—visible at DPR2, restrained at logical size.
    for x in range(17, 112, 5):
        for y in range(34, 47, 4):
            tone = (87, 92, 88, 255) if (x + y) % 3 else (49, 59, 59, 255)
            draw.point((x, y), fill=tone)
            if (x + y) % 4 == 0:
                draw.point((x + 1, y + 1), fill=tone)
    draw.rectangle((16, 50, 23, 57), fill=(35, 31, 28, 255))
    draw.rectangle((104, 50, 111, 57), fill=(35, 31, 28, 255))
    return image


def draw_arc_lamp():
    image = canvas((64, 128))
    soft_shadow(image, [((7, 112, 51, 127), 28), ((13, 115, 46, 125), 52)])
    draw = ImageDraw.Draw(image)
    # Restrained dithered practical glow behind the shade.
    for radius, alpha in ((25, 16), (18, 25), (11, 38)):
        layer = canvas(image.size)
        ld = ImageDraw.Draw(layer)
        ld.ellipse((51 - radius, 17 - radius // 2, 51 + radius, 17 + radius),
                   fill=rgba(P["amber"], alpha))
        image.alpha_composite(layer)
    draw = ImageDraw.Draw(image)
    draw.ellipse((10, 112, 43, 124), fill=(31, 39, 51, 255))
    draw.ellipse((15, 113, 38, 119), fill=P["steel"])
    # Thin anti-aliased-looking arc made from crisp stepped steel clusters.
    arc_points = [(27, 114), (27, 84), (28, 60), (31, 41), (36, 28), (43, 19), (52, 15)]
    draw.line(arc_points, fill=(105, 114, 121, 255), width=3)
    draw.line([(x - 1, y) for x, y in arc_points], fill=(56, 66, 78, 255), width=1)
    draw.polygon(((47, 13), (61, 11), (63, 23), (49, 25), (44, 19)), fill=(48, 52, 57, 255))
    draw.line((48, 13, 60, 12), fill=(158, 148, 126, 255), width=2)
    draw.rectangle((50, 24, 59, 26), fill=rgba(P["amber"]))
    draw.point((54, 27), fill=(255, 228, 169, 190))
    return image


def draw_rug():
    """Quiet, fully opaque woven rug—muted border and subtle consulting-blue pinstripe."""
    image = canvas((192, 128), P["rug"])
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 191, 127), fill=(70, 58, 59, 255))
    draw.rectangle((5, 5, 186, 122), outline=(116, 91, 76, 255), width=3)
    draw.rectangle((11, 11, 180, 116), outline=(87, 86, 82, 255), width=1)
    # Woven variation, not a loud repeated diamond field.
    for y in range(15, 115, 4):
        color = (77, 65, 65, 255) if y % 8 else (83, 69, 67, 255)
        draw.line((12, y, 179, y), fill=color)
    for x in range(17, 179, 12):
        draw.line((x, 12, x, 115), fill=(65, 59, 62, 255))
        if x % 24 == 17:
            draw.line((x + 1, 18, x + 1, 109), fill=(67, 79, 86, 255))
    # A few interrupted bone dashes suggest hand weaving.
    for x in range(24, 170, 36):
        draw.line((x, 63, x + 12, 63), fill=(128, 117, 101, 255))
        draw.point((x + 14, 63), fill=(94, 92, 86, 255))
    for x in range(8, 188, 8):
        draw.rectangle((x, 123, x + 2, 127), fill=(95, 76, 68, 255))
        draw.rectangle((x, 0, x + 2, 4), fill=(95, 76, 68, 255))
    return image


def draw_radiator():
    image = canvas((64, 64))
    soft_shadow(image, [((5, 49, 61, 62), 25), ((10, 51, 58, 60), 45)])
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((6, 9, 58, 52), radius=4, fill=(106, 109, 108, 255))
    draw.line((9, 10, 54, 10), fill=(205, 200, 188, 255), width=2)
    for x in range(10, 56, 6):
        draw.rounded_rectangle((x, 13, x + 4, 49), radius=2, fill=(174, 171, 163, 255))
        draw.line((x + 1, 15, x + 1, 46), fill=(222, 216, 203, 255))
        draw.line((x + 4, 16, x + 4, 47), fill=(93, 99, 101, 255))
    draw.line((7, 50, 57, 50), fill=(66, 72, 76, 255), width=2)
    draw.rectangle((12, 51, 17, 58), fill=(55, 59, 61, 255))
    draw.rectangle((47, 51, 52, 58), fill=(55, 59, 61, 255))
    draw.ellipse((52, 5, 62, 14), fill=P["steel_light"])
    draw.point((57, 7), fill=P["bone"])
    return image


def draw_collaboration_table():
    image = canvas((128, 64))
    soft_shadow(image, [((6, 34, 123, 62), 24), ((13, 39, 117, 58), 48)])
    draw = ImageDraw.Draw(image)
    # Low rounded walnut worktable, visibly a cutout rather than an opaque tile.
    draw.rounded_rectangle((6, 9, 122, 34), radius=9, fill=P["walnut_dark"])
    draw.rounded_rectangle((8, 6, 119, 30), radius=8, fill=(113, 77, 45, 255))
    draw.line((16, 8, 111, 8), fill=(153, 111, 67, 255), width=2)
    for y, starts in ((13, (18, 53, 88)), (18, (10, 42, 79)), (24, (26, 65, 100))):
        for start in starts:
            draw.line((start, y, min(114, start + 15), y), fill=(91, 59, 38, 255))
            draw.point((start + 4, y + 1), fill=(137, 93, 52, 255))
    # Dark steel trestle and grounding.
    draw.polygon(((17, 31), (25, 31), (30, 57), (23, 57)), fill=P["steel"])
    draw.polygon(((103, 31), (111, 31), (105, 57), (98, 57)), fill=P["steel"])
    draw.line((27, 46, 102, 46), fill=(37, 44, 55, 255), width=3)
    # Coffee ceramic, papers, pencil and a real cable run.
    draw.ellipse((37, 3, 54, 15), fill=P["ceramic"])
    draw.ellipse((40, 5, 51, 11), fill=(53, 37, 25, 255))
    draw.arc((49, 5, 59, 15), 265, 95, fill=(184, 187, 181, 255), width=2)
    draw.polygon(((67, 5), (96, 8), (92, 21), (64, 17)), fill=P["paper"])
    draw.line((70, 10, 90, 12), fill=(102, 108, 106, 255))
    draw.line((69, 14, 84, 15), fill=(122, 123, 116, 255))
    draw.line((63, 21, 92, 4), fill=(171, 126, 61, 255), width=2)
    draw.line((96, 20, 112, 28, 116, 42), fill=(25, 31, 39, 255), width=1)
    draw.point((116, 43), fill=rgba(P["cyan"]))
    return image


# ---- Horizontal ambient sheets -----------------------------------------

def draw_ambient_windows():
    """8 × 320×64 source frames (five logical 32px windows at sourceScale 2)."""
    frames, fw, fh = 8, 320, 64
    strip = canvas((frames * fw, fh))
    for frame in range(frames):
        layer = canvas((fw, fh))
        draw = ImageDraw.Draw(layer)
        # Slow weather travel: same rain field shifts cyclically, never random flicker.
        for index in range(34):
            base_x = (index * 47 + 19) % fw
            base_y = (index * 29 + 7) % 58
            x = (base_x + frame * 3) % fw
            y = (base_y + frame * 5) % 58
            alpha = (56, 72, 88)[index % 3]
            draw.line((x, y, max(0, x - 2), min(63, y + 7)), fill=(137, 184, 199, alpha))
            if index % 5 == 0:
                draw.point((x, y), fill=(204, 220, 219, 120))
        # Warm room reflection travels only one pixel over the complete cycle.
        reflection_x = 18 + (frame // 4)
        for pane in range(5):
            ox = pane * 64
            draw.polygon(((ox + reflection_x, 7), (ox + 27, 7),
                          (ox + 48, 28), (ox + 42, 31)),
                         fill=(242, 179, 93, 18 + (pane % 2) * 7))
            draw.line((ox + 3, 59, ox + 60, 59), fill=(69, 215, 232, 20))
        strip.alpha_composite(layer, (frame * fw, 0))
    return strip


def draw_ambient_tv():
    frames, fw, fh = 6, 128, 64
    strip = canvas((frames * fw, fh))
    for frame in range(frames):
        layer = canvas((fw, fh))
        draw = ImageDraw.Draw(layer)
        # Screen-local topology pulse with restrained cyan, body remains static underneath.
        draw.rectangle((15, 10, 112, 43), fill=(8, 20, 38, 22))
        pulse_x = 20 + frame * 14
        draw.line((19, 18, 108, 18), fill=(69, 215, 232, 45))
        draw.rectangle((pulse_x, 16, min(109, pulse_x + 17), 20), fill=(69, 215, 232, 118))
        nodes = ((25, 28), (44, 34), (66, 26), (88, 36), (104, 29))
        for index, (x, y) in enumerate(nodes):
            alpha = 145 if index == frame % len(nodes) else 70
            draw.rectangle((x, y, x + 3, y + 3), fill=(69, 215, 232, alpha))
            if index:
                px, py = nodes[index - 1]
                draw.line((px + 3, py + 1, x, y + 1), fill=(47, 111, 237, 58))
        draw.point((110, 40), fill=(242, 179, 93, 130))
        strip.alpha_composite(layer, (frame * fw, 0))
    return strip


def draw_ambient_lamp():
    frames, fw, fh = 4, 64, 128
    strip = canvas((frames * fw, fh))
    bayer = ((0, 2), (3, 1))
    for frame in range(frames):
        layer = canvas((fw, fh))
        pixels = layer.load()
        strength = (30, 38, 34, 31)[frame]
        for y in range(20, 82):
            for x in range(17, 64):
                distance = abs(x - 52) + abs(y - 28) * 0.55
                if distance < 42 and bayer[y % 2][x % 2] <= max(0, 3 - int(distance // 14)):
                    pixels[x, y] = rgba(P["amber"], max(8, strength - int(distance / 2)))
        draw = ImageDraw.Draw(layer)
        draw.line((50, 25, 60, 25), fill=(255, 228, 169, 90 + frame * 5), width=1)
        draw.point((56 - frame % 2, 27), fill=(255, 238, 198, 140))
        strip.alpha_composite(layer, (frame * fw, 0))
    return strip


def draw_ambient_table():
    frames, fw, fh = 6, 128, 64
    strip = canvas((frames * fw, fh))
    steam_paths = (
        ((43, 3), (42, 1)), ((45, 4), (46, 1)), ((47, 3), (48, 0)),
        ((44, 4), (43, 1)), ((46, 3), (47, 0)), ((45, 4), (45, 1)),
    )
    for frame in range(frames):
        layer = canvas((fw, fh))
        draw = ImageDraw.Draw(layer)
        path = steam_paths[frame]
        draw.line((*path[0], *path[1]), fill=(218, 219, 207, 72), width=1)
        draw.point((path[1][0] + 1, path[1][1]), fill=(218, 219, 207, 34))
        # Paper status dot and cable pulse are tied to real work artifacts.
        draw.point((72 + frame * 3, 14 + frame % 2), fill=(47, 111, 237, 85))
        draw.line((98, 21, 110, 27), fill=(69, 215, 232, 25 + frame * 10))
        draw.point((111, 28), fill=(69, 215, 232, 70 + frame * 8))
        strip.alpha_composite(layer, (frame * fw, 0))
    return strip


# ---- Manifest ------------------------------------------------------------

def build_manifest():
    provenance = "pillow-primitives:agent-wing-v2"

    def member(identifier, kind, slug, filename, width, height, alpha_mode, fallback,
               *, tile_w=None, tile_h=None, anchor_x=0, anchor_y=0, animation=None,
               placement=None, zone="AGENT", collision=None, max_colors=128):
        entry = {
            "id": identifier,
            "kind": kind,
            "slug": slug,
            "file": filename,
            "widthPx": width,
            "heightPx": height,
            "sourceScale": 2,
            "sourceWidthPx": width * 2,
            "sourceHeightPx": height * 2,
            "alphaMode": alpha_mode,
            "scene": "office",
            "fallback": fallback,
            "provenance": provenance,
            "reviewState": "pending",
            "batchId": BATCH_ID,
            "maxColors": max_colors,
        }
        if zone:
            entry["zone"] = zone
        if kind == "prop":
            entry.update({
                "tileW": tile_w, "tileH": tile_h,
                "anchorX": anchor_x, "anchorY": anchor_y,
            })
        if animation:
            entry["animation"] = animation
        if placement:
            entry["placement"] = placement
        if collision:
            entry["collision"] = collision
        return entry

    entries = [
        member("hd-brick-red", "tile", "brick-red", "hd-brick-red.png", 32, 32,
               "opaque", "legacy:tiles/brick-red.png", zone=None, max_colors=64),
        member("hd-brick-white", "tile", "brick-white", "hd-brick-white.png", 32, 32,
               "opaque", "legacy:tiles/brick-white.png", zone=None, max_colors=64),
        member("hd-window-industrial", "tile", "window-h", "hd-window-industrial.png", 32, 32,
               "opaque", "legacy:tiles/window-h.png", zone=None, max_colors=96),
        member("hd-hardwood-detail", "tile", "hardwood-a", "hd-hardwood-detail.png", 32, 32,
               "opaque", "procedural:walnut-floor", zone=None, max_colors=64),
        member("hd-agent-wing-lighting", "overlay", "agent-wing-lighting",
               "hd-agent-wing-lighting.png", 32, 32, "soft", "procedural:none",
               placement={"col": 1, "row": 1, "layer": "back"}, max_colors=32),
        member("hd-starry-painting", "prop", "starry-painting", "hd-starry-painting.png",
               64, 32, "binary", "legacy:props/starry-painting.png", tile_w=2, tile_h=1,
               max_colors=64),
        member("hd-tv", "prop", "tv", "hd-tv.png", 64, 32, "soft", "legacy:props/tv.png",
               tile_w=2, tile_h=1, max_colors=64),
        member("hd-kallax", "prop", "kallax", "hd-kallax.png", 64, 64, "soft",
               "legacy:props/kallax.png", tile_w=2, tile_h=2, anchor_y=32, max_colors=96),
        member("hd-couch", "prop", "couch", "hd-couch.png", 64, 32, "soft",
               "legacy:props/couch.png", tile_w=2, tile_h=1, max_colors=64),
        member("hd-arc-lamp", "prop", "arc-lamp", "hd-arc-lamp.png", 32, 64, "soft",
               "legacy:props/arc-lamp.png", tile_w=1, tile_h=2, anchor_y=32, max_colors=64),
        member("hd-rug", "prop", "rug", "hd-rug.png", 96, 64, "opaque",
               "legacy:props/rug.png", tile_w=3, tile_h=2, anchor_y=32, max_colors=32),
        member("hd-radiator", "prop", "radiator", "hd-radiator.png", 32, 32, "soft",
               "legacy:props/radiator.png", tile_w=1, tile_h=1, zone=None, max_colors=48),
        member("hd-collaboration-table", "prop", "collaboration-table",
               "hd-collaboration-table.png", 64, 32, "soft", "procedural:collaboration-table",
               tile_w=2, tile_h=1, placement={"col": 1, "row": 5, "layer": "sorted"},
               collision="none", max_colors=96),
        member("hd-amb-windows", "ambient", "amb-windows", "hd-amb-windows.png", 160, 32,
               "soft", "procedural:none", animation={"frames": 8, "fps": 8, "layout": "horizontal"},
               placement={"col": 1, "row": 0, "layer": "back"}, max_colors=48),
        member("hd-amb-tv", "ambient", "amb-tv", "hd-amb-tv.png", 64, 32, "soft",
               "procedural:none", animation={"frames": 6, "fps": 6, "layout": "horizontal"},
               placement={"col": 6, "row": 0, "layer": "back"}, max_colors=48),
        member("hd-amb-lamp", "ambient", "amb-lamp", "hd-amb-lamp.png", 32, 64, "soft",
               "procedural:none", animation={"frames": 4, "fps": 4, "layout": "horizontal"},
               placement={"col": 7, "row": 4, "layer": "back"}, max_colors=64),
        member("hd-amb-table", "ambient", "amb-table", "hd-amb-table.png", 64, 32, "soft",
               "procedural:none", animation={"frames": 6, "fps": 5, "layout": "horizontal"},
               placement={"col": 1, "row": 5, "layer": "sorted"}, max_colors=48),
    ]
    return entries


GENERATORS = [
    ("hd-brick-red.png", draw_brick_red),
    ("hd-brick-white.png", draw_brick_white),
    ("hd-window-industrial.png", draw_window_industrial),
    ("hd-hardwood-detail.png", draw_hardwood_detail),
    ("hd-agent-wing-lighting.png", draw_agent_wing_lighting),
    ("hd-starry-painting.png", draw_starry_painting),
    ("hd-tv.png", draw_tv),
    ("hd-kallax.png", draw_kallax),
    ("hd-couch.png", draw_couch),
    ("hd-arc-lamp.png", draw_arc_lamp),
    ("hd-rug.png", draw_rug),
    ("hd-radiator.png", draw_radiator),
    ("hd-collaboration-table.png", draw_collaboration_table),
    ("hd-amb-windows.png", draw_ambient_windows),
    ("hd-amb-tv.png", draw_ambient_tv),
    ("hd-amb-lamp.png", draw_ambient_lamp),
    ("hd-amb-table.png", draw_ambient_table),
]


def file_hashes(directory):
    return {
        path.name: hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(directory.iterdir()) if path.is_file() and path.name != "SHA256SUMS"
    }


def generate_all():
    # Revision replaces only ignored staging. Accepted runtime output is never touched.
    if BATCH_DIR.exists():
        shutil.rmtree(BATCH_DIR)
    BATCH_DIR.mkdir(parents=True)
    for filename, generator in GENERATORS:
        image = generator()
        image.save(BATCH_DIR / filename, "PNG", optimize=False, compress_level=9)
    manifest = build_manifest()
    (BATCH_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    # Fail closed through the production validator before producing sums/contact material.
    sys.path.insert(0, str(HERE))
    from art_pipeline import validate_batch
    errors = validate_batch(BATCH_DIR, manifest)
    if errors:
        raise RuntimeError("Generated batch is invalid:\n" + "\n".join(errors))

    hashes = file_hashes(BATCH_DIR)
    (BATCH_DIR / "SHA256SUMS").write_text(
        "".join(f"{digest}  {name}\n" for name, digest in sorted(hashes.items()))
    )
    return BATCH_DIR, manifest, hashes


def main(argv):
    validate_twice = "--validate-twice" in argv
    first_dir, _, first = generate_all()
    if validate_twice:
        saved = first_dir.parent / f".{BATCH_ID}-first"
        if saved.exists():
            shutil.rmtree(saved)
        shutil.move(first_dir, saved)
        try:
            second_dir, _, second = generate_all()
            if first != second:
                missing = sorted(set(first) ^ set(second))
                changed = sorted(name for name in set(first) & set(second) if first[name] != second[name])
                raise RuntimeError(f"Non-deterministic output; missing={missing}, changed={changed}")
            shutil.rmtree(saved)
            print(f"Deterministic identity: {len(second)} files match across two clean runs.")
        except Exception:
            if BATCH_DIR.exists():
                shutil.rmtree(BATCH_DIR)
            shutil.move(saved, BATCH_DIR)
            raise
    else:
        print(f"Generated {len(GENERATORS)} staged PNGs at {BATCH_DIR}")
    for name, digest in sorted(file_hashes(BATCH_DIR).items()):
        print(f"{digest}  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
