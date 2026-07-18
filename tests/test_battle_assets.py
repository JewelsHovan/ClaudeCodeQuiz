#!/usr/bin/env python3
"""Determinism, silhouette, and fail-closed tests for classic Battlemon art."""
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
MODULE_PATH = REPO_ROOT / "datamon" / "tools" / "gen_battle_assets.py"
SPEC = importlib.util.spec_from_file_location("datamon_battle_assets", MODULE_PATH)
battle_assets = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = battle_assets
assert SPEC.loader is not None
SPEC.loader.exec_module(battle_assets)


class BattleAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.out = root / "battlemons"
        self.review = root / "review"
        self.original_paths = battle_assets.OUT_DIR, battle_assets.REVIEW_DIR
        battle_assets.OUT_DIR, battle_assets.REVIEW_DIR = self.out, self.review

    def tearDown(self):
        battle_assets.OUT_DIR, battle_assets.REVIEW_DIR = self.original_paths
        self.temp.cleanup()

    def build(self):
        return battle_assets.build_all()

    def rewrite_manifest_hashes(self):
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        digest = hashlib.sha256()
        for entry in manifest["entries"]:
            data = (self.out / entry["file"]).read_bytes()
            entry["sha256"] = hashlib.sha256(data).hexdigest()
            digest.update(data)
        manifest["batchSha256"] = digest.hexdigest()
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")

    def test_batch_is_byte_deterministic_complete_and_reviewable(self):
        first = self.build()
        errors, total = battle_assets.validate()
        first_manifest = json.loads((self.out / "manifest.json").read_text())
        second = self.build()

        self.assertEqual(errors, [])
        self.assertEqual(first, second)
        self.assertEqual(total, sum((self.out / entry["file"]).stat().st_size
                                    for entry in first_manifest["entries"]))
        self.assertEqual([entry["id"] for entry in first_manifest["entries"]],
                         battle_assets.canonical_ids())
        self.assertEqual([entry["variant"] for entry in first_manifest["entries"]],
                         list(range(7)) * 5)
        self.assertTrue((self.review / "t53-battlemon-codex-color.png").exists())
        self.assertTrue((self.review / "t53-battlemon-codex-grayscale.png").exists())
        self.assertTrue((self.review / "t53-battlemon-states.png").exists())

    def test_every_sheet_has_exact_rgba_geometry_hashes_and_six_unique_states(self):
        self.build()
        manifest = json.loads((self.out / "manifest.json").read_text())
        self.assertEqual(set(manifest), battle_assets.ROOT_KEYS)
        self.assertEqual(manifest["states"], list(battle_assets.STATES))
        aggregate = hashlib.sha256()
        for entry in manifest["entries"]:
            self.assertEqual(set(entry), battle_assets.ENTRY_KEYS)
            path = self.out / entry["file"]
            data = path.read_bytes()
            aggregate.update(data)
            self.assertEqual(hashlib.sha256(data).hexdigest(), entry["sha256"])
            with Image.open(path) as opened:
                self.assertEqual(opened.format, "PNG")
                self.assertEqual(opened.mode, "RGBA")
                self.assertEqual(opened.size, (768, 128))
                sheet = opened.convert("RGBA")
            frames = [sheet.crop((index * 128, 0, (index + 1) * 128, 128))
                      for index in range(6)]
            self.assertEqual(len({frame.tobytes() for frame in frames}), 6)
            self.assertTrue(all(frame.getchannel("A").getbbox() for frame in frames))
        self.assertEqual(aggregate.hexdigest(), manifest["batchSha256"])

    def test_all_seven_species_per_domain_have_unique_color_independent_silhouettes(self):
        self.build()
        manifest = json.loads((self.out / "manifest.json").read_text())
        by_domain = {domain: [] for domain in battle_assets.DOMAIN_ORDER}
        representatives = {}
        for entry in manifest["entries"]:
            with Image.open(self.out / entry["file"]) as opened:
                idle = opened.convert("RGBA").crop((0, 0, 128, 128))
            by_domain[entry["domain"]].append(
                hashlib.sha256(idle.getchannel("A").tobytes()).hexdigest()
            )
            representatives.setdefault(entry["domain"], idle)
        for domain, signatures in by_domain.items():
            self.assertEqual(len(signatures), 7, domain)
            self.assertEqual(len(set(signatures)), 7, domain)

        domains = list(battle_assets.DOMAIN_ORDER)
        for left_index, left in enumerate(domains):
            for right in domains[left_index + 1:]:
                a = representatives[left].convert("L").tobytes()
                b = representatives[right].convert("L").tobytes()
                difference = sum(abs(x - y) for x, y in zip(a, b)) / len(a)
                self.assertGreater(difference, 12, f"{left}/{right}: {difference}")

    def test_validator_rejects_nested_extra_boolean_schema_hash_and_taxonomy_drift(self):
        self.build()
        nested = self.out / "unexpected" / "nested" / "extra.png"
        nested.parent.mkdir(parents=True)
        Image.new("RGBA", (2, 2), (255, 0, 255, 255)).save(nested)
        errors, _ = battle_assets.validate()
        self.assertTrue(any("unexpected output" in error for error in errors), errors)

        self.build()
        manifest_path = self.out / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["frameCount"] = True
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors, _ = battle_assets.validate()
        self.assertTrue(any("frameCount" in error for error in errors), errors)

        self.build()
        manifest = json.loads(manifest_path.read_text())
        target = self.out / manifest["entries"][0]["file"]
        target.write_bytes(target.read_bytes() + b"mutation")
        errors, _ = battle_assets.validate()
        self.assertTrue(any("hash mismatch" in error for error in errors), errors)

        self.build()
        manifest = json.loads(manifest_path.read_text())
        manifest["entries"][0]["name"] = "Coordinated Drift"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors, _ = battle_assets.validate()
        self.assertTrue(any("canonical declaration" in error for error in errors), errors)

    def test_invalid_candidate_never_replaces_accepted_batch(self):
        accepted = self.build()
        original = battle_assets.build_into

        def corrupt_candidate(target):
            manifest = original(target)
            first = Path(target) / manifest["entries"][0]["file"]
            first.write_bytes(first.read_bytes() + b"corrupt-after-manifest")
            return manifest

        try:
            battle_assets.build_into = corrupt_candidate
            with self.assertRaises(RuntimeError):
                battle_assets.build_all()
        finally:
            battle_assets.build_into = original
        self.assertEqual(battle_assets.snapshot(), accepted)
        self.assertFalse((self.out.parent / ".battlemons.staging").exists())
        self.assertFalse((self.out.parent / ".battlemons.backup").exists())

    def test_generator_is_offline_and_has_no_identity_input(self):
        source = MODULE_PATH.read_text()
        for forbidden in ("requests", "subprocess", "urllib", "http://", "https://",
                          "headshots", "GEMINI_API_KEY", "OPENAI_API_KEY"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
