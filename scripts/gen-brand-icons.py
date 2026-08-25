#!/usr/bin/env python3
"""Generate the Codon brand icon set from a programmatic master artwork.

Motif: DNA double helix (codon = DNA triplet) on an indigo->violet gradient,
macOS squircle-style rounded rect. Outputs icns / ico / png variants.
"""
from __future__ import annotations
import math
import os
import subprocess
import sys
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), "..", "dsh-agent-extension", "media", "brand")
S = 1024          # master size
SS = 4            # supersampling factor
RADIUS = int(S * 0.224)

C_TOP = (79, 70, 229)     # indigo-600
C_BOT = (139, 92, 246)    # violet-500


def rounded_gradient() -> Image.Image:
    img = Image.new("RGBA", (S * SS, S * SS), (0, 0, 0, 0))
    px = img.load()
    # vertical gradient fill
    grad = Image.new("RGBA", (S * SS, S * SS))
    gp = grad.load()
    for y in range(S * SS):
        t = y / (S * SS - 1)
        r = int(C_TOP[0] + (C_BOT[0] - C_TOP[0]) * t)
        g = int(C_TOP[1] + (C_BOT[1] - C_TOP[1]) * t)
        b = int(C_TOP[2] + (C_BOT[2] - C_TOP[2]) * t)
        for x in range(0, S * SS):
            gp[x, y] = (r, g, b, 255)
    mask = Image.new("L", (S * SS, S * SS), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, S * SS - 1, S * SS - 1], radius=RADIUS * SS, fill=255)
    img.paste(grad, (0, 0), mask)

    # soft top-left radial highlight
    hl = Image.new("L", (S * SS, S * SS), 0)
    hd = ImageDraw.Draw(hl)
    cx, cy, cr = int(S * 0.28 * SS), int(S * 0.20 * SS), int(S * 0.75 * SS)
    steps = 48
    for i in range(steps, 0, -1):
        t = i / steps
        alpha = int(26 * (1 - t))
        hd.ellipse([cx - cr * t, cy - cr * t, cx + cr * t, cy + cr * t], fill=alpha)
    white = Image.new("RGBA", (S * SS, S * SS), (255, 255, 255, 255))
    img.paste(white, (0, 0), hl)
    return img


def helix(img: Image.Image) -> None:
    """Two vertical sine strands (phase-shifted pi) plus connecting rungs.

    PIL's alpha blending is unreliable across versions, so every stroke is
    pre-blended against the local gradient color and drawn opaque.
    """
    d = ImageDraw.Draw(img)
    W = S * SS
    cx = W // 2
    amp = int(S * 0.155) * SS
    y0, y1 = int(S * 0.20) * SS, int(S * 0.80) * SS
    turns = 2.6
    period = (y1 - y0) / turns
    thick = int(S * 0.055) * SS
    rung_thick = int(S * 0.030) * SS

    def base_at(y: float) -> tuple[int, int, int]:
        t = min(1.0, max(0.0, y / (W - 1)))
        return tuple(int(C_TOP[i] + (C_BOT[i] - C_TOP[i]) * t) for i in range(3))

    def blend(y: float, alpha: float) -> tuple[int, int, int, int]:
        b = base_at(y)
        return tuple(int(alpha * 255 + (1 - alpha) * b[i]) for i in range(3)) + (255,)

    def x_at(y: float, phase: float) -> float:
        return cx + amp * math.sin((y - y0) / period * 2 * math.pi + phase)

    def strand_segments(phase: float, alpha: float):
        """Yield (p1, p2, color) short segments with per-y pre-blended color."""
        pts = strand_pts(phase)
        for i in range(len(pts) - 1):
            ym = (pts[i][1] + pts[i + 1][1]) / 2
            yield pts[i], pts[i + 1], blend(ym, alpha)

    def strand_pts(phase: float) -> list[tuple[float, float]]:
        pts = []
        n = 160
        for i in range(n + 1):
            y = y0 + (y1 - y0) * i / n
            pts.append((x_at(y, phase), y))
        return pts

    # 1) rungs (deepest layer)
    n_rungs = 8
    for i in range(n_rungs):
        y = y0 + (y1 - y0) * (i + 0.5) / n_rungs
        xa, xb = x_at(y, 0.0), x_at(y, math.pi)
        left, right = sorted([xa, xb])
        depth = abs(math.sin((y - y0) / period * 2 * math.pi))
        a = 0.45 + 0.45 * depth
        col = blend(y, a)
        d.line([(left, y), (right, y)], fill=col, width=rung_thick)
        rr = rung_thick * 0.92
        for xx in (left, right):
            d.ellipse([xx - rr, y - rr, xx + rr, y + rr],
                      fill=blend(y, min(1.0, a + 0.1)))

    # 2) back strand (dim, pre-blended); round joints kill segment-cap fringing
    r_joint = thick / 2
    for p1, p2, col in strand_segments(math.pi, 0.55):
        d.line([p1, p2], fill=col, width=thick)
        d.ellipse([p2[0] - r_joint, p2[1] - r_joint, p2[0] + r_joint, p2[1] + r_joint], fill=col)

    # 3) front strand (solid white)
    d.line(strand_pts(0.0), fill=(255, 255, 255, 255), width=thick, joint="curve")

    # 4) end caps
    for phase, alpha in ((0.0, 1.0), (math.pi, 0.55)):
        for y in (y0, y1):
            x = x_at(y, phase)
            r = thick * 0.60
            d.ellipse([x - r, y - r, x + r, y + r], fill=blend(y, alpha))


def emit(master: Image.Image, name_prefix: str) -> None:
    os.makedirs(OUT, exist_ok=True)
    master_1024 = master.resize((1024, 1024), Image.LANCZOS)
    master_1024.save(os.path.join(OUT, f"{name_prefix}-mark.png"))

    # macOS iconset -> icns
    iconset = os.path.join(OUT, f"{name_prefix}.iconset")
    os.makedirs(iconset, exist_ok=True)
    sizes = [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2),
             (256, 1), (256, 2), (512, 1), (512, 2)]
    for base, scale in sizes:
        sz = base * scale
        img = master.resize((sz, sz), Image.LANCZOS)
        nm = f"icon_{base}x{base}" + ("@2x.png" if scale == 2 else ".png")
        img.save(os.path.join(iconset, nm))
    subprocess.run(["iconutil", "-c", "icns", iconset,
                    "-o", os.path.join(OUT, f"{name_prefix}.icns")], check=True)

    # Windows ico
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [master.resize((s, s), Image.LANCZOS) for s in ico_sizes]
    imgs[-1].save(os.path.join(OUT, f"{name_prefix}.ico"),
                  format="ICO", sizes=[(s, s) for s in ico_sizes])

    # Linux / generic pngs
    for sz in (512, 256, 128):
        master.resize((sz, sz), Image.LANCZOS).save(
            os.path.join(OUT, f"{name_prefix}-{sz}.png"))
    print("emitted:", sorted(os.listdir(OUT)))


if __name__ == "__main__":
    art = rounded_gradient()
    helix(art)
    master = art.resize((S, S), Image.LANCZOS)
    emit(master, "codon")
