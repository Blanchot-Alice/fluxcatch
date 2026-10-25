#!/usr/bin/env python3
"""Build three FluxCatch icon candidates (SVG, 128 and 16 variants), a settings
divider mock, and a contact sheet rendered with headless Chromium."""
import asyncio, os, textwrap
from playwright.async_api import async_playwright

OUT = os.path.dirname(os.path.abspath(__file__))

POND, POND_SOFT, LILAC, CELADON, ROSE, APRICOT, OCHRE = "#4E7FA2", "#7FA6C4", "#9A8CC4", "#8FB8A3", "#E3AFB4", "#E7B089", "#D9A24F"
CREAM, DUSK = "#F4F0E9", "#1C2140"

def touch(x, y, w, h, fill, op=1.0, rot=0):
    """A horizontal brush touch: a rounded capsule, optionally tilted a few degrees."""
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h/2}" fill="{fill}" fill-opacity="{op}" '
            f'transform="rotate({rot} {x + w/2} {y + h/2})"/>')

def dab(cx, cy, L, t, fill, op=.8, rot=0, skew=0.18):
    """A painterly dab: an ellipse pulled slightly asymmetric (thicker at one end),
    like a loaded brush set down and lifted. Drawn under a soft blur filter."""
    rx, ry = L / 2, t / 2
    # path: top edge bulges toward +x, bottom edge is flatter
    p = (f'M{cx-rx},{cy} '
         f'C{cx-rx+rx*0.3},{cy-ry*(1+skew)} {cx+rx*0.5},{cy-ry*(1+skew)} {cx+rx},{cy} '
         f'C{cx+rx*0.5},{cy+ry*(1-skew)} {cx-rx+rx*0.3},{cy+ry*(1-skew)} {cx-rx},{cy}Z')
    return f'<path d="{p}" fill="{fill}" fill-opacity="{op}" transform="rotate({rot} {cx} {cy})"/>'

FILTERS = ('<filter id="soft" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="0.9"/></filter>'
           '<filter id="haze" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>')

