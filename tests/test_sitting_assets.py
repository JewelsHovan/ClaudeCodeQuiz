#!/usr/bin/env python3
"""Focused posture and determinism tests for ticket #048 sitting assets."""

from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "datamon" / "tools" / "gen_sitting_assets.py"
SPEC = importlib.util.spec_from_file_location("datamon_sitting_assets", MODULE_PATH)
sitting = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sitting
assert SPEC.loader is not None
SPEC.loader.exec_module(sitting)


class SittingAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "datamon"
        self.walk = self.root / "sprites-walk"
        self.out = self.root / "sprites-sit"
        self.walk.mkdir(parents=True)
        self.original_paths = sitting.ROOT, sitting.SPRITES_WALK, sitting.OUT_DIR
        sitting.ROOT, sitting.SPRITES_WALK, sitting.OUT_DIR = self.root, self.walk, self.out

    def tearDown(self):
        sitting.ROOT, sitting.SPRITES_WALK, sitting.OUT_DIR = self.original_paths
        self.temp.cleanup()

    @staticmethod
    def synthetic_standing_source() -> Image.Image:
        """Rear figure with unmistakable lower legs and magenta source shoes."""
        image = Image.new("RGBA", (100, 240))
        draw = ImageDraw.Draw(image)
        draw.ellipse((31, 8, 69, 52), fill=(55, 35, 25, 255))       # hair/head
        draw.rectangle((24, 48, 76, 142), fill=(35, 95, 170, 255)) # shoulders/torso
        draw.rectangle((17, 61, 28, 145), fill=(220, 160, 120, 255))
        draw.rectangle((72, 61, 83, 145), fill=(220, 160, 120, 255))
        draw.rectangle((29, 138, 71, 163), fill=(45, 55, 80, 255))  # pelvis
        draw.rectangle((29, 160, 45, 221), fill=(30, 35, 50, 255))  # standing legs
        draw.rectangle((55, 160, 71, 221), fill=(30, 35, 50, 255))
        draw.rectangle((25, 218, 45, 231), fill=(255, 0, 255, 255)) # shoes: forbidden
        draw.rectangle((55, 218, 75, 231), fill=(255, 0, 255, 255))
        return image

    def copy_accepted_sources(self):
        source_root = REPO_ROOT / "datamon" / "sprites-walk"
        for slug in sitting.ROSTER:
            target = self.walk / slug
            target.mkdir()
            # Ticket #048 deliberately needs only one stable, non-walking source frame.
            shutil.copy2(source_root / slug / "up_0.png", target / "up_0.png")

    def generate(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return sitting.generate_sitting_assets()

    def snapshot(self):
        return {
            path.relative_to(self.out).as_posix(): path.read_bytes()
            for path in sorted(self.out.rglob("*")) if path.is_file()
        }

    def rewrite_manifest_hashes(self):
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        digest = hashlib.sha256()
        for entry in manifest["entries"]:
            for frame in entry["frames"]:
                data = (self.root / frame["file"]).read_bytes()
                frame["sha256"] = hashlib.sha256(data).hexdigest()
                digest.update(data)
        manifest["batch_sha256"] = digest.hexdigest()
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    def test_compact_composition_omits_source_legs_and_keeps_lower_body_stable(self):
        source = self.synthetic_standing_source()
        frame0 = sitting.seated_frame(source, 0)
        frame1 = sitting.seated_frame(source, 1)

        for frame in (frame0, frame1):
            self.assertEqual(frame.size, (64, 64))
            self.assertEqual(frame.mode, "RGBA")
            bbox = frame.getchannel("A").getbbox()
            self.assertIsNotNone(bbox)
            assert bbox is not None
            self.assertGreaterEqual(bbox[1], sitting.POSTURE_BOUNDS["top"][0])
            self.assertLessEqual(bbox[3], sitting.POSTURE_BOUNDS["bottom_exclusive"][1])
            self.assertIsNone(frame.crop((0, sitting.FORBIDDEN_LEG_Y, 64, 64)).getchannel("A").getbbox())
            self.assertFalse(any(
                frame.getpixel((x, y)) == (255, 0, 255, 255)
                for y in range(frame.height) for x in range(frame.width)
            ))

        self.assertNotEqual(frame0.tobytes(), frame1.tobytes())
        # The one-pixel seated weight shift affects only head/hair; pelvis cannot "walk".
        stable_y = sitting.POSE_HEAD_Y + sitting.HEAD_HEIGHT
        self.assertEqual(
            frame0.crop((0, stable_y, 64, 64)).tobytes(),
            frame1.crop((0, stable_y, 64, 64)).tobytes(),
        )
        self.assertEqual(sitting.validate_motion_pair(frame0, frame1, "synthetic"), [])

    def test_all_roster_outputs_are_byte_deterministic_and_use_up_zero(self):
        self.copy_accepted_sources()
        first = self.generate()
        first_snapshot = self.snapshot()
        second = self.generate()

        self.assertEqual(first_snapshot, self.snapshot())
        self.assertEqual(first["batch_sha256"], second["batch_sha256"])
        self.assertEqual(sitting.validate_sitting_assets(), [])
        self.assertEqual([entry["slug"] for entry in second["entries"]], sitting.ROSTER)
        for entry in second["entries"]:
            self.assertEqual([frame["frame"] for frame in entry["frames"]], [0, 1])
            self.assertEqual({frame["source"] for frame in entry["frames"]}, {
                f"sprites-walk/{entry['slug']}/up_0.png"
            })
            self.assertEqual(len({frame["sourceSha256"] for frame in entry["frames"]}), 1)

    def test_validation_fails_closed_on_forbidden_alpha_and_source_provenance(self):
        self.copy_accepted_sources()
        self.generate()
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        first = manifest["entries"][0]["frames"][0]
        frame_path = self.root / first["file"]

        with Image.open(frame_path) as image:
            mutated = image.convert("RGBA")
        mutated.putpixel((32, sitting.FORBIDDEN_LEG_Y + 2), (255, 0, 255, 255))
        mutated.save(frame_path, "PNG", optimize=False, compress_level=9)
        self.rewrite_manifest_hashes()  # isolate posture checks from ordinary hash checks
        errors = sitting.validate_sitting_assets()
        self.assertTrue(any("forbidden standing-leg zone" in error for error in errors), errors)

        self.generate()
        manifest = json.loads(manifest_path.read_text())
        second = manifest["entries"][0]["frames"][1]
        second_path = self.root / second["file"]
        with Image.open(second_path) as image:
            mutated = image.convert("RGBA")
        mutated.putpixel((32, sitting.PELVIS_Y + 1), (255, 0, 255, 255))
        mutated.save(second_path, "PNG", optimize=False, compress_level=9)
        self.rewrite_manifest_hashes()
        errors = sitting.validate_sitting_assets()
        self.assertTrue(any("lower body changes like a walk stride" in error for error in errors), errors)

        self.generate()
        manifest = json.loads(manifest_path.read_text())
        manifest["entries"][0]["frames"][1]["source"] = (
            f"sprites-walk/{sitting.ROSTER[0]}/up_1.png"
        )
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors = sitting.validate_sitting_assets()
        self.assertTrue(any("stable source" in error for error in errors), errors)

        self.generate()
        manifest = json.loads(manifest_path.read_text())
        manifest["entries"][0]["frames"][1]["frame"] = True  # bool must not alias integer 1
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors = sitting.validate_sitting_assets()
        self.assertTrue(any("canonical integer [0, 1]" in error for error in errors), errors)

        self.generate()
        unexpected = self.out / "unexpected" / "nested" / "extra.png"
        unexpected.parent.mkdir(parents=True)
        Image.new("RGBA", (1, 1), (255, 0, 255, 255)).save(unexpected)
        errors = sitting.validate_sitting_assets()
        self.assertTrue(any("Unexpected sitting output" in error for error in errors), errors)


if __name__ == "__main__":
    unittest.main()
