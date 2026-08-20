#!/usr/bin/env python3
"""Generate and validate DATAMON's original hybrid audio runtime batch.

Long ambience is deterministically synthesized to PCM and encoded as mono MP3 with
ffmpeg. Short one-shots remain tiny PCM WAV files. Runtime never invokes this tool.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import shutil
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "datamon" / "audio"
MANIFEST = OUT / "manifest.json"
SAMPLE_RATE = 22050
BATCH_ID = "datamon-original-hybrid-audio-v1"
POLICY = "original-local-hybrid-v1"
MAX_PUBLIC_BYTES = 1024 * 1024

AMBIENCE = {
    "ambience.office": ("office-roomtone.mp3", 8.0, 0xA0FF1CE, "office"),
    "ambience.library": ("library-roomtone.mp3", 8.0, 0x11B4A7, "library"),
    "ambience.battle-room": ("battle-roomtone.mp3", 8.0, 0xBA771E, "battle-room"),
}

ONESHOTS = {
    "footstep.carpet.1": ("footstep-carpet-1.wav", 0.14, 0xCA401, "footstep", 88),
    "footstep.carpet.2": ("footstep-carpet-2.wav", 0.14, 0xCA402, "footstep", 96),
    "footstep.wood.1": ("footstep-wood-1.wav", 0.12, 0xD001, "footstep", 132),
    "footstep.wood.2": ("footstep-wood-2.wav", 0.12, 0xD002, "footstep", 146),
    "footstep.tile.1": ("footstep-tile-1.wav", 0.13, 0x711E1, "footstep", 172),
    "footstep.tile.2": ("footstep-tile-2.wav", 0.13, 0x711E2, "footstep", 188),
    "ui.navigate": ("ui-navigate.wav", 0.07, 0xA101, "ui", 760),
    "ui.confirm": ("ui-confirm.wav", 0.16, 0xA102, "ui", 620),
    "ui.reject": ("ui-reject.wav", 0.16, 0xA103, "ui", 185),
    "world.chair-sit": ("chair-sit.wav", 0.20, 0xC401, "foley", 118),
    "world.chair-stand": ("chair-stand.wav", 0.18, 0xC402, "foley", 152),
    "world.page": ("page-turn.wav", 0.24, 0xB001, "foley", 920),
    "world.door": ("door-warp.wav", 0.34, 0xD004, "foley", 220),
    "world.coffee": ("coffee-pour.wav", 0.42, 0xC0FFEE, "foley", 310),
    "world.console": ("console-data.wav", 0.30, 0xC0115, "foley", 540),
    "battle.transition": ("battle-transition.wav", 0.42, 0xBA7701, "battle", 196),
    "battle.sendout": ("battle-sendout.wav", 0.30, 0xBA7702, "battle", 420),
    "battle.hit": ("battle-hit.wav", 0.22, 0xBA7703, "battle", 112),
    "battle.block": ("battle-block.wav", 0.24, 0xBA7704, "battle", 520),
    "battle.heal": ("battle-heal.wav", 0.30, 0xBA7705, "battle", 660),
    "battle.faint": ("battle-faint.wav", 0.38, 0xBA7706, "battle", 240),
    "battle.flee": ("battle-flee.wav", 0.28, 0xBA7707, "battle", 330),
    "result.correct": ("result-correct.wav", 0.34, 0xC022EC7, "result", 523),
    "result.wrong": ("result-wrong.wav", 0.34, 0xBAD, "result", 210),
    "result.victory": ("result-victory.wav", 0.62, 0x71C70, "result", 523),
    "result.defeat": ("result-defeat.wav", 0.58, 0xDEFEA7, "result", 280),
}

GAINS = {"ambience": 0.16, "footstep": 0.24, "ui": 0.34, "foley": 0.30,
         "battle": 0.38, "result": 0.42}


def clamp(value: float) -> float:
    return max(-1.0, min(1.0, value))


def pcm_wav(path: Path, duration: float, sample_fn) -> None:
    frames = int(round(duration * SAMPLE_RATE))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        payload = bytearray()
        for index in range(frames):
            payload.extend(struct.pack("<h", round(clamp(sample_fn(index / SAMPLE_RATE, index, frames)) * 32767)))
        out.writeframes(payload)


def ambience_fn(seed: int, kind: str):
    rng = random.Random(seed)
    noise = [rng.uniform(-1, 1) for _ in range(int(8 * SAMPLE_RATE))]
    phase = {"office": 0.0, "library": 0.7, "battle-room": 1.4}[kind]

    def sample(t: float, index: int, frames: int) -> float:
        # Cosine edge window makes the generated source itself loop-safe.
        edge = min(1.0, index / 1102, (frames - 1 - index) / 1102)
        window = 0.5 - 0.5 * math.cos(math.pi * max(0.0, edge))
        base = noise[index] * ({"office": .020, "library": .011, "battle-room": .017}[kind])
        if kind == "office":
            tone = .014 * math.sin(math.tau * 60 * t) + .005 * math.sin(math.tau * 180 * t + phase)
        elif kind == "library":
            tone = .005 * math.sin(math.tau * 48 * t + phase) + .003 * math.sin(math.tau * 720 * t)
        else:
            tone = .016 * math.sin(math.tau * 42 * t + phase) + .006 * math.sin(math.tau * 168 * t)
            tone += .004 * math.sin(math.tau * 4 * t)
        return (base + tone) * window
    return sample


def oneshot_fn(seed: int, role: str, frequency: float):
    rng = random.Random(seed)
    noise = [rng.uniform(-1, 1) for _ in range(int(.7 * SAMPLE_RATE))]

    def sample(t: float, index: int, frames: int) -> float:
        progress = index / max(1, frames - 1)
        env = math.sin(math.pi * progress) * math.exp(-progress * (3.5 if role in ("result", "battle") else 6.0))
        n = noise[index] if index < len(noise) else 0
        if role == "footstep":
            return env * (.38 * n + .20 * math.sin(math.tau * (frequency - 45 * progress) * t))
        if role == "foley":
            return env * (.22 * n + .12 * math.sin(math.tau * (frequency + 80 * progress) * t))
        if role == "battle":
            sweep = frequency * (1.8 - .8 * progress)
            return env * (.27 * n + .30 * math.sin(math.tau * sweep * t))
        if role == "result":
            third = 1.259921 if seed & 1 else .793701
            return env * (.30 * math.sin(math.tau * frequency * t) + .18 * math.sin(math.tau * frequency * third * t))
        return env * (.38 * math.sin(math.tau * frequency * t) + .08 * n)
    return sample


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def wav_metadata(path: Path) -> tuple[int, int, float]:
    with wave.open(str(path), "rb") as item:
        return item.getnchannels(), item.getframerate(), item.getnframes() / item.getframerate()


def generate() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    expected_files = {entry[0] for entry in AMBIENCE.values()} | {entry[0] for entry in ONESHOTS.values()} | {"manifest.json"}
    for path in OUT.iterdir():
        if path.is_file() and path.name not in expected_files:
            path.unlink()

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("ffmpeg is required to generate the reviewed MP3 ambience batch")

    assets = []
    with tempfile.TemporaryDirectory(prefix="datamon-audio-") as temp:
        temp_root = Path(temp)
        for asset_id, (filename, duration, seed, kind) in AMBIENCE.items():
            source = temp_root / f"{kind}.wav"
            target = OUT / filename
            pcm_wav(source, duration, ambience_fn(seed, kind))
            subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
                            "-codec:a", "libmp3lame", "-b:a", "48k", "-ar", str(SAMPLE_RATE),
                            "-ac", "1", str(target)], check=True)
            assets.append(asset_record(asset_id, target, "ambience", duration, True))

    for asset_id, (filename, duration, seed, role, frequency) in ONESHOTS.items():
        target = OUT / filename
        pcm_wav(target, duration, oneshot_fn(seed, role, frequency))
        assets.append(asset_record(asset_id, target, role, duration, False))

    assets.sort(key=lambda item: item["id"])
    aggregate = sum(item["bytes"] for item in assets)
    manifest = {
        "schemaVersion": 1,
        "batchId": BATCH_ID,
        "reviewState": "accepted",
        "policy": POLICY,
        "originality": "deterministic local synthesis; no third-party or copyrighted samples",
        "generator": "datamon/tools/gen_audio_assets.py",
        "aggregateBytes": aggregate,
        "assetCount": len(assets),
        "limits": {"publicBytes": MAX_PUBLIC_BYTES, "decodedBytes": 4 * 1024 * 1024},
        "assets": assets,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    validate()
    print(f"Generated {len(assets)} original audio assets ({aggregate} bytes)")


def asset_record(asset_id: str, path: Path, role: str, duration: float, loop: bool) -> dict:
    suffix = path.suffix.lower()
    record = {
        "id": asset_id,
        "file": path.name,
        "format": suffix[1:],
        "role": role,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
        "channels": 1,
        "sampleRate": SAMPLE_RATE,
        "durationMs": round(duration * 1000),
        "gain": GAINS[role],
        "preload": "scene" if loop else "on-demand",
        "loop": {"startMs": 1, "endMs": round(duration * 1000) - 1} if loop else None,
        "provenance": {"kind": "deterministic-local-synthesis", "tool": "gen_audio_assets.py", "reviewState": "accepted"},
    }
    return record


def validate() -> None:
    raw = json.loads(MANIFEST.read_text())
    assert raw["schemaVersion"] == 1 and raw["batchId"] == BATCH_ID
    assert raw["reviewState"] == "accepted" and raw["policy"] == POLICY
    assets = raw["assets"]
    assert raw["assetCount"] == len(assets) == len(AMBIENCE) + len(ONESHOTS)
    assert len({item["id"] for item in assets}) == len(assets)
    assert len({item["file"] for item in assets}) == len(assets)
    aggregate = 0
    for item in assets:
        path = OUT / item["file"]
        assert path.is_file() and "/" not in item["file"] and "\\" not in item["file"]
        assert path.stat().st_size == item["bytes"] and sha256(path) == item["sha256"]
        assert item["format"] in {"mp3", "wav"} and path.suffix == "." + item["format"]
        assert item["channels"] == 1 and item["sampleRate"] == SAMPLE_RATE
        assert item["provenance"]["reviewState"] == "accepted"
        if item["format"] == "wav":
            channels, rate, duration = wav_metadata(path)
            assert channels == 1 and rate == SAMPLE_RATE
            assert abs(duration * 1000 - item["durationMs"]) <= 1
        if item["loop"]:
            assert 0 <= item["loop"]["startMs"] < item["loop"]["endMs"] <= item["durationMs"]
        aggregate += item["bytes"]
    assert aggregate == raw["aggregateBytes"] <= raw["limits"]["publicBytes"] == MAX_PUBLIC_BYTES
    expected = {"manifest.json", *(item["file"] for item in assets)}
    assert {path.name for path in OUT.iterdir() if path.is_file()} == expected


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        validate()
        print(f"Audio manifest valid: {json.loads(MANIFEST.read_text())['assetCount']} assets")
    else:
        generate()


if __name__ == "__main__":
    main()
