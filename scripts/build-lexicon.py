#!/usr/bin/env python3
"""Build packaged lemma lists and PNG icons for the Littp extension."""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEX = ROOT / "extension" / "lexicon"
ICONS = ROOT / "extension" / "icons"
SRC = Path("/tmp/google-10000.txt")

FUNCTION_WORDS = """
a an the this that these those i me my mine myself we us our ours ourselves
you your yours yourself yourselves he him his himself she her hers herself
it its itself they them their theirs themselves who whom whose which what
when where why how be am is are was were been being have has had having
do does did doing done will would shall should can could may might must
ought need dare to of in on for with at from by as into about between
through during before after above below up down out off over under again
further then once here there all any both each few more most other some
such no nor not only own same so than too very just also and but if or
because until while although though whether either neither however therefore
thus hence plus per via versus please yes ok okay hi hello thanks thank
well still already yet even ever never always often sometimes usually really
quite rather almost enough back away around along across against among
behind beside beyond inside outside near without within upon toward towards
onto despite except including regarding isn't aren't wasn't weren't don't
doesn't didn't haven't hasn't hadn't won't wouldn't can't couldn't shouldn't
mustn't that's it's i'm i've i'd i'll you're you've you'd you'll he's she's
they're we've we'd we'll there's here's what's who's let's ain't
one two three four five six seven eight nine ten
mr mrs ms dr
""".split()

BAND_SLICES = {
    "primary": (2000, 3000),
    "junior": (3000, 4200),
    "senior": (4200, 5400),
    "cet4": (5400, 6800),
    "cet6": (6800, 8200),
    "academic": (8200, 9884),
}


def unique_lower(words: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in words:
        w = raw.strip().lower()
        if not w or w in seen:
            continue
        seen.add(w)
        out.append(w)
    return out


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path: Path, size: int) -> None:
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            nx = x / (size - 1)
            ny = y / (size - 1)
            bg = (18, 48, 46)
            fg = (156, 224, 206)
            ink = (244, 244, 241)
            r, g, b = bg
            # rounded tile
            margin = 0.12
            if margin <= nx <= 1 - margin and margin <= ny <= 1 - margin:
                r, g, b = (24, 64, 61)
            # vertical stem of L
            if 0.32 <= nx <= 0.44 and 0.28 <= ny <= 0.74:
                r, g, b = ink
            # foot of L
            if 0.32 <= nx <= 0.70 and 0.62 <= ny <= 0.74:
                r, g, b = ink
            # mint accent bar
            if 0.48 <= nx <= 0.72 and 0.30 <= ny <= 0.38:
                r, g, b = fg
            row.extend((r, g, b))
        rows.append(bytes(row))
    raw = b"".join(rows)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", zlib.compress(raw, 9)) + png_chunk(b"IEND", b"")
    path.write_bytes(png)


def main() -> None:
    words = unique_lower(SRC.read_text(encoding="utf-8").splitlines())
    function = unique_lower(FUNCTION_WORDS)
    frequent = words[:2000]
    write_json(LEX / "function-words.json", function)
    write_json(LEX / "frequent-2000.json", frequent)
    for name, (start, end) in BAND_SLICES.items():
        write_json(LEX / "bands" / f"{name}.json", words[start:end])

    ICONS.mkdir(parents=True, exist_ok=True)
    for size in (16, 48, 128):
        write_png(ICONS / f"icon{size}.png", size)

    print("function", len(function))
    print("frequent", len(frequent))
    for name, (start, end) in BAND_SLICES.items():
        print(name, end - start)


if __name__ == "__main__":
    main()
