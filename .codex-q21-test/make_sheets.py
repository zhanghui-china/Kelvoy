#!/usr/bin/env python3
"""Contact sheets for the people-count multi-ref test."""
from PIL import Image
from pathlib import Path

D = Path(__file__).resolve().parent / "people"
OUT = D.parent

def sheet(files, cols, out, cell=360, label_h=36):
    from PIL import ImageDraw
    rows = (len(files) + cols - 1) // cols
    canvas = Image.new("RGB", (cols * cell, rows * (cell + label_h)), "white")
    d = ImageDraw.Draw(canvas)
    for idx, f in enumerate(files):
        im = Image.open(D / f).convert("RGB")
        im.thumbnail((cell, cell))
        x = (idx % cols) * cell + (cell - im.width) // 2
        y = (idx // cols) * (cell + label_h) + (cell - im.height) // 2
        canvas.paste(im, (x, y))
        d.text(((idx % cols) * cell + 10, (idx // cols) * (cell + label_h) + cell + 8), f, fill="black")
    canvas.save(OUT / out)
    print(out, canvas.size)

refs = [f"person_{i:02d}.png" for i in range(1, 11)]
outs = sorted(p.name for p in D.glob("*_people_*ref.png"))
sheet(refs, 5, "sheet_refs_10_persons.png")
sheet(outs, 3, "sheet_results_2_to_10.png")
