#!/usr/bin/env python3
"""Failure-path tests for the ticket #044 atomic art pipeline."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


MODULE_PATH = Path(__file__).resolve().parents[1] / "datamon" / "tools" / "art_pipeline.py"
SPEC = importlib.util.spec_from_file_location("datamon_art_pipeline", MODULE_PATH)
art = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = art
assert SPEC.loader is not None
SPEC.loader.exec_module(art)


class ArtPipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "datamon"
        (self.root / "environment").mkdir(parents=True)
        (self.root / "environment" / "manifest.json").write_text("[]\n")
        self.paths = art.paths_for(self.root)
        self.source = Path(self.temp.name) / "source"
        self.source.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    @staticmethod
    def entry(**overrides):
        value = {
            "id": "hd-test-tile", "kind": "tile", "slug": "test-tile",
            "file": "test.png", "widthPx": 2, "heightPx": 2,
            "sourceScale": 2, "sourceWidthPx": 4, "sourceHeightPx": 4,
            "alphaMode": "opaque", "scene": "office", "fallback": "legacy:test-tile",
            "provenance": "deterministic-test-recipe", "reviewState": "pending",
            "batchId": "batch-test", "maxColors": 16,
        }
        value.update(overrides)
        return value

    @staticmethod
    def detailed_image(alpha_mode="opaque"):
        if alpha_mode == "opaque":
            image = Image.new("RGBA", (4, 4), (30, 40, 50, 255))
            image.putpixel((0, 0), (31, 40, 50, 255))
        elif alpha_mode == "binary":
            image = Image.new("RGBA", (4, 4), (30, 40, 50, 255))
            image.putpixel((0, 0), (0, 0, 0, 0))
        else:
            image = Image.new("RGBA", (4, 4), (30, 40, 50, 255))
            image.putpixel((0, 0), (30, 40, 50, 96))
        return image

    def save(self, image=None, name="test.png"):
        (image or self.detailed_image()).save(self.source / name, "PNG", optimize=False)

    def stage_valid(self):
        self.save()
        entries = [self.entry()]
        target = art.stage_batch("batch-test", self.source, entries, self.paths)
        return target, entries

    def review_valid(self):
        target, _ = self.stage_valid()
        entries = json.loads((target / "manifest.json").read_text())
        sheet, digest = art.generate_contact_sheet(target, entries, self.paths.review)
        self.assertTrue(sheet.is_file())
        art.mark_reviewed("batch-test", digest, True, self.paths)
        return target, json.loads((target / "manifest.json").read_text()), digest

    def test_rejects_declared_and_decoded_dimension_mismatches(self):
        self.save()
        wrong_schema = self.entry(sourceWidthPx=2)
        errors = art.validate_batch(self.source, [wrong_schema])
        self.assertTrue(any("sourceWidthPx must equal" in error for error in errors))

        wrong_file = self.entry()
        Image.new("RGBA", (4, 2), (1, 2, 3, 255)).save(self.source / "test.png")
        errors = art.validate_batch(self.source, [wrong_file])
        self.assertTrue(any("dimension mismatch" in error for error in errors))

    def test_rejects_alpha_mode_mismatch(self):
        self.detailed_image("binary").save(self.source / "test.png")
        errors = art.validate_batch(self.source, [self.entry(alphaMode="opaque")])
        self.assertTrue(any("declared opaque" in error for error in errors))

        soft_pixel = self.detailed_image("soft")
        soft_pixel.save(self.source / "test.png")
        errors = art.validate_batch(self.source, [self.entry(alphaMode="binary")])
        self.assertTrue(any("soft alpha" in error for error in errors))

    def test_rejects_duplicates_and_missing_or_undeclared_members(self):
        self.save()
        second = self.entry(file="second.png")
        errors = art.validate_batch(self.source, [self.entry(), second])
        self.assertTrue(any("duplicate id" in error for error in errors))
        self.assertTrue(any("missing declared PNG" in error for error in errors))

        Image.new("RGBA", (4, 4), (1, 2, 3, 255)).save(self.source / "extra.png")
        errors = art.validate_batch(self.source, [self.entry()])
        self.assertTrue(any("undeclared PNG" in error for error in errors))

    def test_rejects_path_traversal(self):
        self.save()
        errors = art.validate_batch(self.source, [self.entry(file="../test.png")])
        self.assertTrue(any("safe relative PNG" in error for error in errors))

    def test_rejects_trivial_nearest_upscale(self):
        # Every 2×2 source block is uniform: this is exactly what nearest upscaling creates.
        image = Image.new("RGBA", (4, 4), (20, 30, 40, 255))
        image.save(self.source / "test.png")
        errors = art.validate_batch(self.source, [self.entry()])
        self.assertTrue(any("trivial nearest-neighbour" in error for error in errors))

    def test_rejects_pending_acceptance_and_direct_accepted_sources(self):
        target, entries = self.stage_valid()
        with self.assertRaisesRegex(ValueError, "reviewed together"):
            art.accept_batch("batch-test", entries, self.paths)

        accepted_source = self.paths.accepted / "source-batch"
        accepted_source.mkdir(parents=True)
        self.detailed_image().save(accepted_source / "test.png")
        with self.assertRaisesRegex(ValueError, "must not be inside"):
            art.stage_batch("batch-other", accepted_source, entries, self.paths)
        self.assertTrue(target.exists())

    def test_contact_sheet_sha_is_deterministic(self):
        target, entries = self.stage_valid()
        first_path, first = art.generate_contact_sheet(target, entries, self.paths.review)
        first_bytes = first_path.read_bytes()
        second_path, second = art.generate_contact_sheet(target, entries, self.paths.review)
        self.assertEqual(first, second)
        self.assertEqual(first_bytes, second_path.read_bytes())

    def test_review_sha_must_match_current_sheet(self):
        target, entries = self.stage_valid()
        _, digest = art.generate_contact_sheet(target, entries, self.paths.review)
        with self.assertRaisesRegex(ValueError, "does not match"):
            art.mark_reviewed("batch-test", "0" * 64, True, self.paths)
        self.assertFalse((self.paths.review / "review-batch-test.json").exists())
        self.assertNotEqual(digest, "0" * 64)

    def test_injected_failure_restores_manifest_and_removes_partial_batch(self):
        target, reviewed, _ = self.review_valid()
        old_manifest = self.paths.manifest.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "Injected failure"):
            art.accept_batch("batch-test", reviewed, self.paths, inject_failure="after-assets")
        self.assertEqual(self.paths.manifest.read_bytes(), old_manifest)
        self.assertFalse((self.paths.accepted / "batch-test").exists())
        self.assertTrue(target.exists())

    def test_success_is_manifest_last_and_history_is_content_addressed_immutable(self):
        old = self.paths.accepted / "old-batch"
        old.mkdir(parents=True)
        (old / "old.png").write_bytes(b"old-bytes")
        old_manifest = [{"id": "old", "batchId": "old-batch", "reviewState": "accepted"}]
        old_bytes = art.canonical_json(old_manifest)
        self.paths.manifest.write_bytes(old_bytes)

        _, reviewed, _ = self.review_valid()
        expected_snapshot = art._snapshot_history(self.paths, old_bytes)
        snapshot_before = expected_snapshot.joinpath("manifest.json").read_bytes()
        accepted = art.accept_batch("batch-test", reviewed, self.paths)
        self.assertTrue((accepted / "test.png").is_file())
        active = json.loads(self.paths.manifest.read_text())
        self.assertEqual([entry["batchId"] for entry in active], ["old-batch", "batch-test"])
        self.assertEqual(active[-1]["reviewState"], "accepted")

        snapshots = [path for path in self.paths.history.iterdir() if path.is_dir()]
        self.assertEqual(len(snapshots), 1)
        self.assertEqual((snapshots[0] / "manifest.json").read_bytes(), old_bytes)
        self.assertEqual((snapshots[0] / "accepted" / "old-batch" / "old.png").read_bytes(), b"old-bytes")
        # The prior snapshot is reused and remains byte-for-byte unchanged.
        self.assertEqual(snapshots[0], expected_snapshot)
        self.assertEqual((snapshots[0] / "manifest.json").read_bytes(), snapshot_before)


if __name__ == "__main__":
    unittest.main()
