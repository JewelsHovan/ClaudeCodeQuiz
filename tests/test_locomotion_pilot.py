#!/usr/bin/env python3
"""Deterministic acceptance checks for the bounded authored locomotion pilot."""
import hashlib
import json
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PILOT_ROOT = ROOT / "datamon" / "sprites-locomotion-pilot"
PILOT = {"julien-hovan", "veronica-marallag", "alex-andrianavalontsalama"}
DIRECTIONS = ("down", "up", "left", "right")
MOTIONS = ("walk", "run")


class LocomotionPilotTests(unittest.TestCase):
    def test_pilot_is_exactly_three_characters_and_canonical(self):
        self.assertEqual({path.name for path in PILOT_ROOT.iterdir() if path.is_dir()}, PILOT)
        for slug in PILOT:
            folder = PILOT_ROOT / slug
            manifest_path = folder / "manifest.json"
            raw_bytes = manifest_path.read_bytes()
            manifest = json.loads(raw_bytes)
            self.assertEqual(raw_bytes, (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode())
            self.assertEqual((manifest["schemaVersion"], manifest["frameCount"], manifest["idleFrameCount"], manifest["cycleDistanceTiles"]), (1, 8, 1, 2))
            self.assertEqual(set(manifest["motions"]), set(MOTIONS) | {"idle"})
            expected = {"manifest.json", *(f"idle_{direction}.png" for direction in DIRECTIONS)}
            for motion in MOTIONS:
                for direction in DIRECTIONS:
                    for index in range(8):
                        expected.add(f"{motion}_{direction}_{index}.png")
            self.assertEqual({path.name for path in folder.iterdir()}, expected)

    def test_directional_idle_is_neutral_complete_and_grounded(self):
        for slug in PILOT:
            folder = PILOT_ROOT / slug
            manifest = json.loads((folder / "manifest.json").read_text())
            for direction in DIRECTIONS:
                with Image.open(folder / f"idle_{direction}.png") as image:
                    anchor = manifest["motions"]["idle"]["frames"][f"{direction}_0"]
                    self.assertEqual(image.mode, "RGBA"); self.assertEqual(image.height, 240)
                    self.assertEqual([image.width, image.height], [anchor["width"], anchor["height"]])
                    self.assertIsNone(anchor["contactFoot"]); self.assertEqual(anchor["phase"], 0)
                    # Neutral idle keeps both shoes close to the common visible baseline.
                    alpha = np.asarray(image)[:, :, 3]; ys, xs = np.where(alpha >= 128)
                    self.assertLessEqual(int(xs.max() - xs.min() + 1), int((ys.max() - ys.min() + 1) * .62))
                    self.assertEqual(anchor["footY"], int(ys.max()))

    def test_frames_match_metadata_and_every_authored_cycle_has_eight_distinct_poses(self):
        for slug in PILOT:
            folder = PILOT_ROOT / slug
            manifest = json.loads((folder / "manifest.json").read_text())
            for motion in MOTIONS:
                motion_manifest = manifest["motions"][motion]
                for direction in DIRECTIONS:
                    hashes = []
                    for index in range(8):
                        path = folder / f"{motion}_{direction}_{index}.png"
                        with Image.open(path) as image:
                            self.assertEqual(image.mode, "RGBA")
                            self.assertEqual(image.height, 240)
                            anchor = motion_manifest["frames"][f"{direction}_{index}"]
                            self.assertEqual([image.width, image.height], [anchor["width"], anchor["height"]])
                            self.assertAlmostEqual(anchor["phase"], index / 8)
                            self.assertEqual(anchor["contactFoot"], "left" if index == 0 else "right" if index == 4 else None)
                            self.assertGreaterEqual(anchor["bodyX"], 0); self.assertLess(anchor["bodyX"], image.width)
                            self.assertGreaterEqual(anchor["footY"], 0); self.assertLess(anchor["footY"], image.height)
                            hashes.append(hashlib.sha256(image.tobytes()).hexdigest())
                    self.assertEqual(len(set(hashes)), 8, f"duplicate pilot pose: {slug}/{motion}/{direction}")

    def test_walk_head_and_torso_root_jitter_stays_below_one_gameplay_pixel(self):
        for slug in PILOT:
            folder = PILOT_ROOT / slug
            manifest = json.loads((folder / "manifest.json").read_text())
            frames = manifest["motions"]["walk"]["frames"]
            for direction in DIRECTIONS:
                head_offsets, torso_offsets = [], []
                for index in range(8):
                    alpha = np.asarray(Image.open(folder / f"walk_{direction}_{index}.png"))[:, :, 3]
                    ys, _ = np.where(alpha >= 128); y0, y1 = int(ys.min()), int(ys.max())
                    visible_h = y1 - y0 + 1
                    def weighted_x(start, end):
                        band = alpha[int(y0 + start * visible_h):int(y0 + end * visible_h) + 1].astype(float) / 255
                        return float((band * np.arange(alpha.shape[1])[None, :]).sum() / band.sum())
                    body_x = frames[f"{direction}_{index}"]["bodyX"]
                    head_offsets.append((weighted_x(0, .27) - body_x) * 56 / 240)
                    torso_offsets.append((weighted_x(.27, .58) - body_x) * 56 / 240)
                self.assertLessEqual(max(head_offsets) - min(head_offsets), .75, f"{slug}/{direction}/head")
                self.assertLessEqual(max(torso_offsets) - min(torso_offsets), .75, f"{slug}/{direction}/torso")

    def test_side_walk_declares_opposite_contacts_at_two_full_stride_extremes(self):
        for slug in PILOT:
            folder = PILOT_ROOT / slug
            lower_spans = []
            for index in range(8):
                alpha = np.asarray(Image.open(folder / f"walk_right_{index}.png"))[:, :, 3]
                ys, _ = np.where(alpha >= 128)
                lower_start = int(ys.min() + .76 * (ys.max() - ys.min() + 1))
                xs = np.where(alpha[lower_start:] >= 128)[1]
                lower_spans.append(int(xs.max() - xs.min() + 1))
            # The shared phase contract emits contacts at 0/.5, so frames 0/4 must both be
            # full-stride contact silhouettes—not passing poses mislabeled by an image model.
            self.assertGreaterEqual(lower_spans[0], max(lower_spans) * .8, slug)
            self.assertGreaterEqual(lower_spans[4], max(lower_spans) * .8, slug)

    def test_side_run_has_authored_flight_and_is_not_a_faster_walk(self):
        for slug in PILOT:
            folder = PILOT_ROOT / slug
            manifest = json.loads((folder / "manifest.json").read_text())
            run = manifest["motions"]["run"]
            ground = run["groundY"]["right"]
            # Canonical flight frames retain transparent space below both airborne feet.
            self.assertGreaterEqual(ground - run["frames"]["right_3"]["footY"], 4)
            self.assertGreaterEqual(ground - run["frames"]["right_7"]["footY"], 4)
            differences = []
            for index in range(8):
                walk = np.asarray(Image.open(folder / f"walk_right_{index}.png"), dtype=np.int16)
                run_image = Image.open(folder / f"run_right_{index}.png")
                # Compare normalized alpha silhouettes at gameplay-source scale.
                walk_alpha = Image.fromarray(walk[:, :, 3].astype(np.uint8)).resize((64, 128))
                run_alpha = run_image.getchannel("A").resize((64, 128))
                differences.append(np.abs(np.asarray(walk_alpha, dtype=np.int16) - np.asarray(run_alpha, dtype=np.int16)).mean())
            self.assertGreater(min(differences), 8, f"run reused walk pose: {slug}")

    def test_run_canvas_ground_never_allows_a_foot_below_the_floor(self):
        for slug in PILOT:
            manifest = json.loads((PILOT_ROOT / slug / "manifest.json").read_text())
            run = manifest["motions"]["run"]
            for direction in DIRECTIONS:
                ground = run["groundY"][direction]
                self.assertEqual(ground, max(run["frames"][f"{direction}_{i}"]["footY"] for i in range(8)))


if __name__ == "__main__":
    unittest.main()
