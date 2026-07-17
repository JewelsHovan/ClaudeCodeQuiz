#!/usr/bin/env python3
"""Determinism and fail-closed tests for Certification Spine wayfinding art."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "datamon" / "tools" / "gen_wayfinding_assets.py"
SPEC = importlib.util.spec_from_file_location("datamon_wayfinding_assets", MODULE_PATH)
wayfinding = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = wayfinding
assert SPEC.loader is not None
SPEC.loader.exec_module(wayfinding)


class WayfindingAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.out = root / "props-wayfinding"
        self.review = root / "review"
        self.original = wayfinding.OUT_DIR, wayfinding.REVIEW_DIR
        wayfinding.OUT_DIR, wayfinding.REVIEW_DIR = self.out, self.review

    def tearDown(self):
        wayfinding.OUT_DIR, wayfinding.REVIEW_DIR = self.original
        self.temp.cleanup()

    def test_batch_is_byte_deterministic_and_fully_validated(self):
        first = wayfinding.build_all()
        first_manifest = json.loads((self.out / "manifest.json").read_text())
        errors, total = wayfinding.validate()
        second = wayfinding.build_all()

        self.assertEqual(errors, [])
        self.assertEqual(first, second)
        self.assertEqual(total, sum((self.out / entry["file"]).stat().st_size for entry in first_manifest["entries"]))
        self.assertEqual(first_manifest["asset_count"], 9)
        self.assertEqual([entry["id"] for entry in first_manifest["entries"]], wayfinding.CANONICAL_IDS)
        self.assertEqual(first_manifest["batch_sha256"], json.loads((self.out / "manifest.json").read_text())["batch_sha256"])
        self.assertTrue((self.review / "contact-sheet-batch-wayfinding.png").exists())

    def test_validator_rejects_nested_extra_boolean_schema_and_hash_mutation(self):
        wayfinding.build_all()
        nested = self.out / "unexpected" / "nested" / "extra.png"
        nested.parent.mkdir(parents=True)
        Image.new("RGBA", (2, 2), (255, 0, 255, 255)).save(nested)
        errors, _ = wayfinding.validate()
        self.assertTrue(any("unexpected output" in error for error in errors), errors)

        wayfinding.build_all()
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["sourceScale"] = True
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors, _ = wayfinding.validate()
        self.assertTrue(any("source scale" in error for error in errors), errors)

        wayfinding.build_all()
        manifest = json.loads(manifest_path.read_text())
        target = self.out / manifest["entries"][0]["file"]
        target.write_bytes(target.read_bytes() + b"mutation")
        errors, _ = wayfinding.validate()
        self.assertTrue(any("hash mismatch" in error for error in errors), errors)

    def test_invalid_candidate_never_replaces_accepted_batch(self):
        accepted = wayfinding.build_all()
        original = wayfinding.FRIEZE_GENERATORS["agent"]
        try:
            wayfinding.FRIEZE_GENERATORS["agent"] = lambda: Image.new("RGBA", (4, 4), (255, 0, 255, 255))
            with self.assertRaises(RuntimeError):
                wayfinding.build_all()
        finally:
            wayfinding.FRIEZE_GENERATORS["agent"] = original
        self.assertEqual(wayfinding.snapshot(), accepted)
        self.assertFalse((self.out.parent / ".props-wayfinding.staging").exists())
        self.assertFalse((self.out.parent / ".props-wayfinding.backup").exists())

    def test_every_surround_keeps_the_declared_threshold_transparent(self):
        wayfinding.build_all()
        manifest = json.loads((self.out / "manifest.json").read_text())
        for entry in manifest["entries"]:
            if entry["kind"] != "surround":
                continue
            with Image.open(self.out / entry["file"]) as image:
                rgba = image.convert("RGBA")
            x0, y0, x1, y1 = entry["opening"]
            opening = rgba.crop((x0 * 2, y0 * 2, x1 * 2, y1 * 2))
            self.assertIsNone(opening.getchannel("A").getbbox(), entry["id"])
            self.assertEqual(hashlib.sha256((self.out / entry["file"]).read_bytes()).hexdigest(), entry["sha256"])


if __name__ == "__main__":
    unittest.main()
