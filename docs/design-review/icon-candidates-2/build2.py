#!/usr/bin/env python3
"""Round 2 FluxCatch icon candidates: the download glyph read through Monet.
Builds SVG (128 and 16 variants), PNG rasters and a contact sheet with headless Chromium."""
import asyncio, os, base64
from playwright.async_api import async_playwright

OUT = os.path.dirname(os.path.abspath(__file__))
POND, POND_SOFT, LILAC, CELADON, ROSE, APRICOT, OCHRE = "#4E7FA2", "#7FA6C4", "#9A8CC4", "#8FB8A3", "#E3AFB4", "#E7B089", "#D9A24F"
INDIGO, CREAM, DUSK = "#2B2E4A", "#F4F0E9", "#1C2140"

def dab(cx, cy, L, t, fill, op=.8, rot=0, skew=0.18):
    rx, ry = L / 2, t / 2
    p = (f'M{cx-rx},{cy} C{cx-rx+rx*0.3},{cy-ry*(1+skew)} {cx+rx*0.5},{cy-ry*(1+skew)} {cx+rx},{cy} '
         f'C{cx+rx*0.5},{cy+ry*(1-skew)} {cx-rx+rx*0.3},{cy+ry*(1-skew)} {cx-rx},{cy}Z')
    return f'<path d="{p}" fill="{fill}" fill-opacity="{op}" transform="rotate({rot} {cx} {cy})"/>'

FILTERS = ('<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="0.9"/></filter>'
           '<filter id="softer" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="2.2"/></filter>'
           '<filter id="haze" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>')

def arrow(cx, top, tip, half, sw, color, op=1.0):
    """A download arrow: stem from `top` to the chevron, chevron tip at `tip`, half-width `half`, stroke sw."""
    knee = tip - half * 0.95
    return (f'<path d="M{cx},{top} V{tip - sw*0.1}" stroke="{color}" stroke-opacity="{op}" stroke-width="{sw}" stroke-linecap="round" fill="none"/>'
            f'<path d="M{cx-half},{knee} L{cx},{tip} L{cx+half},{knee}" stroke="{color}" stroke-opacity="{op}" stroke-width="{sw}" '
            f'stroke-linecap="round" stroke-linejoin="round" fill="none"/>')

def scene(waterline=70, sky=("#F6EEE3", "#ECDDCF"), water=("#9DBBD1", POND_SOFT, POND)):
    return [f'<defs><clipPath id="c"><circle cx="64" cy="64" r="62"/></clipPath>'
            f'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{sky[0]}"/><stop offset="1" stop-color="{sky[1]}"/></linearGradient>'
            f'<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="{water[0]}"/><stop offset=".3" stop-color="{water[1]}"/><stop offset="1" stop-color="{water[2]}"/></linearGradient>'
            f'{FILTERS}</defs>', '<g clip-path="url(#c)">',
            '<rect x="0" y="0" width="128" height="128" fill="url(#sky)"/>',
            f'<rect x="0" y="{waterline}" width="128" height="{128-waterline}" fill="url(#water)"/>']

def tapered(p0, p1, w0, w1, color, op=1.0):
    """A tapered brush stroke from p0 (width w0) to p1 (width w1) with round ends."""
    import math
    (x0, y0), (x1, y1) = p0, p1
    dx, dy = x1 - x0, y1 - y0
    n = math.hypot(dx, dy); nx, ny = -dy / n, dx / n
    pts = [(x0 + nx*w0/2, y0 + ny*w0/2), (x1 + nx*w1/2, y1 + ny*w1/2), (x1 - nx*w1/2, y1 - ny*w1/2), (x0 - nx*w0/2, y0 - ny*w0/2)]
    poly = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
    return (f'<polygon points="{poly}" fill="{color}" fill-opacity="{op}"/>'
            f'<circle cx="{x0}" cy="{y0}" r="{w0/2}" fill="{color}" fill-opacity="{op}"/>'
            f'<circle cx="{x1}" cy="{y1}" r="{w1/2}" fill="{color}" fill-opacity="{op}"/>')

