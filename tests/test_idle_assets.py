#!/usr/bin/env python3
"""Deterministic acceptance checks for DATAMON's full-roster directional idle package."""

from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
IDLE_ROOT = ROOT / "datamon" / "sprites-idle"
PILOT_ROOT = ROOT / "datamon" / "sprites-locomotion-pilot"
MANIFEST_PATH = IDLE_ROOT / "manifest.json"
SPRITES_ROOT = ROOT / "datamon" / "sprites"
DIRECTIONS = ("down", "up", "left", "right")
RUNTIME_FRAME_SCALE = 56 / 224


class IdleAssetContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.roster = sorted(path.stem for path in SPRITES_ROOT.glob("*.png"))
        cls.manifest_bytes = MANIFEST_PATH.read_bytes()
        cls.manifest = json.loads(cls.manifest_bytes)

    def test_manifest_is_canonical_complete_and_reviewed(self):
        self.assertEqual(self.roster, self.manifest["roster"])
        self.assertEqual(self.manifest_bytes, (json.dumps(self.manifest, sort_keys=True, separators=(",", ":")) + "\n").encode())
        self.assertEqual(self.manifest["schemaVersion"], 1)
        self.assertEqual(self.manifest["reviewState"], "accepted")
        self.assertEqual(self.manifest["slugCount"], len(self.roster))
        self.assertEqual(self.manifest["assetCount"], len(self.roster) * len(DIRECTIONS))
        self.assertEqual(self.manifest["directions"], list(DIRECTIONS))
        self.assertEqual(self.manifest["canvas"], {
            "height": 240, "groundY": 228, "runtimeModelVisibleHeight": 56, "runtimeVisibleRatio": 14 / 15,
        })
        self.assertEqual([entry["slug"] for entry in self.manifest["entries"]], self.roster)
        review = self.manifest["review"]
        self.assertTrue(review["reviewed"])
        # Contact sheets and raw outputs are intentionally private/ignored. The public manifest
        # pins their canonical private paths and hashes without making clean-clone tests depend
        # on local generation residue.
        self.assertEqual(review["sourceContactSheet"], "datamon/.idle-gen-cache/reviews/source-contact-sheet.png")
        self.assertEqual(review["runtimeContactSheet"], "datamon/.idle-gen-cache/reviews/runtime-contact-sheet.png")
        self.assertRegex(review["sourceContactSheetSha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(review["runtimeContactSheetSha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(self.manifest["generation"]["callCap"], 50)
        self.assertLessEqual(self.manifest["generation"]["totalCalls"], 50)

    def test_public_package_is_exact_roster_times_four_and_hashes_match_manifest(self):
        expected = {"manifest.json"}
        for slug in self.roster:
            for direction in DIRECTIONS:
                expected.add(f"{slug}/idle_{direction}.png")
        actual = {path.relative_to(IDLE_ROOT).as_posix() for path in IDLE_ROOT.rglob("*") if path.is_file()}
        self.assertEqual(actual, expected)

        aggregate = hashlib.sha256()
        for entry in self.manifest["entries"]:
            self.assertEqual(entry["reviewState"], "accepted")
            self.assertEqual(set(entry["directions"]), set(DIRECTIONS))
            for direction in DIRECTIONS:
                frame = entry["directions"][direction]
                path = IDLE_ROOT / frame["file"]
                data = path.read_bytes()
                self.assertEqual(hashlib.sha256(data).hexdigest(), frame["sha256"])
                aggregate.update(frame["file"].encode())
                aggregate.update(b"\0")
                aggregate.update(data)
                aggregate.update(b"\0")
        self.assertEqual(aggregate.hexdigest(), self.manifest["batchSha256"])

    def test_legacy_pilot_profiles_are_remapped_to_semantic_directions(self):
        # The original three-character pilot labeled its authored profile pair backwards.
        # The full-roster package fixes direction without mutating accepted pilot assets.
        for slug in ("alex-andrianavalontsalama", "julien-hovan", "veronica-marallag"):
            self.assertEqual(
                (IDLE_ROOT / slug / "idle_right.png").read_bytes(),
                (PILOT_ROOT / slug / "idle_left.png").read_bytes(),
            )
            self.assertEqual(
                (IDLE_ROOT / slug / "idle_left.png").read_bytes(),
                (PILOT_ROOT / slug / "idle_right.png").read_bytes(),
            )

    def test_all_directional_idles_are_grounded_neutral_and_runtime_scaled(self):
        for entry in self.manifest["entries"]:
            for direction in DIRECTIONS:
                frame_meta = entry["directions"][direction]
                with Image.open(IDLE_ROOT / frame_meta["file"]) as image:
                    self.assertEqual(image.mode, "RGBA")
                    self.assertEqual((image.width, image.height), (frame_meta["width"], frame_meta["height"]))
                    self.assertEqual(image.height, 240)
                    self.assertEqual(frame_meta["phase"], 0)
                    self.assertIsNone(frame_meta["contactFoot"])
                    alpha = np.asarray(image)[:, :, 3]
                    ys, xs = np.where(alpha >= 128)
                    self.assertGreater(len(ys), 0, frame_meta["file"])
                    visible_h = int(ys.max() - ys.min() + 1)
                    visible_w = int(xs.max() - xs.min() + 1)
                    self.assertEqual(frame_meta["footY"], int(ys.max()))
                    self.assertGreaterEqual(frame_meta["bodyX"], 0)
                    self.assertLess(frame_meta["bodyX"], image.width)
                    self.assertGreaterEqual(frame_meta["rootY"], int(ys.min()))
                    self.assertLessEqual(frame_meta["rootY"], int(ys.max()))
                    self.assertLessEqual(visible_w, int(visible_h * 0.66), f"non-neutral silhouette: {frame_meta['file']}")
                    runtime_visible = visible_h * RUNTIME_FRAME_SCALE
                    self.assertGreaterEqual(runtime_visible, 53.0, frame_meta["file"])
                    self.assertLessEqual(runtime_visible, 56.0, frame_meta["file"])


if __name__ == "__main__":
    unittest.main()
