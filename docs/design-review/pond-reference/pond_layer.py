#!/usr/bin/env python3
"""
FluxCatch pond layer — reference generator (v3 spec).

This script IS the specification for the pond layer: port the algorithm to a
Canvas 2D offscreen render in the extension (same seeded PRNG, same noise
fields, same touch rules). It also contains the progress-colour check.

Usage:
  python3 pond_layer.py out_dir

Outputs (all PNG):
  pond-morning-1280x900.png        revised layer on the Morning canvas
  pond-dusk-1280x900.png           revised layer on the Dusk canvas
  pond-morning-grey.png            greyscale of the above (equiluminance check)
  pond-dusk-grey.png
  pond-v2-spec-as-written.png      the v2 spec (150–250 touches) for comparison
  pond-mock-empty-morning.png      Downloads empty state mock, Morning
  pond-mock-empty-dusk.png
  progress-hue-paths.png           lilac→ochre: short-arc OKLCH vs 3-stop vs OKLAB
  metrics.txt                      the numbers the design audit should assert

Dependencies: numpy, Pillow.
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

# ---------------------------------------------------------------- colour maths

def oklab_to_linear_srgb(L, a, b):
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bb = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return r, g, bb


def linear_to_srgb(x):
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def srgb_to_linear(x):
    x = np.asarray(x, dtype=np.float64)
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


def oklch_to_rgb8(L, C, h_deg):
    """OKLCH -> sRGB 8-bit tuple. L in [0,1], C >= 0, hue in degrees."""
    h = math.radians(h_deg)
    a, b = C * math.cos(h), C * math.sin(h)
    r, g, bb = oklab_to_linear_srgb(L, a, b)
    rgb = linear_to_srgb(np.array([r, g, bb]))
    return tuple(int(round(v * 255)) for v in rgb)


def rgb8_to_oklch(rgb):
    r, g, b = srgb_to_linear(np.array(rgb, dtype=np.float64) / 255.0)
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    C = math.hypot(a, bb)
    h = math.degrees(math.atan2(bb, a)) % 360
    return L, C, h


def image_to_oklab(arr8):
    """HxWx3 uint8 -> HxWx3 float (L, a, b)."""
    lin = srgb_to_linear(arr8.astype(np.float64) / 255.0)
    r, g, b = lin[..., 0], lin[..., 1], lin[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return np.stack([L, a, bb], axis=-1)


# ---------------------------------------------------------------- tokens

HEX = {
    "morning_canvas": "#F4F0E9",
    "dusk_canvas": "#1C2140",
    "pond_soft": "#7FA6C4",
    "lilac": "#9A8CC4",
    "celadon": "#8FB8A3",
    "rose": "#E3AFB4",
    "apricot": "#E7B089",
    "ochre": "#D9A24F",
}


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# Hue families of the pond palette, in OKLCH degrees (measured from the tokens).
PALETTE_HUES = {k: rgb8_to_oklch(hex_to_rgb(HEX[k]))[2]
                for k in ("pond_soft", "lilac", "celadon", "rose", "apricot")}

# ---------------------------------------------------------------- PRNG + noise

class Rng:
    """Mulberry32 — same algorithm is trivial to port to JS, so the layer is
    reproducible per install from one 32-bit seed."""

    def __init__(self, seed):
        self.a = seed & 0xFFFFFFFF

    def next(self):
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    def uniform(self, lo, hi):
        return lo + (hi - lo) * self.next()

    def normal(self, mu=0.0, sigma=1.0):
        u1 = max(self.next(), 1e-12)
        u2 = self.next()
        return mu + sigma * math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def value_noise(rng, w, h, cells_x, cells_y):
    """Smooth value noise in [0,1]: random lattice, bicubic upsample."""
    lattice = np.array([[rng.next() for _ in range(cells_x + 1)] for _ in range(cells_y + 1)],
                       dtype=np.float32)
    img = Image.fromarray((lattice * 255).astype(np.uint8), "L")
    img = img.resize((w, h), Image.BICUBIC)
    return np.asarray(img, dtype=np.float32) / 255.0


def fbm(rng, w, h, base_cells, octaves=3, gain=0.5):
    total = np.zeros((h, w), np.float32)
    amp, norm = 1.0, 0.0
    cx, cy = base_cells
    for _ in range(octaves):
        total += amp * value_noise(rng, w, h, cx, cy)
        norm += amp
        amp *= gain
        cx, cy = cx * 2, cy * 2
    total /= norm
    lo, hi = float(total.min()), float(total.max())
    return (total - lo) / max(hi - lo, 1e-6)


# ---------------------------------------------------------------- touches

def stamp(layer, cx, cy, length, width, angle_deg, rgb, alpha, feather=0.9):
    """Alpha-over an elongated soft ellipse into an RGBA float layer (premultiplied)."""
    h, w = layer.shape[:2]
    ca, sa = math.cos(math.radians(angle_deg)), math.sin(math.radians(angle_deg))
    rx, ry = length / 2.0, width / 2.0
    pad = int(math.ceil(max(rx, ry) + 2))
    x0, x1 = max(int(cx) - pad, 0), min(int(cx) + pad + 1, w)
    y0, y1 = max(int(cy) - pad, 0), min(int(cy) + pad + 1, h)
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1]
    dx, dy = xs - cx, ys - cy
    u = (dx * ca + dy * sa) / rx
    v = (-dx * sa + dy * ca) / ry
    d = np.sqrt(u * u + v * v)
    # soft edge: full inside, feathered rim
    a = np.clip((1.0 - d) / (1.0 - feather + 1e-6), 0, 1) ** 0.75
    a *= alpha
    src = np.array(rgb, dtype=np.float32) / 255.0
    dst = layer[y0:y1, x0:x1]
    a3 = a[..., None]
    dst[..., :3] = src * a3 + dst[..., :3] * (1 - a3)
    dst[..., 3:4] = a3 + dst[..., 3:4] * (1 - a3)


def render_pond(theme, w, h, seed, spec="v3"):
    """Return an RGBA float layer (straight alpha) of pond touches."""
    rng = Rng(seed)
    canvas_rgb = hex_to_rgb(HEX[f"{theme}_canvas"])
    Lc, Cc, _ = rgb8_to_oklch(canvas_rgb)

    layer = np.zeros((h, w, 4), np.float32)

    if spec == "v2":
        # The v2 spec exactly as written: 150–250 touches, 6–18 x 2–5 px,
        # equiluminant ±0.02, chroma 0.03–0.07, alpha 0.35–0.55.
        n = int(rng.uniform(150, 250))
        hues = list(PALETTE_HUES.values())
        for _ in range(n):
            cx, cy = rng.uniform(0, w), rng.uniform(0, h)
            length, width = rng.uniform(6, 18), rng.uniform(2, 5)
            ang = rng.normal(0, 6)
            L = Lc + rng.uniform(-0.02, 0.02)
            C = rng.uniform(0.03, 0.07)
            hue = hues[int(rng.next() * len(hues))]
            stamp(layer, cx, cy, length, width, ang, oklch_to_rgb8(L, C, hue), rng.uniform(0.35, 0.55))
        return layer

    # ---- v3: a water surface, not confetti -------------------------------
    # Large-scale structure first: a handful of horizontal "drifts" (gathered
    # reflections, lily-pad groups), each with a dominant hue family. Touches
    # gather inside drifts and thin out to open canvas between them.
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    n_drifts = int(round(6 * math.sqrt((w * h) / (1280.0 * 900.0))))
    density = np.zeros((h, w), np.float32)
    hue_acc = np.zeros((h, w), np.float32)
    wgt_acc = np.zeros((h, w), np.float32)
    for _ in range(max(n_drifts, 3)):
        cx, cy = rng.uniform(-0.1 * w, 1.1 * w), rng.uniform(-0.05 * h, 1.05 * h)
        sx, sy = rng.uniform(0.12 * w, 0.38 * w), rng.uniform(0.04 * h, 0.13 * h)
        amp = rng.uniform(0.55, 1.0)
        g = amp * np.exp(-(((xs - cx) ** 2) / (2 * sx * sx) + ((ys - cy) ** 2) / (2 * sy * sy)))
        density += g
        hpos = rng.next()                      # position along the hue-family list
        hue_acc += g * hpos
        wgt_acc += g
    density = np.clip(density, 0, 1)
    band = fbm(rng, w, h, (1, 9), octaves=2)   # fine horizontal ripples in density
    density = (0.012 + 0.988 * density ** 2.2) * (0.6 + 0.4 * band)
    hue_field = np.where(wgt_acc > 1e-4, hue_acc / np.maximum(wgt_acc, 1e-4), 0.5)

    # Hue families in order around the drift field. Neighbours in this list are
    # neighbours on the hue circle, so a drift never jumps across red.
    fam = ["celadon", "pond_soft", "lilac", "rose", "apricot"]
    fam_h = [PALETTE_HUES[k] for k in fam]

    def pick_hue(v):
        pos = v * (len(fam) - 1)
        i = min(int(pos), len(fam) - 2)
        t = pos - i
        h0, h1 = fam_h[i], fam_h[i + 1]
        d = ((h1 - h0 + 540) % 360) - 180
        return (h0 + d * t + rng.normal(0, 9)) % 360

    # Lightness offsets from the canvas, per scale. Morning touches sit a little
    # BELOW the cream ground (the ground is the lightest thing, as on Monet's
    # primed canvases); Dusk touches sit ABOVE the dark water (light reflected).
    if theme == "morning":
        dl = [(-0.030, 0.012), (-0.060, 0.020), (-0.075, 0.025)]
        chroma = [(0.022, 0.040), (0.028, 0.052), (0.030, 0.058)]
    else:
        dl = [(+0.070, 0.018), (+0.135, 0.028), (+0.165, 0.032)]
        chroma = [(0.030, 0.050), (0.040, 0.070), (0.045, 0.080)]

    area_scale = (w * h) / (1280.0 * 900.0)
    scales = [
        # (count, length range, width range, alpha range, chroma range)
        (int(420 * area_scale), (30, 84), (6, 11), (0.10, 0.24)),    # atmosphere
        (int(2600 * area_scale), (10, 30), (3, 6.5), (0.22, 0.48)),  # body of the water
        (int(3800 * area_scale), (4, 11), (2, 3.4), (0.26, 0.55)),   # fine touches
    ]
    for k, (count, lr, wr, ar) in enumerate(scales):
        cr = chroma[k]
        placed, attempts = 0, 0
        while placed < count and attempts < count * 8:
            attempts += 1
            cx, cy = rng.uniform(0, w), rng.uniform(0, h)
            if rng.next() > density[int(cy) % h, int(cx) % w]:
                continue
            placed += 1
            length, width = rng.uniform(*lr), rng.uniform(*wr)
            ang = rng.normal(0, 7)
            L = float(np.clip(Lc + rng.normal(*dl[k]), 0.05, 0.995))
            C = rng.uniform(*cr)
            hue = pick_hue(float(hue_field[int(cy) % h, int(cx) % w]))
            stamp(layer, cx, cy, length, width, ang, oklch_to_rgb8(L, C, hue), rng.uniform(*ar), feather=0.55)
    return layer


def composite(layer, canvas_rgb, blur_px=0.7, mask=None):
    """Put the layer on a flat canvas, then soften. mask: HxW float in [0,1] multiplies alpha."""
    h, w = layer.shape[:2]
    a = np.clip(layer[..., 3:4], 0, 1)
    if mask is not None:
        a = a * mask[..., None]
    rgb_pm = np.clip(layer[..., :3], 0, 1)
    # layer rgb is premultiplied by its own alpha; rescale if the mask changed alpha
    scale = np.where(layer[..., 3:4] > 1e-6, a / np.maximum(layer[..., 3:4], 1e-6), 0)
    base = np.array(canvas_rgb, dtype=np.float32)[None, None, :] / 255.0
    out = rgb_pm * scale + base * (1 - a)
    im = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGB")
    if blur_px > 0:
        im = im.filter(ImageFilter.GaussianBlur(blur_px))
    return im


def column_mask(w, h, x0, x1, y0, y1, feather=56):
    """1 outside the content box, 0 inside, soft feather at the box edge."""
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.maximum(np.maximum(x0 - xs, xs - x1), 0)
    dy = np.maximum(np.maximum(y0 - ys, ys - y1), 0)
    d = np.sqrt(dx * dx + dy * dy)
    return np.clip(d / feather, 0, 1).astype(np.float32)


# ---------------------------------------------------------------- metrics

def equiluminance_metrics(img, canvas_rgb, region):
    """Mean |dL| and mean chroma difference vs the canvas inside region (x0,y0,x1,y1)."""
    x0, y0, x1, y1 = region
    arr = np.asarray(img)[y0:y1, x0:x1]
    lab = image_to_oklab(arr)
    Lc, ac, bc = image_to_oklab(np.array([[canvas_rgb]], dtype=np.uint8))[0, 0]
    dL = np.abs(lab[..., 0] - Lc)
    dC = np.hypot(lab[..., 1] - ac, lab[..., 2] - bc)
    return float(dL.mean()), float(np.percentile(dL, 95)), float(dC.mean()), float(np.percentile(dC, 95))


# ---------------------------------------------------------------- progress colour

def oklch_mix(c0, c1, t, hue_mode="short"):
    L0, C0, h0 = c0
    L1, C1, h1 = c1
    L = L0 + (L1 - L0) * t
    C = C0 + (C1 - C0) * t
    d = (h1 - h0) % 360
    if hue_mode == "short":
        if d > 180:
            d -= 360
    else:  # long
        if d <= 180:
            d -= 360
    return L, C, (h0 + d * t) % 360


def progress_colour_v3(p, lilac, pond_soft, ochre):
    """Three-stop path: lilac -> pond-soft -> ochre, OKLCH, short arcs per leg."""
    if p <= 50:
        return oklch_mix(lilac, pond_soft, p / 50.0)
    return oklch_mix(pond_soft, ochre, (p - 50) / 50.0)


def render_progress_strips(path, font):
    lilac = rgb8_to_oklch(hex_to_rgb(HEX["lilac"]))
    pond = rgb8_to_oklch(hex_to_rgb(HEX["pond_soft"]))
    ochre = rgb8_to_oklch(hex_to_rgb(HEX["ochre"]))
    steps = list(range(0, 101, 5))
    rows = [
        ("REJECTED  v2 spec: color-mix(in oklch, lilac, ochre p%) - the short hue arc passes through red; 50-75% reads as error",
         [oklch_to_rgb8(*oklch_mix(lilac, ochre, p / 100)) for p in steps]),
        ("REJECTED  candidate: lilac -> pond-soft -> ochre in two legs - 60-80% lands on celadon, the colour of Completed",
         [oklch_to_rgb8(*progress_colour_v3(p, lilac, pond, ochre)) for p in steps]),
        ("ADOPTED   bar colour = state colour, no percentage hue: queued harbour, downloading pond, paused lilac, finishing ochre, complete celadon, failed vermilion",
         [hex_to_rgb(h) for h in ["#8A9BAE"] * 3 + ["#4E7FA2"] * 9 + ["#9A8CC4"] * 3 + ["#D9A24F"] * 3 + ["#8FB8A3"] * 2 + ["#D8603B"] * 1]),
    ]
    W, Hrow, pad = 1240, 110, 24
    im = Image.new("RGB", (W, Hrow * len(rows) + pad), hex_to_rgb(HEX["morning_canvas"]))
    d = ImageDraw.Draw(im)
    for r, (label, cols) in enumerate(rows):
        y = pad + r * Hrow
        d.text((pad, y), label, fill=(43, 46, 74), font=font)
        sw = (W - 2 * pad) / len(cols)
        for i, c in enumerate(cols):
            x = pad + i * sw
            d.rectangle([x, y + 28, x + sw - 2, y + 72], fill=c)
            if steps[i] % 25 == 0 or steps[i] in (30, 60):
                d.text((x, y + 78), f"{steps[i]}%", fill=(90, 95, 126), font=font)
    im.save(path)
    # numbers for the report
    out = []
    for p in (25, 31, 50, 62, 75):
        a = oklch_mix(lilac, ochre, p / 100)
        b = progress_colour_v3(p, lilac, pond, ochre)
        out.append(f"p={p:3d}  v2 hue={a[2]:6.1f}deg rgb={oklch_to_rgb8(*a)}   v3 hue={b[2]:6.1f}deg rgb={oklch_to_rgb8(*b)}")
    return "\n".join(out)


# ---------------------------------------------------------------- mock page

def mock_empty_state(theme, pond_img, font_display, font_text, font_meta):
    """Draw the Downloads empty state over the pond, with the mask the real page would use."""
    w, h = pond_img.size
    canvas = hex_to_rgb(HEX[f"{theme}_canvas"])
    if theme == "morning":
        t_primary, t_secondary, t_muted = (43, 46, 74), (90, 95, 126), (118, 122, 154)
        field = (236, 230, 222)
        primary_btn, on_accent = (78, 127, 162), (250, 247, 242)
    else:
        t_primary, t_secondary, t_muted = (239, 233, 224), (185, 182, 204), (150, 155, 180)
        field = (37, 43, 77)
        primary_btn, on_accent = (127, 176, 208), (28, 33, 64)
    im = pond_img.copy()
    d = ImageDraw.Draw(im)
    x = 278
    d.text((x, 134), "FluxCatch", fill=t_primary, font=font_text)
    d.ellipse([244, 128, 266, 150], outline=t_secondary, width=2)
    d.text((x, 196), "Downloads", fill=t_primary, font=font_display)
    d.rounded_rectangle([x, 252, 905, 288], radius=8, fill=field)
    d.text((x + 16, 262), "Paste a video or audio link", fill=t_muted, font=font_text)
    d.rounded_rectangle([917, 252, 998, 288], radius=8, fill=primary_btn)
    d.text((936, 262), "Download", fill=on_accent, font=font_text)
    d.ellipse([x, 311, x + 8, 319], fill=t_muted)
    d.text((x + 18, 306), "Local engine isn't set up", fill=t_secondary, font=font_meta)
    d.text((x + 196, 306), "Set up", fill=primary_btn, font=font_meta)
    d.text((x, 372), "No downloads yet.", fill=t_primary, font=font_display)
    d.text((x, 416), "On a video page, click the FluxCatch button in the toolbar, or paste a link above.",
           fill=t_secondary, font=font_meta)
    return im


# ---------------------------------------------------------------- main

def main(out):
    os.makedirs(out, exist_ok=True)
    W, H = 1280, 900
    seed = 0xF1C4C7  # per-install seed in production
    try:
        f_text = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 15)
        f_meta = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
        f_disp = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf", 28)
    except OSError:
        f_text = f_meta = f_disp = ImageFont.load_default()

    report = []

    # v2 spec as written (Morning) — the control
    v2 = composite(render_pond("morning", W, H, seed, spec="v2"), hex_to_rgb(HEX["morning_canvas"]), blur_px=0.6)
    v2.save(os.path.join(out, "pond-v2-spec-as-written.png"))

    for theme in ("morning", "dusk"):
        canvas = hex_to_rgb(HEX[f"{theme}_canvas"])
        layer = render_pond(theme, W, H, seed, spec="v3")
        full = composite(layer, canvas, blur_px=0.7)
        full.save(os.path.join(out, f"pond-{theme}-1280x900.png"))
        full.convert("L").save(os.path.join(out, f"pond-{theme}-grey.png"))
        # Empty-state mask: only the header/title/field block is cleared.
        mask = column_mask(W, H, 214, 1010, 110, 300, feather=64)
        masked = composite(layer, canvas, blur_px=0.7, mask=mask)
        mock = mock_empty_state(theme, masked, f_disp, f_text, f_meta)
        mock.save(os.path.join(out, f"pond-mock-empty-{theme}.png"))
        m = equiluminance_metrics(full, canvas, (0, 0, W, H))
        report.append(f"{theme}: mean|dL|={m[0]:.4f}  p95|dL|={m[1]:.4f}  meandC={m[2]:.4f}  p95dC={m[3]:.4f}")
        # coverage: share of pixels whose chroma differs from canvas by > 0.015
        lab = image_to_oklab(np.asarray(full))
        Lc, ac, bc = image_to_oklab(np.array([[canvas]], dtype=np.uint8))[0, 0]
        cov = float((np.hypot(lab[..., 1] - ac, lab[..., 2] - bc) > 0.015).mean())
        report.append(f"{theme}: coverage(dC>0.015)={cov:.3f}")

    m2 = equiluminance_metrics(v2, hex_to_rgb(HEX["morning_canvas"]), (0, 0, W, H))
    lab = image_to_oklab(np.asarray(v2))
    Lc, ac, bc = image_to_oklab(np.array([[hex_to_rgb(HEX["morning_canvas"])]], dtype=np.uint8))[0, 0]
    cov2 = float((np.hypot(lab[..., 1] - ac, lab[..., 2] - bc) > 0.015).mean())
    report.append(f"v2-as-written (morning): mean|dL|={m2[0]:.4f} meandC={m2[2]:.4f} coverage={cov2:.3f}")

    prog = render_progress_strips(os.path.join(out, "progress-hue-paths.png"), f_meta)
    report.append("progress colour:\n" + prog)
    report.append("palette hues (OKLCH deg): " + ", ".join(f"{k}={v:.0f}" for k, v in PALETTE_HUES.items()))
    with open(os.path.join(out, "metrics.txt"), "w") as fh:
        fh.write("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "pond-out")