def brush_arrow(cx, top, tip, half, color, op=1.0, w=12):
    """A download arrow drawn as three tapered brush strokes."""
    knee = tip - half * 0.92
    return (tapered((cx, top), (cx, tip - 3), w * 1.05, w * 0.75, color, op)
            + tapered((cx - half, knee), (cx, tip), w * 0.95, w * 0.7, color, op)
            + tapered((cx + half, knee), (cx, tip), w * 0.95, w * 0.7, color, op))

def ripple_mask(mid="m", y0=72, y1=126):
    """A mask of soft horizontal bands, irregular in length and offset, fading with depth:
    the reflection shows only through them, as on rippled water."""
    rows = [(77, 120, 4.5, .95, -2), (83, 96, 4, .85, 6), (89, 124, 5, .8, -4), (96, 84, 4.5, .7, 5),
            (103, 116, 5, .6, -3), (110, 92, 5, .5, 4), (117, 108, 5, .38, -5), (123, 80, 5, .26, 3)]
    dabs = "".join(dab(64 + off, cy, L, t, "#fff", op, 0) for (cy, L, t, op, off) in rows)
    return (f'<mask id="{mid}" maskUnits="userSpaceOnUse" x="0" y="{y0}" width="128" height="{y1-y0}">'
            f'<g filter="url(#soft)">{dabs}</g></mask>')

def reflection(arrow_svg, waterline, color_op=.30, blur="softer"):
    """Mirror the arrow below the waterline, fade it, blur it, and break it with the ripple mask."""
    return (f'<g mask="url(#m)" opacity="{color_op}"><g filter="url(#{blur})"><g transform="translate(0,{waterline*1.86}) scale(1,-0.86)">{arrow_svg}</g></g></g>')

def dawn_haze(wl):
    return ('<g filter="url(#haze)">' + dab(64, wl - 7, 150, 10, APRICOT, .28, 0) + dab(64, wl, 150, 9, "#CBD8E1", .6, 0) + '</g>')

def water_touches():
    return ('<g filter="url(#soft)">' + dab(26, 86, 24, 6, LILAC, .7, -2) + dab(102, 94, 26, 6, CELADON, .65, 2)
            + dab(98, 80, 16, 4, ROSE, .6, 2) + dab(28, 106, 18, 5, CELADON, .45, -2) + dab(92, 112, 14, 4, LILAC, .4, 2) + '</g>')

# ---------------------------------------------------------------- D3 · stroke arrow + true reflection
def icon_d3(small=False, color=INDIGO):
    wl = 70
    body = scene(waterline=wl)
    if small:
        body += [arrow(64, 22, 60, 22, 17, color), '</g>']
        return body
    a = arrow(64, 22, 57, 19, 10.5, color)
    body += [ripple_mask(), dawn_haze(wl),
             reflection(a, wl, .22), water_touches(), a, '</g>']
    return body

# ---------------------------------------------------------------- G · brush arrow + reflection
def icon_g(small=False, color=INDIGO):
    wl = 70
    body = scene(waterline=wl)
    if small:
        body += [brush_arrow(64, 20, 62, 24, color, 1, 18), '</g>']
        return body
    a = brush_arrow(64, 20, 59, 21, color, 1, 11.5)
    body += [ripple_mask(), dawn_haze(wl),
             reflection(a, wl, .22), water_touches(), a, '</g>']
    return body

# ---------------------------------------------------------------- H · filled arrow (a solid form) + reflection
def filled_arrow(cx, top, tip, half, stem_w, color, op=1.0):
    knee = tip - half * 0.9
    p = (f'M{cx-stem_w/2},{top} h{stem_w} V{knee} h{half-stem_w/2} L{cx},{tip} L{cx-half},{knee} h{half-stem_w/2} Z')
    return f'<path d="{p}" fill="{color}" fill-opacity="{op}" stroke="{color}" stroke-opacity="{op}" stroke-width="6" stroke-linejoin="round"/>'

def icon_h(small=False, color=POND):
    wl = 70
    body = scene(waterline=wl)
    if small:
        body += [filled_arrow(64, 20, 62, 26, 16, color), '</g>']
        return body
    a = filled_arrow(64, 22, 59, 22, 12, color)
    body += [ripple_mask(), dawn_haze(wl),
             reflection(a, wl, .24), water_touches(), a, '</g>']
    return body

def svg(body):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n  ' + '\n  '.join(body) + '\n</svg>\n'

