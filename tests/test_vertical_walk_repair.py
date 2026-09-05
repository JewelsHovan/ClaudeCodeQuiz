"""Source-art regressions for the reviewed #060 vertical walk corrections."""
import hashlib
import json
import sys
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DOWN = ('duc-an-nguyen', 'emile-moffatt', 'guillaume-pregent', 'jonathan-kim',
        'logan-labossiere', 'tyler-nagano', 'victor-desautels')
UP = ('duc-an-nguyen', 'emile-moffatt', 'ethan-pirso', 'guillaume-delmas-frenette',
      'jerry-zhu', 'jonah-lee', 'jonathan-kim', 'logan-labossiere', 'pentcho-tchomakov',
      'saransh-padhy', 'scott-carr', 'stephanie-fontaine', 'tyler-nagano', 'victor-desautels')
VIEWS = [(slug, direction) for direction, slugs in [('down', DOWN), ('up', UP)] for slug in slugs]
sys.path.insert(0, str(ROOT / 'datamon/tools'))
import gen_vertical_walk_repair as repair


class VerticalWalkRepairTests(unittest.TestCase):
    def test_repaired_views_have_compact_alternating_leg_phases(self):
        for slug, direction in VIEWS:
            with self.subTest(slug=slug, direction=direction):
                frames = [Image.open(ROOT / 'datamon/sprites-walk' / slug / f'{direction}_{i}.png').convert('RGBA')
                          for i in range(4)]
                # Opposing legs must not flip asymmetric hair, faces, buttons or sleeves.
                for i in (0, 1):
                    original, opposite = np.asarray(frames[i]), np.asarray(frames[i + 2])
                    split, _ = repair.leg_geometry(frames[i])
                    self.assertTrue(np.array_equal(original[:split], opposite[:split]))
                    self.assertTrue(np.array_equal(np.asarray(repair.opposite_leg_phase(frames[i])), opposite))
                    self.assertFalse(np.array_equal(original[split:], opposite[split:]))
                visible_heights = []
                for i, frame in enumerate(frames):
                    alpha = np.asarray(frame)[:, :, 3]
                    ys, _ = np.where(alpha >= 128)
                    y0, y1 = int(ys.min()), int(ys.max())
                    height = y1 - y0 + 1
                    visible_heights.append(height)
                    _, lower_xs = np.where(alpha[y0 + round(height * .68):y1 + 1] >= 128)
                    self.assertLessEqual(int(np.ptp(lower_xs)) + 1, round(height * .30), f'{slug}/{direction}_{i}')
                self.assertLessEqual(max(visible_heights) - min(visible_heights), 4)  # <= 1 logical pixel
                # A mirrored neutral stance alone is not a gait: the lead foot must differ.
                alpha = np.asarray(frames[0])[:, :, 3]
                ys, _ = np.where(alpha >= 128)
                _, axis2 = repair.leg_geometry(frames[0])
                split = round(axis2 / 2)
                left_y, _ = np.where(alpha[:, :split - 2] >= 128)
                right_y, _ = np.where(alpha[:, split + 2:] >= 128)
                self.assertGreaterEqual(abs(int(left_y.max()) - int(right_y.max())), 2)

    def test_recipe_is_bounded_and_unaffected_art_is_byte_identical(self):
        recipe = json.loads(repair.RECIPE.read_text())
        self.assertEqual({(v['slug'], v['direction']) for v in recipe['views']}, set(VIEWS))
        self.assertEqual(len(recipe['views']), 21)
        self.assertEqual(recipe['generation'], {'hardCallCap': 24, 'recordedCalls': 21, 'succeeded': 21, 'interrupted': 0})
        changed = {f'datamon/sprites-walk/{slug}/{direction}_{i}.png' for slug, direction in VIEWS for i in range(4)}
        changed |= {f'datamon/sprites-walk/{slug}/manifest.json' for slug, _ in VIEWS}
        changed.update(('datamon/sprites-walk/manifest.json', 'datamon/sprites-sit/manifest.json'))
        preserved = {}
        for view in recipe['views']:
            if view['direction'] == 'up':
                source = ROOT / 'datamon/sprites-sit-sources' / view['slug'] / 'up_0.png'
                self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), view['sittingSourceSha256'])
        for folder in ('sprites-walk', 'sprites-idle', 'sprites-locomotion-pilot', 'sprites-sit'):
            for path in (ROOT / 'datamon' / folder).rglob('*'):
                if path.is_file() and path.relative_to(ROOT).as_posix() not in changed:
                    preserved[path.relative_to(ROOT).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
        digest = hashlib.sha256()
        for path, value in sorted(preserved.items()):
            digest.update(f'{path}\0{value}\n'.encode())
        self.assertEqual(len(preserved), recipe['preservedFileCount'])
        self.assertEqual(digest.hexdigest(), recipe['preservedFilesSha256'])

    def test_opposite_phase_preserves_upper_body_and_rejects_empty_art(self):
        source = np.zeros((100, 50, 4), dtype=np.uint8)
        source[5:45, 15:35] = (20, 40, 90, 255)
        source[10:15, 17:20] = (250, 180, 20, 255)  # asymmetric identity detail
        source[45:95, 17:23] = (50, 70, 90, 255)
        source[45:85, 27:33] = (90, 70, 50, 255)
        frame = Image.fromarray(source)
        result = np.asarray(repair.opposite_leg_phase(frame))
        split, axis2 = repair.leg_geometry(frame)
        self.assertEqual(axis2, 49)
        self.assertTrue(np.array_equal(result[:split], source[:split]))
        self.assertTrue(np.array_equal(result[split + repair.BLEND_ROWS:], source[split + repair.BLEND_ROWS:, ::-1]))
        with self.assertRaisesRegex(ValueError, 'empty'):
            repair.opposite_leg_phase(Image.new('RGBA', (50, 100)))


if __name__ == '__main__':
    unittest.main()
