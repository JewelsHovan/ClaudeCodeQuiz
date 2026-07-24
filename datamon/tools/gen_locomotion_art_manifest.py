#!/usr/bin/env python3
"""Build/check the accepted compact-locomotion provenance and byte-hash manifest."""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATAMON = HERE.parent
OUTPUT = DATAMON / "sprites-walk" / "manifest.json"
MODEL = "gpt-image-2-2026-04-21"
PILOT = ("alex-andrianavalontsalama", "julien-hovan", "veronica-marallag")
DOWN = (
    "alex-andrianavalontsalama", "antonia-nistor", "felicia-gorgacheva", "megane-darnaud",
    "minh-ngoc-do", "sarah-kotb", "scott-carr", "stephanie-fontaine",
    "tabarek-al-khalidi", "veronica-marallag", "vincent-anctil",
)
UP = (
    "alex-andrianavalontsalama", "antonia-nistor", "aurelien-bouffanais",
    "felicia-gorgacheva", "guillaume-pregent", "megane-darnaud", "minh-ngoc-do",
    "veronica-marallag", "vincent-anctil", "william-chan",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def payload() -> dict:
    roster = sorted(path.stem for path in (DATAMON / "sprites").glob("*.png"))
    files: dict[str, str] = {}
    views = []
    accepted = {slug: ["side"] for slug in roster}
    for slug in DOWN:
        accepted[slug].append("down")
    for slug in UP:
        accepted[slug].append("up")
    for slug in roster:
        slug_views = sorted(accepted[slug])
        views.append({"slug": slug, "views": slug_views})
        directions = []
        if "down" in slug_views:
            directions.append("down")
        if "up" in slug_views:
            directions.append("up")
        if "side" in slug_views:
            directions.extend(("left", "right"))
        for direction in directions:
            for index in range(4):
                relative = f"sprites-walk/{slug}/{direction}_{index}.png"
                files[relative] = sha256(DATAMON / relative)
        relative = f"sprites-walk/{slug}/manifest.json"
        files[relative] = sha256(DATAMON / relative)
    for slug in PILOT:
        for motion in ("walk", "run"):
            for direction in ("down", "left", "right", "up"):
                for index in range(8):
                    relative = f"sprites-locomotion-pilot/{slug}/{motion}_{direction}_{index}.png"
                    files[relative] = sha256(DATAMON / relative)
        relative = f"sprites-locomotion-pilot/{slug}/manifest.json"
        files[relative] = sha256(DATAMON / relative)
    ordered = dict(sorted(files.items()))
    digest = hashlib.sha256()
    for relative, value in ordered.items():
        digest.update(relative.encode()); digest.update(b"\0"); digest.update(value.encode()); digest.update(b"\n")
    return {
        "schemaVersion": 1,
        "reviewState": "accepted",
        "policy": "compact-idle-referenced-v2",
        "model": MODEL,
        "promptVersion": "compact-workplace-gait-v2",
        "generation": {"hardCallCap": 100, "recordedCalls": 95, "succeeded": 91, "interrupted": 4},
        "metrics": {
            "alphaThreshold": 128,
            "legacyMaxHeadToIdleRatio": 1.20,
            "legacyMaxSideToIdleRatio": 2.70,
            "pilotWalkMaxHeadToIdleRatio": 1.12,
            "pilotWalkMaxSideToIdleRatio": 2.45,
            "pilotRunMaxSideToIdleRatio": 3.20,
        },
        "legacyRegeneratedViews": views,
        "pilotRegenerated": [{"slug": slug, "motions": ["run", "walk"], "views": ["down", "side", "up"]} for slug in PILOT],
        "fileCount": len(ordered),
        "files": ordered,
        "batchSha256": digest.hexdigest(),
    }


def canonical_bytes() -> bytes:
    return (json.dumps(payload(), sort_keys=True, separators=(",", ":")) + "\n").encode()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = canonical_bytes()
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_bytes() != expected:
            print(f"stale compact locomotion manifest: {OUTPUT}")
            return 1
        print(f"compact locomotion manifest verified: {payload()['batchSha256']}")
        return 0
    OUTPUT.write_bytes(expected)
    print(f"wrote {OUTPUT}: {payload()['batchSha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