icons = {
    "d3-stroke-arrow": (svg(icon_d3()), svg(icon_d3(True))),
    "g-brush-arrow": (svg(icon_g()), svg(icon_g(True))),
    "h-filled-arrow": (svg(icon_h()), svg(icon_h(True))),
    "h2-filled-arrow-indigo": (svg(icon_h(color=INDIGO)), svg(icon_h(True, color=INDIGO))),
}
for name, (big, small) in icons.items():
    open(os.path.join(OUT, f"fluxcatch-{name}.svg"), "w").write(big)
    open(os.path.join(OUT, f"fluxcatch-{name}-16.svg"), "w").write(small)

def data(s): return "data:image/svg+xml;base64," + base64.b64encode(s.encode()).decode()

def icon_row(label, note, big, small):
    sizes = [(128, big), (48, big), (32, big), (16, small)]
    cells = ""
    for bg, fg, cap in [("#FFFFFF", "#202124", "Chrome light toolbar"), ("#35363A", "#E8EAED", "Chrome dark toolbar"), (CREAM, INDIGO, "Morning canvas"), (DUSK, "#EFE9E0", "Dusk canvas")]:
        imgs = "".join(f'<img src="{data(s)}" width="{w}" height="{w}" style="margin-right:{14 if w>16 else 0}px;vertical-align:bottom">' for w, s in sizes)
        cells += f'<div class="cell" style="background:{bg};color:{fg}"><div class="imgs">{imgs}</div><div class="cap">{cap} · 128 / 48 / 32 / 16</div></div>'
    return f'<section><h2>{label}</h2><p class="note">{note}</p><div class="cells">{cells}</div></section>'

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body {{ margin: 0; padding: 32px 40px; background: #FAF7F2; color: {INDIGO}; font-family: 'DejaVu Sans', sans-serif; width: 1240px; }}
h1 {{ font-size: 22px; margin: 0 0 6px; }} h2 {{ font-size: 16px; margin: 28px 0 4px; }} .note {{ margin: 0 0 10px; color: #5A5F7E; font-size: 13px; }}
.cells {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
.cell {{ padding: 14px 16px 10px; border-radius: 8px; }} .cap {{ font-size: 11px; opacity: .7; margin-top: 8px; }}
.imgs {{ height: 128px; display:flex; align-items:flex-end; }}
</style></head><body>
<h1>FluxCatch · icon candidates, round 2: the download arrow and its reflection · 2026-10-24</h1>
<p class="note">Every mark keeps the one glyph everyone reads as "download" (an arrow coming down to a line) and builds the scene around it from the Morning tokens: the line is a waterline, the sky above, the pond below, and the reflection is painted. Original vector work; no painting is referenced.</p>
{icon_row("D3 · Stroke arrow on the waterline", "The plain download arrow in the system's text indigo, descending toward the waterline; below the line its true reflection, mirrored, faded and broken by ripples, with a few hue touches on the water. 16 px: two-tone disc and a solid arrow.", *icons["d3-stroke-arrow"])}
{icon_row("G · Brush arrow", "The same scene, the arrow drawn as three tapered brush strokes, thicker where the brush was set down and thinner where it was lifted; the reflection follows. Less of a system glyph, more of a hand. 16 px: the brush arrow, heavier.", *icons["g-brush-arrow"])}
{icon_row("H · Filled arrow, pond", "A solid arrow form in pond blue, the colour of the product's primary button, standing on the sky above the waterline with its reflection in the water. The most emblematic; reads as a mark rather than an icon. 16 px: the solid form.", *icons["h-filled-arrow"])}
</body></html>"""
open(os.path.join(OUT, "sheet2.html"), "w").write(html)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1320, "height": 900}, device_scale_factor=2)
        await pg.goto("file://" + os.path.join(OUT, "sheet2.html"))
        await pg.screenshot(path=os.path.join(OUT, "icon-sheet-round2.png"), full_page=True)
        for name, (big, small) in icons.items():
            for size, s in ((128, big), (16, small)):
                await pg.set_content(f'<body style="margin:0;background:transparent"><img src="{data(s)}" width="{size}" height="{size}"></body>')
                el = await pg.query_selector("img")
                await el.screenshot(path=os.path.join(OUT, f"fluxcatch-{name}-{size}.png"), omit_background=True)
        await b.close()
asyncio.run(main()); print("ok")
