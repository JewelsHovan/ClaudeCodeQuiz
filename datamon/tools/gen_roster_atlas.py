#!/usr/bin/env python3
"""Pack accepted 256px trainer PNGs losslessly; no new art, resampling, or network.
Only RGB of fully transparent pixels is canonicalized; alpha and visible RGB are exact.

python3 datamon/tools/gen_roster_atlas.py          # regenerate
python3 datamon/tools/gen_roster_atlas.py --check  # deterministic bytes + pixel parity
"""
import argparse
import hashlib
import io
import json
import re
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

def build():
    source = (ROOT / "game.js").read_text()
    roster = json.loads(re.search(r"const ROSTER = (\[[\s\S]*?\]);", source)[1].replace(",\n]", "\n]"))
    cell, columns = 256, 8
    atlas = Image.new("RGBA", (columns * cell, ((len(roster) + columns - 1) // columns) * cell))
    entries = []
    for index, slug in enumerate(roster):
        path = ROOT / "sprites" / f"{slug}.png"
        image = Image.open(path).convert("RGBA")
        assert image.size == (cell, cell), slug
        x, y = index % columns * cell, index // columns * cell
        # Hidden RGB has no visual effect, but random matte colors waste lossless bytes.
        pixels = bytearray(image.tobytes())
        for offset in range(0, len(pixels), 4):
            if pixels[offset + 3] == 0:
                pixels[offset:offset + 3] = b"\0\0\0"
        image = Image.frombytes("RGBA", image.size, bytes(pixels))
        atlas.paste(image, (x, y))
        left, top, right, bottom = image.getchannel("A").getbbox()
        entries.append(dict(slug=slug, x=x, y=y, bounds=dict(x=left, y=top, w=right-left, h=bottom-top),
                            sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    out = io.BytesIO()
    atlas.save(out, format="WEBP", lossless=True, exact=True, method=6)
    data = out.getvalue()
    decoded = Image.open(io.BytesIO(data)).convert("RGBA")
    assert decoded.tobytes() == atlas.tobytes(), "Lossless atlas pixel mismatch"
    manifest = dict(schemaVersion=1, file="roster-atlas.webp", cell=cell, width=atlas.width, height=atlas.height,
                    sha256=hashlib.sha256(data).hexdigest(), bytes=len(data), entries=entries)
    return data, (json.dumps(manifest, indent=2) + "\n").encode()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    data, manifest = build()
    assert (data, manifest) == build(), "Non-deterministic atlas"
    for name, expected in [("roster-atlas.webp", data), ("roster-atlas.json", manifest)]:
        dest = ROOT / name
        if args.check:
            assert dest.read_bytes() == expected, f"Stale {name}; regenerate roster atlas"
        else:
            dest.write_bytes(expected)
    print(f"Roster atlas: {len(data)} bytes; deterministic, exact visible RGB and alpha for every accepted trainer")

if __name__ == "__main__":
    main()
