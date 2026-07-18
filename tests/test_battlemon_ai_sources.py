#!/usr/bin/env python3
"""Review-gate, provenance, spend-cap, and deterministic post-processing tests."""
from __future__ import annotations

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "datamon" / "tools" / "gen_battlemon_ai_sources.py"
SPEC = importlib.util.spec_from_file_location("datamon_battlemon_ai_sources", MODULE_PATH)
ai_sources = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ai_sources
assert SPEC.loader is not None
SPEC.loader.exec_module(ai_sources)


class BattlemonAISourcesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        self.raw, self.sources, self.review = root / "raw", root / "sources", root / "review"
        self.original_paths = ai_sources.RAW_DIR, ai_sources.SOURCE_DIR, ai_sources.REVIEW_DIR
        ai_sources.RAW_DIR, ai_sources.SOURCE_DIR, ai_sources.REVIEW_DIR = self.raw, self.sources, self.review

    def tearDown(self):
        ai_sources.RAW_DIR, ai_sources.SOURCE_DIR, ai_sources.REVIEW_DIR = self.original_paths
        self.temp.cleanup()

    def _make_raw_batch(self):
        self.raw.mkdir(parents=True)
        ledger = {"model": ai_sources.MODEL, "entries": {}}
        for index, (domain, name, identifier) in enumerate(ai_sources.canonical_pairs()):
            image = Image.new("RGB", (256, 256), (255, 0, 255))
            draw = ImageDraw.Draw(image)
            width = 72 + index % 29
            height = 84 + (index * 3) % 35
            color = (20 + index * 5 % 180, 70 + index * 7 % 150, 35 + index * 11 % 190)
            draw.rectangle((128 - width // 2, 238 - height, 128 + width // 2, 238), fill=color)
            draw.polygon([(128, 20 + index % 14), (106, 90), (150, 90)], fill=(18, 30, 55))
            draw.rectangle((3, 3, 6, 6), fill=color)  # disconnected artifact must be removed
            path = self.raw / (identifier + ".png"); image.save(path)
            prompt = ai_sources.prompt_for(domain, name, identifier, identifier != "mcp-schema-mismatch")
            expected_reference = None if identifier == "mcp-schema-mismatch" else (
                "mcp-schema-mismatch" if identifier == ai_sources.PILOTS[domain] else ai_sources.PILOTS[domain]
            )
            ledger["entries"][identifier] = {
                "id": identifier, "domain": domain, "name": name, "model": ai_sources.MODEL,
                "reference": expected_reference,
                "promptSha256": hashlib.sha256(prompt.encode()).hexdigest(),
                "rawSha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            }
        (self.raw / "generation-ledger.json").write_text(json.dumps(ledger, indent=2) + "\n")

    def test_tracked_product_sources_are_accepted_and_bound_to_the_current_contact_sheet(self):
        ai_sources.SOURCE_DIR = REPO_ROOT / "datamon" / "battlemons-source"
        ai_sources.REVIEW_DIR = REPO_ROOT / "datamon" / ".environment-work" / "review"
        self.assertEqual(ai_sources.validate_sources(), [])
        manifest = json.loads((ai_sources.SOURCE_DIR / "manifest.json").read_text())
        self.assertEqual(manifest["provider"], "openrouter")
        self.assertEqual(manifest["model"], "google/gemini-3-pro-image")
        self.assertEqual(len(manifest["entries"]), 35)
        actual = hashlib.sha256(ai_sources._png_bytes(ai_sources.render_contact_sheet()[0])).hexdigest()
        self.assertEqual(actual, manifest["review"]["contactSheetSha256"])

    def test_offline_pipeline_is_deterministic_atomic_and_requires_exact_review_hash(self):
        self._make_raw_batch()
        first = ai_sources.build_sources()
        first_bytes = {path.relative_to(self.sources).as_posix(): path.read_bytes()
                       for path in sorted(self.sources.iterdir())}
        second = ai_sources.build_sources()
        second_bytes = {path.relative_to(self.sources).as_posix(): path.read_bytes()
                        for path in sorted(self.sources.iterdir())}
        self.assertEqual(first, second)
        self.assertEqual(first_bytes, second_bytes)
        self.assertEqual(ai_sources.validate_sources(require_accepted=False), [])
        self.assertIn("source batch is not accepted", ai_sources.validate_sources())

        contact = ai_sources.write_contact_sheet()
        digest = hashlib.sha256(contact.read_bytes()).hexdigest()
        with self.assertRaises(RuntimeError):
            ai_sources.accept_sources("0" * 64)
        ai_sources.accept_sources(digest)
        self.assertEqual(ai_sources.validate_sources(), [])
        self.assertFalse((self.sources.parent / ".sources.staging").exists())
        self.assertFalse((self.sources.parent / ".sources.backup").exists())

        manifest_path = self.sources / "manifest.json"; manifest = json.loads(manifest_path.read_text())
        manifest["entries"][0]["promptSha256"] = "0" * 64
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors = ai_sources.validate_sources()
        self.assertTrue(any("prompt provenance mismatch" in error for error in errors), errors)

        target = self.sources / "agent-rogue-subagent.png"
        target.write_bytes(target.read_bytes() + b"drift")
        errors = ai_sources.validate_sources()
        self.assertTrue(any("source hash mismatch" in error for error in errors), errors)

        with Image.open(target) as opened:
            changed = opened.convert("RGBA")
        changed.putpixel((64, 64), (255, 255, 255, 255)); target.write_bytes(ai_sources._png_bytes(changed))
        manifest_path = self.sources / "manifest.json"; manifest = json.loads(manifest_path.read_text())
        manifest["entries"][0]["sourceSha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
        errors = ai_sources.validate_sources()
        self.assertTrue(any("review hash" in error for error in errors), errors)

    def test_postprocessor_keys_background_removes_artifacts_and_bounds_palette(self):
        self.raw.mkdir(parents=True)
        raw = self.raw / "probe.png"
        image = Image.new("RGB", (256, 256), (250, 0, 245)); draw = ImageDraw.Draw(image)
        draw.ellipse((70, 45, 190, 230), fill=(25, 125, 210))
        draw.rectangle((2, 2, 8, 8), fill=(25, 125, 210))
        image.save(raw)
        processed = ai_sources.process_raw(raw)
        self.assertEqual(processed.mode, "RGBA")
        self.assertEqual(processed.size, (128, 128))
        self.assertEqual(set(processed.getchannel("A").tobytes()), {0, 255})
        self.assertIsNotNone(processed.getchannel("A").getbbox())
        self.assertIsNotNone(processed.getcolors(maxcolors=33))
        self.assertEqual(processed.getpixel((0, 0))[3], 0)

    def test_generation_reserves_budget_before_any_billable_request(self):
        self.raw.mkdir(parents=True)
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}), \
             mock.patch.object(ai_sources, "_request_image") as request:
            with self.assertRaisesRegex(RuntimeError, "Refusing generation"):
                ai_sources.generate_raw({"mcp-schema-mismatch"}, False, 0.01, 1)
            request.assert_not_called()

    def test_generation_stops_fail_closed_when_provider_omits_measured_cost(self):
        self.raw.mkdir(parents=True)
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}), \
             mock.patch.object(ai_sources, "_request_image", return_value=(b"image", {"usage": {}, "seconds": 1})):
            with self.assertRaisesRegex(RuntimeError, "usage.cost"):
                ai_sources.generate_raw({"mcp-schema-mismatch"}, False, 0.20, 1)
        self.assertFalse((self.raw / "mcp-schema-mismatch.png").exists())

    def test_clean_generation_bootstraps_anchor_then_domain_pilots_then_species(self):
        calls = []
        def fake_request(prompt, reference):
            if reference is not None:
                self.assertTrue(reference.exists(), reference)
            calls.append(reference.stem if reference else None)
            return (hashlib.sha256(prompt.encode()).digest(), {"usage": {"cost": 0.1}, "seconds": 1})
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}), \
             mock.patch.object(ai_sources, "_request_image", side_effect=fake_request), \
             contextlib.redirect_stdout(io.StringIO()):
            result = ai_sources.generate_raw(None, False, 6.0, 4)
        self.assertEqual(result["generated"], 35)
        self.assertAlmostEqual(result["sessionCost"], 3.5)
        self.assertEqual(calls[0], None)
        self.assertEqual(calls[1:5], ["mcp-schema-mismatch"] * 4)
        ledger = json.loads((self.raw / "generation-ledger.json").read_text())
        self.assertEqual(len(ledger["entries"]), 35)
        self.assertEqual(ledger["entries"]["agent-infinite-loop"]["reference"], "agent-rogue-subagent")


if __name__ == "__main__":
    unittest.main()
