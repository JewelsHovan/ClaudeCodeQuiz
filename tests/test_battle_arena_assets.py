#!/usr/bin/env python3
"""Determinism, provenance, review, spend, and atomic-promotion tests for domain arenas."""
from __future__ import annotations
import contextlib, hashlib, importlib.util, io, json, os, sys, tempfile, unittest
from pathlib import Path
from unittest import mock
from PIL import Image, ImageDraw

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "datamon/tools/gen_battle_arena_ai.py"
SPEC = importlib.util.spec_from_file_location("datamon_battle_arena_assets", MODULE_PATH)
arena = importlib.util.module_from_spec(SPEC); sys.modules[SPEC.name] = arena
assert SPEC.loader is not None; SPEC.loader.exec_module(arena)

class BattleArenaAssetsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); root = Path(self.temp.name)
        self.raw, self.out, self.review = root/"raw", root/"battle-arenas", root/"review"
        self.original = arena.RAW_DIR, arena.OUT_DIR, arena.REVIEW_DIR
        arena.RAW_DIR, arena.OUT_DIR, arena.REVIEW_DIR = self.raw, self.out, self.review

    def tearDown(self):
        arena.RAW_DIR, arena.OUT_DIR, arena.REVIEW_DIR = self.original; self.temp.cleanup()

    def make_batch(self, cost=0.1):
        self.raw.mkdir(parents=True); style = Image.new("RGB", (1536,1024), (13,22,37))
        ImageDraw.Draw(style).rectangle((40,40,1490,980), outline=(120,70,180), width=20); style.save(self.raw/"style-reference.png")
        entries = {}
        for index, domain in enumerate(arena.DOMAINS):
            image = Image.new("RGB", (1536,1024), (15+index*18,25+index*9,40+index*11)); draw=ImageDraw.Draw(image)
            draw.rectangle((0,96,1535,925), fill=(20+index*20,35+index*7,55+index*12))
            for x in range(40, 1500, 160):
                draw.rectangle((x,130,x+92,330), fill=(150-index*8,175-index*6,195-index*4), outline=(235,220,180), width=8)
            draw.polygon([(0,925),(470,620),(1000,570),(1535,925)], fill=(40+index*15,55+index*7,75+index*8))
            draw.ellipse((90,620,540,900), fill=(65+index*14,70+index*8,88+index*9), outline=(100+index*12,150,190), width=20)
            draw.ellipse((1060,270,1440,480), fill=(55+index*12,65+index*8,82+index*8), outline=(100,180-index*10,150), width=16)
            draw.ellipse((700,440,1120,710), fill=(35+index*11,45+index*9,70+index*5), outline=(170,80+index*15,190-index*10), width=18)
            if index == 0:
                for x in range(120,1450,210): draw.rectangle((x,180,x+55,760),fill=(225,230,235))
            elif index == 1:
                draw.line([(40,760),(340,180),(650,760),(960,180),(1280,760),(1510,180)],fill=(235,225,180),width=55)
            elif index == 2:
                for inset in range(80,520,90): draw.rectangle((inset,inset//2,1536-inset,1024-inset//2),outline=(225,235,190),width=24)
            elif index == 3:
                for x in range(-300,1500,260): draw.polygon([(x,900),(x+180,180),(x+300,180),(x+120,900)],fill=(235,190,170))
            else:
                for x,y,radius in [(230,300,130),(650,600,180),(1120,300,150),(1400,690,110)]: draw.ellipse((x-radius,y-radius,x+radius,y+radius),outline=(180,230,240),width=42)
            path=self.raw/(domain.lower()+".png"); image.save(path)
        for domain in arena.DOMAINS:
            raw=self.raw/(domain.lower()+".png"); ref=self.raw/("style-reference.png" if domain=="MCP" else "mcp.png")
            entries[domain]={"id":domain.lower(),"domain":domain,"model":arena.MODEL,
                "promptVersion":arena.CURRENT_PROMPT_VERSION,"referenceSha256":hashlib.sha256(ref.read_bytes()).hexdigest(),
                "promptSha256":hashlib.sha256(arena.prompt_for(domain).encode()).hexdigest(),
                "rawSha256":hashlib.sha256(raw.read_bytes()).hexdigest(),"cost":cost,"seconds":1}
        (self.raw/"generation-ledger.json").write_text(json.dumps({"model":arena.MODEL,"entries":entries},indent=2)+"\n")

    def accept_candidate(self):
        arena.build_candidate(); color, _ = arena.write_contact_sheet(arena._candidate_dir())
        arena.accept(hashlib.sha256(color.read_bytes()).hexdigest())

    def test_tracked_product_batch_is_accepted_review_and_cost_bound(self):
        arena.OUT_DIR=REPO_ROOT/"datamon/battle-arenas"; arena.REVIEW_DIR=REPO_ROOT/"datamon/.environment-work/review"
        errors,total=arena.validate(); self.assertEqual(errors,[]); self.assertGreater(total,1_000_000)
        manifest=json.loads((arena.OUT_DIR/"manifest.json").read_text()); color,gray=arena.render_contact_sheet()
        self.assertEqual(hashlib.sha256(arena._png_bytes(color)).hexdigest(),manifest["review"]["contactSheetSha256"])
        self.assertEqual(hashlib.sha256(arena._png_bytes(gray)).hexdigest(),manifest["review"]["grayscaleContactSheetSha256"])
        self.assertAlmostEqual(sum(row["costUsd"] for row in manifest["entries"]),manifest["generationCostUsd"])
        self.assertEqual(manifest["authorizationSpendUsd"],6.811188)

    def test_processing_is_deterministic_exact_and_palette_bounded(self):
        self.raw.mkdir(parents=True); path=self.raw/"probe.png"
        image=Image.new("RGB",(1536,1024),(10,20,30)); draw=ImageDraw.Draw(image)
        for i in range(80): draw.rectangle((i*19,100,(i+1)*19,930),fill=((i*13)%255,(i*29)%255,(i*47)%255))
        image.save(path); first=arena.process_raw(path); second=arena.process_raw(path)
        self.assertEqual(first.tobytes(),second.tobytes()); self.assertEqual(first.mode,"RGB"); self.assertEqual(first.size,(1600,864))
        self.assertIsNotNone(first.getcolors(maxcolors=257))

    def test_pending_build_never_replaces_accepted_and_accept_is_atomic(self):
        self.make_batch(); self.out.mkdir(); (self.out/"accepted-sentinel").write_bytes(b"accepted")
        before=arena.snapshot(); first=arena.build_candidate(); snap1=arena.snapshot(arena._candidate_dir())
        second=arena.build_candidate(); snap2=arena.snapshot(arena._candidate_dir())
        self.assertEqual(first,second); self.assertEqual(snap1,snap2); self.assertEqual(arena.snapshot(),before)
        self.assertEqual(arena.validate(arena._candidate_dir(),require_accepted=False)[0],[])
        self.assertTrue(any("not accepted" in error for error in arena.validate(arena._candidate_dir())[0]))
        color,_=arena.write_contact_sheet(arena._candidate_dir()); digest=hashlib.sha256(color.read_bytes()).hexdigest()
        with self.assertRaises(RuntimeError): arena.accept("0"*64)
        self.assertEqual(arena.snapshot(),before)
        arena.accept(digest); self.assertEqual(arena.validate()[0],[])
        self.assertFalse((self.out.parent/".battle-arenas.accept-staging").exists())
        self.assertFalse((self.out.parent/".battle-arenas.accept-backup").exists())

    def test_failed_pre_or_post_acceptance_restores_exact_accepted_batch(self):
        self.make_batch(); self.accept_candidate(); accepted=arena.snapshot()
        candidate_manifest=arena._candidate_dir()/"manifest.json"
        value=json.loads(candidate_manifest.read_text()); value["batchSha256"]="0"*64
        candidate_manifest.write_text(json.dumps(value,indent=2)+"\n")
        with self.assertRaises(RuntimeError): arena.accept(json.loads((self.out/"manifest.json").read_text())["review"]["contactSheetSha256"])
        self.assertEqual(arena.snapshot(),accepted)
        arena.build_candidate(); color,_=arena.write_contact_sheet(arena._candidate_dir()); digest=hashlib.sha256(color.read_bytes()).hexdigest()
        original_validate=arena.validate; calls=0
        def fail_after_promotion(*args,**kwargs):
            nonlocal calls; calls+=1
            if calls==3: return ["forced post-promotion failure"],0
            return original_validate(*args,**kwargs)
        with mock.patch.object(arena,"validate",side_effect=fail_after_promotion):
            with self.assertRaises(RuntimeError): arena.accept(digest)
        self.assertEqual(arena.snapshot(),accepted)

    def test_first_acceptance_post_failure_leaves_no_runtime_batch(self):
        self.make_batch(); arena.build_candidate(); color,_=arena.write_contact_sheet(arena._candidate_dir())
        digest=hashlib.sha256(color.read_bytes()).hexdigest(); original_validate=arena.validate; calls=0
        def fail_after_promotion(*args,**kwargs):
            nonlocal calls; calls+=1
            if calls==3: return ["forced first post-promotion failure"],0
            return original_validate(*args,**kwargs)
        with mock.patch.object(arena,"validate",side_effect=fail_after_promotion):
            with self.assertRaises(RuntimeError): arena.accept(digest)
        self.assertFalse(self.out.exists())

    def test_validator_rejects_extra_hash_schema_review_and_cost_drift(self):
        self.make_batch(); self.accept_candidate()
        (self.out/"nested").mkdir(); Image.new("RGB",(2,2)).save(self.out/"nested/extra.png")
        self.assertTrue(any("unexpected" in error for error in arena.validate()[0]))
        (self.out/"nested/extra.png").unlink(); (self.out/"nested").rmdir()
        manifest_path=self.out/"manifest.json"; baseline=manifest_path.read_text(); manifest=json.loads(baseline)
        manifest["width"]=True; manifest_path.write_text(json.dumps(manifest,indent=2)+"\n")
        self.assertTrue(any("identity" in error for error in arena.validate()[0]))
        manifest_path.write_text(baseline); manifest=json.loads(baseline); manifest["entries"][0]["costUsd"]=0
        manifest_path.write_text(json.dumps(manifest,indent=2)+"\n")
        self.assertTrue(any("generation cost" in error for error in arena.validate()[0]))
        manifest_path.write_text(baseline); manifest=json.loads(baseline); manifest["review"]["grayscaleContactSheetSha256"]="0"*64
        manifest_path.write_text(json.dumps(manifest,indent=2)+"\n")
        self.assertTrue(any("grayscale" in error for error in arena.validate()[0]))

    def test_generation_reserves_globally_appends_and_bootstraps_anchor(self):
        self.raw.mkdir(parents=True); Image.new("RGB",(10,10),(2,3,4)).save(self.raw/"style-reference.png")
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image") as request:
            with self.assertRaisesRegex(RuntimeError,"Refusing generation"): arena.generate_raw(None,False,0.01,1)
            request.assert_not_called()
        calls=[]
        def fake(prompt,reference):
            calls.append(reference.name); return hashlib.sha256((prompt+str(len(calls))).encode()).digest(),{"usage":{"cost":0.1},"seconds":1}
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image",side_effect=fake),contextlib.redirect_stdout(io.StringIO()):
            result=arena.generate_raw(None,False,2.0,2)
        self.assertEqual(result["generated"],5); self.assertAlmostEqual(result["sessionCost"],0.5)
        self.assertEqual(calls[0],"style-reference.png"); self.assertEqual(calls[1:], ["mcp.png"]*4)
        first_ledger=json.loads((self.raw/"generation-ledger.json").read_text()); self.assertEqual(len(first_ledger["events"]),5)
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image",side_effect=fake),contextlib.redirect_stdout(io.StringIO()):
            second=arena.generate_raw({"AGENT"},False,1.0,1)
        second_ledger=json.loads((self.raw/"generation-ledger.json").read_text())
        self.assertEqual(second["generated"],1); self.assertEqual(len(second_ledger["events"]),6)
        self.assertAlmostEqual(second["authorizationSpend"],arena.PRIOR_ART_SPEND_USD+0.6)

    def test_concurrent_failure_drains_records_and_blocks_ambiguous_retry(self):
        self.raw.mkdir(parents=True); Image.new("RGB",(10,10),(2,3,4)).save(self.raw/"style-reference.png")
        Image.new("RGB",(16,16),(8,9,10)).save(self.raw/"mcp.png")
        def mixed(prompt,reference):
            if "AGENT OPERATIONS" in prompt: raise RuntimeError("ambiguous transport failure")
            return b"successful-config-bytes",{"usage":{"cost":0.1},"seconds":1,"response":{"usage":{"cost":0.1},"data":[{"b64_json":"eA=="}]}}
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image",side_effect=mixed),contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(RuntimeError,"requires reconciliation"):
                arena.generate_raw({"AGENT","CONFIG"},False,1.0,2)
        ledger=json.loads((self.raw/"generation-ledger.json").read_text()); events=ledger["events"]
        self.assertEqual({event["domain"]:event["status"] for event in events},{"AGENT":"ambiguous-provider-error","CONFIG":"generated"})
        self.assertTrue((self.raw/"config.png").exists()); self.assertTrue((self.raw/events[1]["responseArchive"]).exists())
        self.assertAlmostEqual(arena._authorization_spend(events),arena.PRIOR_ART_SPEND_USD+0.4)
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image") as request:
            with self.assertRaisesRegex(RuntimeError,"manually reconciled"):
                arena.generate_raw({"AGENT"},False,1.0,1)
            request.assert_not_called()

    def test_non_finite_cost_and_caps_remain_ambiguous_and_never_promote(self):
        for value in (float("nan"),float("inf"),float("-inf")):
            with self.subTest(cost=value):
                if self.raw.exists():
                    import shutil; shutil.rmtree(self.raw)
                self.raw.mkdir(parents=True); Image.new("RGB",(10,10),(2,3,4)).save(self.raw/"style-reference.png")
                def malformed(prompt,reference): return b"raw",{"usage":{"cost":value},"seconds":1,"response":{"usage":{"cost":"non-finite"}}}
                with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image",side_effect=malformed):
                    with self.assertRaisesRegex(RuntimeError,"positive numeric"):
                        arena.generate_raw({"MCP"},False,1,1)
                events=json.loads((self.raw/"generation-ledger.json").read_text())["events"]
                self.assertEqual(events[0]["status"],"ambiguous-cost");self.assertFalse((self.raw/"mcp.png").exists())
                self.assertAlmostEqual(arena._authorization_spend(events),arena.PRIOR_ART_SPEND_USD+arena.RESERVED_COST_PER_IMAGE)
        self.raw.mkdir(parents=True,exist_ok=True);Image.new("RGB",(10,10),(2,3,4)).save(self.raw/"style-reference.png")
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image") as request:
            with self.assertRaisesRegex(RuntimeError,"positive finite"):arena.generate_raw({"MCP"},False,float("nan"),1)
            request.assert_not_called()

    def test_generation_lock_authorization_and_positive_cost_fail_closed(self):
        self.raw.mkdir(parents=True); Image.new("RGB",(10,10),(2,3,4)).save(self.raw/"style-reference.png")
        self.out.mkdir(); (self.out/"manifest.json").write_text(json.dumps({"reviewState":"accepted"}))
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image") as request:
            with self.assertRaisesRegex(RuntimeError,"locked"): arena.generate_raw({"MCP"},False,1,1)
            request.assert_not_called()
        (self.out/"manifest.json").unlink(); self.out.rmdir()
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"PRIOR_ART_SPEND_USD",49.9),mock.patch.object(arena,"_request_image") as request:
            with self.assertRaisesRegex(RuntimeError,"authorization-wide"): arena.generate_raw({"MCP"},False,1,1)
            request.assert_not_called()
        def no_cost(prompt,reference): return b"raw",{"usage":{},"seconds":1}
        with mock.patch.dict(os.environ,{"OPENROUTER_API_KEY":"test"}),mock.patch.object(arena,"_request_image",side_effect=no_cost):
            with self.assertRaisesRegex(RuntimeError,"positive numeric"): arena.generate_raw({"MCP"},False,1,1)
        self.assertFalse((self.raw/"mcp.png").exists())

if __name__=="__main__": unittest.main()
