#!/usr/bin/env python3
"""Resolution x ref-count benchmark chart (PIL, no matplotlib)."""
import csv
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
data = {}
with open(HERE / "results.csv", newline="", encoding="utf-8") as f:
    for row in csv.reader(f, delimiter="|"):
        if len(row) >= 5 and row[0] != "mp":
            data.setdefault(row[0], {})[int(row[1])] = float(row[3].split()[1])

W, H = 1480, 920
ML, MR, MT, MB = 130, 330, 110, 130
PW, PH = W - ML - MR, H - MT - MB
XMIN, XMAX = 1, 10
YMAX = 220.0

COLORS = {"0.5": "#2563FF", "1.0": "#0E9668", "1.5": "#EA8A00", "2.0": "#D64545"}

def fx(x):
    return ML + (x - XMIN) / (XMAX - XMIN) * PW

def fy(y):
    return MT + PH - y / YMAX * PH

img = Image.new("RGB", (W, H), "white")
d = ImageDraw.Draw(img)
try:
    FT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 30)
    FL = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 24)
    FS = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
    FN = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
except OSError:
    FT = FL = FS = FN = ImageFont.load_default()

# grid + axes
for gy in range(0, 241, 20):
    y = fy(gy)
    d.line([(ML, y), (ML + PW, y)], fill="#E3EBF4", width=1)
    d.text((ML - 58, y - 11), str(gy), font=FS, fill="#57697F")
for gx in range(1, 11):
    x = fx(gx)
    d.line([(x, MT), (x, MT + PH)], fill="#EDF3FA", width=1)
    d.text((x - 7, MT + PH + 14), str(gx), font=FS, fill="#17233B")
d.line([(ML, MT), (ML, MT + PH)], fill="#9FB4CC", width=2)
d.line([(ML, MT + PH), (ML + PW, MT + PH)], fill="#9FB4CC", width=2)

d.text((ML + PW // 2 - 110, H - 78), "参考图数量（张）", font=FL, fill="#17233B")
d.text((36, MT + PH // 2 - 130), "生成耗时（秒）", font=FL, fill="#17233B")
d.text((ML - 30, 34), "Qwen-Image 2.1 生成耗时对比：分辨率 × 参考图数", font=FT, fill="#17233B")
d.text((ML - 30, 74), "NVIDIA DGX Spark (GB10) · 16:9 · 25 steps · cfg 1.0 · seed 20261001 · 2026-10-01", font=FS, fill="#57697F")

# series
for mp in ["0.5", "1.0", "1.5", "2.0"]:
    pts = sorted(data[mp].items())
    xy = [(fx(x), fy(y)) for x, y in pts]
    d.line(xy, fill=COLORS[mp], width=4)
    for (x, y), (rx, ry) in zip(xy, pts):
        r = 6
        d.ellipse([x - r, y - r, x + r, y + r], fill="white", outline=COLORS[mp], width=3)
        d.text((x - 16, y - 34), f"{ry:.0f}", font=FN, fill=COLORS[mp])

# legend
lx = ML + PW + 40
d.rounded_rectangle([lx - 14, MT + 6, lx + 258, MT + 250], radius=12, fill="#F7FAFF", outline="#D8E3F0")
d.text((lx + 6, MT + 22), "百万像素 (megapixels)", font=FS, fill="#17233B")
ly = MT + 66
for mp in ["0.5", "1.0", "1.5", "2.0"]:
    vals = data[mp]
    d.line([(lx + 6, ly + 9), (lx + 44, ly + 9)], fill=COLORS[mp], width=4)
    d.ellipse([lx + 20, ly + 3, lx + 30, ly + 13], fill="white", outline=COLORS[mp], width=2)
    avg = sum(vals.values()) / len(vals)
    d.text((lx + 54, ly - 2), f"{mp} MP  均 {avg:.0f}s", font=FS, fill=COLORS[mp])
    ly += 44

img.save(HERE / "q21_mp_benchmark_chart.png")
print("chart saved", img.size)
