import importlib.util
import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
GEN_PATH = ROOT / "datamon" / "tools" / "gen_walk_assets.py"
spec = importlib.util.spec_from_file_location("gen_walk_assets", GEN_PATH)
walk = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = walk
spec.loader.exec_module(walk)


class WalkAssetContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sprite_root = ROOT / "datamon" / "sprites-walk"
        cls.roster = sorted(path.stem for path in (ROOT / "datamon" / "sprites").glob("*.png"))

    def test_complete_roster_has_exact_frames_and_canonical_manifests(self):
        self.assertEqual(len(self.roster), 37)
        self.assertEqual(sorted(path.name for path in self.sprite_root.iterdir() if path.is_dir()), self.roster)
        for slug in self.roster:
            folder = self.sprite_root / slug
            expected_pngs = {f"{direction}_{index}.png" for direction in walk.VIEWS if direction != "side" for index in range(4)}
            expected_pngs |= {f"{direction}_{index}.png" for direction in ("left", "right") for index in range(4)}
            self.assertEqual({path.name for path in folder.glob("*.png")}, expected_pngs, slug)
            manifest_path = folder / "manifest.json"
            payload = json.dumps(walk.anchor_manifest(slug), sort_keys=True, separators=(",", ":")) + "\n"
            self.assertEqual(manifest_path.read_text(encoding="utf-8"), payload, slug)

    def test_anchor_metadata_pins_visible_feet_and_bounds_body_jitter(self):
        worst = 0.0
        for slug in self.roster:
            manifest = json.loads((self.sprite_root / slug / "manifest.json").read_text())
            self.assertEqual(manifest["schemaVersion"], 1)
            self.assertEqual(manifest["cycleDistanceTiles"], 2)
            self.assertEqual(manifest["anchorMethod"], walk.ANCHOR_METHOD)
            for direction in ("down", "up", "left", "right"):
                relative_heads, relative_torsos = [], []
                for index in range(4):
                    frame = Image.open(self.sprite_root / slug / f"{direction}_{index}.png").convert("RGBA")
                    alpha = np.asarray(frame)[:, :, 3]
                    ys, _xs = np.where(alpha >= walk.ANCHOR_ALPHA_THRESHOLD)
                    self.assertGreater(len(ys), 0, f"{slug}/{direction}_{index}")
                    meta = manifest["frames"][f"{direction}_{index}"]
                    self.assertEqual(meta["width"], frame.width)
                    self.assertEqual(meta["height"], frame.height)
                    self.assertEqual(meta["footY"], int(ys.max()))
                    self.assertEqual(meta["phase"], index / 4)
                    self.assertEqual(meta["contactFoot"], "left" if index == 0 else "right" if index == 2 else None)

                    y0, y1 = int(ys.min()), int(ys.max())
                    visible_h = y1 - y0 + 1
                    def center(start, end):
                        sy, ey = int(y0 + start * visible_h), int(y0 + end * visible_h) + 1
                        weights = alpha[sy:ey].astype(np.float64) / 255.0
                        xs = np.arange(frame.width, dtype=np.float64)[None, :]
                        return float((weights * xs).sum() / weights.sum())
                    body_x = meta["bodyX"]
                    relative_heads.append(center(0, walk.ANCHOR_HEAD_END) - body_x)
                    relative_torsos.append(center(walk.ANCHOR_HEAD_END, walk.ANCHOR_TORSO_END) - body_x)
                scale = 56 / 240
                head_range = (max(relative_heads) - min(relative_heads)) * scale
                torso_range = (max(relative_torsos) - min(relative_torsos)) * scale
                worst = max(worst, head_range, torso_range)
        self.assertLessEqual(worst, 0.75)

    def test_left_frames_are_exact_baked_mirrors_of_right(self):
        for slug in self.roster:
            for index in range(4):
                right = Image.open(self.sprite_root / slug / f"right_{index}.png").convert("RGBA")
                left = Image.open(self.sprite_root / slug / f"left_{index}.png").convert("RGBA")
                self.assertTrue(np.array_equal(np.asarray(ImageOps.mirror(right)), np.asarray(left)), f"{slug}/{index}")


if __name__ == "__main__":
    unittest.main()