def disc(top, bottom, gid="g"):
    return (f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>')

# ---------------------------------------------------------------- A · Drift (painted water)
def icon_a(small=False):
    body = [f'<defs>{disc("#8AB0CB", POND)}{FILTERS}</defs>',
            '<circle cx="64" cy="64" r="62" fill="url(#g)"/>']
    if small:
        body += [dab(46, 46, 52, 18, LILAC, 1, -3),
                 dab(76, 66, 60, 19, CELADON, 1, 2),
                 dab(50, 86, 46, 17, ROSE, 1, -2)]
        return body
    body.append('<g filter="url(#soft)">')
    # a lilac drift, upper left
    for (cx, cy, L, t, op, r) in [(40, 34, 30, 6, .45, -4), (52, 42, 44, 8, .75, -2), (38, 51, 34, 7, .85, -3), (62, 50, 22, 5, .5, 2)]:
        body.append(dab(cx, cy, L, t, LILAC, op, r))
    # a celadon drift through the middle
    for (cx, cy, L, t, op, r) in [(76, 60, 50, 9, .9, 2), (52, 66, 30, 6, .6, -2), (92, 70, 30, 6, .55, 3)]:
        body.append(dab(cx, cy, L, t, CELADON, op, r))
    # rose and apricot, lower, warmer light
    for (cx, cy, L, t, op, r, c) in [(46, 78, 36, 8, .85, -2, ROSE), (70, 86, 26, 6, .6, 2, ROSE), (84, 94, 34, 7, .8, 2, APRICOT), (56, 100, 24, 5, .5, -3, APRICOT)]:
        body.append(dab(cx, cy, L, t, c, op, r))
    # pale sky glints
    for (cx, cy, L, t, op, r) in [(70, 26, 22, 4, .5, -3), (34, 92, 18, 4, .4, -2), (98, 46, 18, 4, .4, 3)]:
        body.append(dab(cx, cy, L, t, "#EAF0F4", op, r))
    body.append('</g>')
    return body

# ---------------------------------------------------------------- B · Haze (dawn over water)
def icon_b(small=False):
    body = [f'<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="#F3E6DA"/><stop offset=".38" stop-color="#D9CBDA"/>'
            f'<stop offset=".62" stop-color="{POND_SOFT}"/><stop offset="1" stop-color="{POND}"/></linearGradient>{FILTERS}</defs>',
            '<circle cx="64" cy="64" r="62" fill="url(#g)"/>']
    if small:
        body += [dab(64, 64, 72, 18, CELADON, 1, 0)]
        return body
    body += ['<g filter="url(#haze)">',
             dab(60, 44, 90, 14, ROSE, .35, 0), dab(70, 60, 100, 12, LILAC, .35, 0),
             '</g>', '<g filter="url(#soft)">',
             dab(58, 66, 48, 8, CELADON, .9, -1), dab(84, 76, 30, 6, CELADON, .55, 2),
             dab(44, 86, 28, 6, LILAC, .6, -2), dab(76, 98, 26, 5, ROSE, .5, 2),
             '</g>']
    return body

# ---------------------------------------------------------------- C · Waterline (reflection)
def icon_c(small=False):
    body = [f'<defs><clipPath id="c"><circle cx="64" cy="64" r="62"/></clipPath>'
            f'<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6EEE3"/><stop offset="1" stop-color="#EBDCCF"/></linearGradient>'
            f'<linearGradient id="water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9DBBD1"/><stop offset=".25" stop-color="{POND_SOFT}"/><stop offset="1" stop-color="{POND}"/></linearGradient>'
            f'{FILTERS}</defs>',
            '<g clip-path="url(#c)">',
            '<rect x="0" y="0" width="128" height="128" fill="url(#sky)"/>',
            '<rect x="0" y="52" width="128" height="76" fill="url(#water)"/>']
    if small:
        body += [dab(50, 52, 62, 17, CELADON, 1, -1), dab(82, 78, 54, 16, LILAC, 1, 1), '</g>']
        return body
    body += ['<g filter="url(#haze)">', dab(64, 52, 140, 10, "#C9D6DF", .6, 0), '</g>',   # soft horizon
             '<g filter="url(#soft)">',
             dab(82, 34, 30, 6, ROSE, .75, 2),            # a touch in the sky
             dab(44, 51, 44, 8, CELADON, .95, -1),        # across the line: the pad / the caught thing
             dab(78, 64, 44, 8, LILAC, .85, 2),           # reflections, loosening downward
             dab(46, 76, 34, 7, CELADON, .6, -2),
             dab(84, 86, 28, 6, ROSE, .55, 2),
             dab(56, 98, 26, 5, LILAC, .45, -2),
             dab(30, 60, 18, 4, "#EEF2F5", .5, -2),       # glints
             dab(98, 48, 16, 4, "#EEF2F5", .5, 2),
             '</g>', '</g>']
    return body

def svg(body):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n  ' + '\n  '.join(body) + '\n</svg>\n'

CURRENT = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <circle cx="64" cy="64" r="60" fill="#FAF7F2"/>
  <circle cx="64" cy="64" r="58.5" fill="none" stroke="#4E7FA2" stroke-opacity=".35" stroke-width="3"/>
  <path d="M22 100q42-13 84 0" fill="none" stroke="#4E7FA2" stroke-width="5" stroke-linecap="round"/>
  <path d="M34 112q30-9 60 0" fill="none" stroke="#4E7FA2" stroke-opacity=".5" stroke-width="4" stroke-linecap="round"/>
  <path d="M52.4 26A34 34 0 1 1 32 46.4L64 58Z" fill="#8FB8A3"/>
  <circle cx="92" cy="36" r="9" fill="#E3AFB4"/>
</svg>'''

icons = {
    "current": (CURRENT, CURRENT),
    "a-drift": (svg(icon_a()), svg(icon_a(True))),
    "b-haze": (svg(icon_b()), svg(icon_b(True))),
    "c-waterline": (svg(icon_c()), svg(icon_c(True))),
}
for name, (big, small) in icons.items():
    open(os.path.join(OUT, f"fluxcatch-{name}.svg"), "w").write(big)
    open(os.path.join(OUT, f"fluxcatch-{name}-16.svg"), "w").write(small)

def data(s):
    import base64
    return "data:image/svg+xml;base64," + base64.b64encode(s.encode()).decode()

def icon_row(label, note, big, small):
    sizes = [(128, big), (48, big), (32, big), (16, small)]
    cells = ""
    for bg, fg, cap in [("#FFFFFF", "#202124", "Chrome light toolbar"), ("#35363A", "#E8EAED", "Chrome dark toolbar"), (CREAM, "#2B2E4A", "Morning canvas"), (DUSK, "#EFE9E0", "Dusk canvas")]:
        imgs = "".join(f'<img src="{data(s)}" width="{w}" height="{w}" style="image-rendering:auto;margin-right:{14 if w>16 else 0}px;vertical-align:bottom">' for w, s in sizes)
        cells += f'<div class="cell" style="background:{bg};color:{fg}"><div class="imgs">{imgs}</div><div class="cap">{cap} · 128 / 48 / 32 / 16</div></div>'
    return f'<section><h2>{label}</h2><p class="note">{note}</p><div class="cells">{cells}</div></section>'

divider_css = """
.mock { width: 560px; padding: 24px 32px 28px; border-radius: 10px; font-family: 'Instrument Sans', 'DejaVu Sans', sans-serif; }
.mock.morning { background: #F4F0E9; color: #2B2E4A; --text2:#5A5F7E; --text3:#6B7090; --field:#ECE6DE; --rule: rgba(43,46,74,.22); }
.mock.dusk { background: #1C2140; color: #EFE9E0; --text2:#B9B6CC; --text3:#9EA3BF; --field:#252B4D; --rule: rgba(239,233,224,.18); }
.mock .title { font-size: 15px; font-weight: 600; margin: 0 0 10px; }
.mock .row { display:flex; justify-content:space-between; align-items:center; padding: 10px 0; font-size: 13px; }
.mock .row .l b { display:block; font-weight:500; } .mock .row .l span { color: var(--text2); font-size:12px; }
.mock .row .r { color: var(--text3); font-size: 12px; } .mock .row .field { background: var(--field); border-radius:6px; padding: 5px 12px; color: inherit; }
.mock hr { border: 0; height: 1px; margin: 28px 0 24px;
  background: linear-gradient(90deg, transparent 0, var(--rule) 10%, var(--rule) 90%, transparent 100%); }
"""

def mock(theme):
    return f"""<div class="mock {theme}">
  <p class="title">Speed</p>
  <div class="row"><div class="l"><b>Connections per large file</b><span>1 to 24, when the site allows it.</span></div><div class="r field">12</div></div>
  <div class="row"><div class="l"><b>Downloads at once</b><span>1 to 6. The rest wait their turn.</span></div><div class="r field">3</div></div>
  <hr>
  <p class="title">Finding media</p>
  <div class="row"><div class="l"><b>Ignore files smaller than</b><span>0 to 100,000. Skips icons and tiny clips.</span></div><div class="r field">512 KB</div></div>
  <div class="row"><div class="l"><b>Ignored sites</b><span>One site per line. FluxCatch won't look for media there.</span></div></div>
  <hr>
  <p class="title">Privacy &amp; network</p>
  <div class="row"><div class="l"><b>Find more qualities on Bilibili</b><span>Uses your Bilibili sign-in on that page. Nothing is uploaded.</span></div><div class="r">On</div></div>
</div>"""

html = f"""<!doctype html><html><head><meta charset="utf-8"><style>
body {{ margin: 0; padding: 32px 40px; background: #FAF7F2; color: #2B2E4A; font-family: 'DejaVu Sans', sans-serif; width: 1240px; }}
h1 {{ font-size: 22px; margin: 0 0 6px; }} h2 {{ font-size: 16px; margin: 28px 0 4px; }} .note {{ margin: 0 0 10px; color: #5A5F7E; font-size: 13px; }}
.cells {{ display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }}
.cell {{ padding: 14px 16px 10px; border-radius: 8px; }} .cap {{ font-size: 11px; opacity: .7; margin-top: 8px; }}
.imgs {{ height: 128px; display:flex; align-items:flex-end; }}
.two {{ display:flex; gap: 20px; margin-top: 10px; }}
{divider_css}
</style></head><body>
<h1>FluxCatch · icon candidates and the Settings section divider · 2026-10-24</h1>
<p class="note">All icons are original vector marks built from the Morning tokens; no painting is referenced. Each is shown with its dedicated 16 px variant.</p>
{icon_row("0 · Current mark (for comparison)", "Lily pad with a notch, two ripples, blossom, on a cream disc. The notch reads as a bitten disc; the ring and ripples collapse at 16 px.", *icons["current"])}
{icon_row("A · Drift", "The pond layer in miniature: three drifts of soft dabs (lilac, celadon, rose and apricot) on morning-lit water, with a few pale glints. The mark is the product's one atmospheric device, so brand and interface share a vocabulary. 16 px: three dabs.", *icons["a-drift"])}
{icon_row("B · Haze", "Dawn over water as one tonal field: cream to lilac to pond, two bands of mist, one celadon touch. The quietest of the three; reads as light rather than as an object. 16 px: the gradient disc and one touch.", *icons["b-haze"])}
{icon_row("C · Waterline", "Morning sky above, pond below, a hazed horizon; one celadon touch sits on the line and its colours loosen downward as reflections. The most Monet of the three. 16 px: the two-tone disc and two touches.", *icons["c-waterline"])}
<section><h2>Settings · section divider</h2>
<p class="note">A 1 px hairline in a translucent cool tint that fades out over the last 10% at each end, 28 px above and 24 px below. It sits between sections only, never before the first or after the last. Morning rgba(43,46,74,.22); Dusk rgba(239,233,224,.18).</p>
<div class="two">{mock("morning")}{mock("dusk")}</div></section>
</body></html>"""
open(os.path.join(OUT, "sheet.html"), "w").write(html)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1320, "height": 900}, device_scale_factor=2)
        await pg.goto("file://" + os.path.join(OUT, "sheet.html"))
        await pg.screenshot(path=os.path.join(OUT, "icon-and-divider-sheet.png"), full_page=True)
        # Also rasterise each candidate at 128 and 16 for the record
        for name, (big, small) in icons.items():
            for size, s in ((128, big), (16, small)):
                await pg.set_content(f'<body style="margin:0;background:transparent"><img src="{data(s)}" width="{size}" height="{size}"></body>')
                el = await pg.query_selector("img")
                await el.screenshot(path=os.path.join(OUT, f"fluxcatch-{name}-{size}.png"), omit_background=True)
        await b.close()

asyncio.run(main())
print("ok")
