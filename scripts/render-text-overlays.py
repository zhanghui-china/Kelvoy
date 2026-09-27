"""Render transparent text layers for FFmpeg builds without ASS/drawtext.

The Worker writes one JSON manifest and invokes this once per compose job.
All timing stays in the Worker's integer-frame ComposePlan; this script only
draws pixels for the already determined title, AI label and captions.
"""

import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font_path() -> str:
    candidates = [
        os.environ.get("KELVOY_FONT_FILE", ""),
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    raise RuntimeError("未找到可绘制中文字幕的字体；设置 KELVOY_FONT_FILE")


def wrap(text: str, draw: ImageDraw.ImageDraw, font: ImageFont.FreeTypeFont, limit: int) -> str:
    lines = []
    for paragraph in text.splitlines() or [text]:
        line = ""
        for char in paragraph:
            proposed = line + char
            if line and draw.textlength(proposed, font=font) > limit:
                lines.append(line)
                line = char
            else:
                line = proposed
        lines.append(line)
    return "\n".join(lines)


def render(event: dict, width: int, height: int, face: str) -> None:
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    kind = event["kind"]
    divisor = {"Title": 17, "Caption": 25, "Label": 30}[kind]
    font = ImageFont.truetype(face, max(8, round(width / divisor)))
    text = wrap(event["text"], draw, font, round(width * 0.88))
    bbox = draw.multiline_textbbox((0, 0), text, font=font, spacing=6)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    if kind == "Title":
        x, y = round((width - text_width) / 2), round(height * 0.12)
    elif kind == "Caption":
        x, y = round((width - text_width) / 2), round(height * 0.83 - text_height)
    else:
        x, y = round(width * 0.955 - text_width), round(height * 0.96 - text_height)
        pad = max(4, round(width * 0.01))
        draw.rounded_rectangle((x - pad, y - pad, x + text_width + pad,
                                y + text_height + pad), radius=pad, fill=(0, 0, 0, 100))
    draw.multiline_text((x, y), text, font=font, fill=(255, 255, 255, 255),
                        stroke_width=max(1, round(width / 360)), stroke_fill=(0, 0, 0, 190), spacing=6)
    image.save(event["path"], "PNG")


def main() -> None:
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    face = font_path()
    for event in manifest["events"]:
        render(event, manifest["width"], manifest["height"], face)


if __name__ == "__main__":
    main()
