// Pixel measurements for scripts/design-audit.mjs (design review v3 §3.1 and
// §3.6), pure functions over decoded PNG pixels so they can be unit-tested.
//
//  pondMetrics   the layer against the same capture with the layer hidden, in
//                OKLCH: chroma coverage (ΔC > 0.015 vs the canvas) and the 95th
//                percentile of |ΔL| over the measured region. The region is the
//                page's margins outside the content column on full pages, else
//                the whole frame; rects that update by themselves are skipped.
//  pondVerdict   the §3.1 acceptance for one screen: on a judged screen the
//                coverage must sit in the band and p95 |ΔL| under the theme's
//                limit; on every screen no pond pixel may lie under text.
//  headerStrip   §3.6: with the layer hidden, the header outside its content
//                box must be the canvas colour, pixel for pixel, at scroll 0.
import { rgbToOklch } from "../../extension/ui/v2/pond.js";

// The floor is 3% as seen in the page (the mask's feather included); the
// review set it on 2026-10-24, from 4%, on the audit's first measurements.
export const POND_BAND = Object.freeze({ coverageMin: 3, coverageMax: 12, p95: { morning: 0.03, dusk: 0.05 }, chromaStep: 0.015 });
// A 960-wide page has 40 px gutters, inside the layer's 64 px feather, so its
// margins cannot carry the band by construction: they are reported, not judged.
export const JUDGED_MARGIN_MIN = 48;

const oklabCache = new Map();
function oklab(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let value = oklabCache.get(key);
  if (!value) {
    const { L, C, h } = rgbToOklch(r, g, b);
    const rad = (h * Math.PI) / 180;
    value = { L, a: C * Math.cos(rad), b: C * Math.sin(rad) };
    if (oklabCache.size < 200_000) oklabCache.set(key, value);
  }
  return value;
}

/**
 * with / without: { width, height, pixels } (RGBA, device px). region:
 *   { column: { left, right } | null, skip: [{ l, t, r, b }], right: cssWidth }
 * in CSS px, scaled by dpr here. Returns null when the two captures differ in size.
 */
export function pondMetrics(withPond, withoutPond, region = {}, { dpr = 2, step = 2 } = {}) {
  const a = withPond;
  const b = withoutPond;
  if (!a || !b || a.width !== b.width || a.height !== b.height) return null;
  const { column = null, skip = [], right = 0 } = region;
  const skipLeft = column ? Math.floor(column.left * dpr) : Infinity;
  const skipRight = column ? Math.ceil(column.right * dpr) : -Infinity;
  const skipRects = skip.map((r) => ({ l: Math.floor(r.l * dpr), t: Math.floor(r.t * dpr), r: Math.ceil(r.r * dpr), b: Math.ceil(r.b * dpr) }));
  const contentRight = right ? Math.floor(right * dpr) : Infinity;
  let sampled = 0;
  let covered = 0;
  let changed = 0;
  let sumDl = 0;
  let sumDc = 0;
  const dls = [];
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      if (x >= skipLeft && x <= skipRight) continue;
      if (x >= contentRight) continue;
      if (skipRects.some((r) => x >= r.l && x <= r.r && y >= r.t && y <= r.b)) continue;
      const i = (y * a.width + x) * 4;
      sampled += 1;
      if (a.pixels[i] === b.pixels[i] && a.pixels[i + 1] === b.pixels[i + 1] && a.pixels[i + 2] === b.pixels[i + 2]) { dls.push(0); continue; }
      const la = oklab(a.pixels[i], a.pixels[i + 1], a.pixels[i + 2]);
      const lb = oklab(b.pixels[i], b.pixels[i + 1], b.pixels[i + 2]);
      const dl = Math.abs(la.L - lb.L);
      const dc = Math.hypot(la.a - lb.a, la.b - lb.b);
      changed += 1;
      if (dc > POND_BAND.chromaStep) covered += 1;
      sumDl += dl;
      sumDc += dc;
      dls.push(dl);
    }
  }
  dls.sort((p, q) => p - q);
  const pct = (p) => (dls.length ? dls[Math.min(dls.length - 1, Math.floor(p * dls.length))] : 0);
  const round = (v, places) => Math.round(v * 10 ** places) / 10 ** places;
  return {
    region: column ? "margins" : "frame",
    sampled,
    coverage: round((covered / Math.max(1, sampled)) * 100, 1),
    footprint: round((changed / Math.max(1, sampled)) * 100, 1),
    p95DeltaL: round(pct(0.95), 3),
    meanDeltaL: round(sampled ? sumDl / sampled : 0, 4),
    meanDeltaC: round(changed ? sumDc / changed : 0, 4)
  };
}

/** The §3.1 verdict. underText: text nodes with pond alpha under them. */
export function pondVerdict(metrics, { theme = "morning", judged = false, underText = 0 } = {}) {
  const reasons = [];
  if (judged && metrics) {
    if (metrics.coverage < POND_BAND.coverageMin) reasons.push(`coverage ${metrics.coverage}% under ${POND_BAND.coverageMin}%`);
    if (metrics.coverage > POND_BAND.coverageMax) reasons.push(`coverage ${metrics.coverage}% over ${POND_BAND.coverageMax}%`);
    const limit = POND_BAND.p95[theme] ?? POND_BAND.p95.morning;
    if (metrics.p95DeltaL > limit) reasons.push(`p95 |ΔL| ${metrics.p95DeltaL} over ${limit}`);
  }
  if (underText > 0) reasons.push(`pond under ${underText} text node${underText === 1 ? "" : "s"}`);
  return { judged, pass: reasons.length === 0, reasons };
}

/**
 * The header's rect minus its content (the rects of its rendered children),
 * in the capture without the layer: every sampled pixel must equal the canvas
 * colour (tolerance 2/255 per channel). Rects are { x, y, width, height } in CSS px.
 */
export function headerStrip(withoutPond, { header, content = [], canvas, dpr = 2, right = 0, tolerance = 2 } = {}) {
  if (!withoutPond || !header || !canvas) return null;
  const img = withoutPond;
  const x0 = Math.max(0, Math.floor(header.x * dpr));
  const y0 = Math.max(0, Math.floor(header.y * dpr));
  const x1 = Math.min(img.width, Math.ceil((header.x + header.width) * dpr), right ? Math.floor(right * dpr) : img.width);
  const y1 = Math.min(img.height, Math.ceil((header.y + header.height) * dpr));
  const holes = (content || []).map((c) => ({ x0: Math.floor(c.x * dpr), y0: Math.floor(c.y * dpr), x1: Math.ceil((c.x + c.width) * dpr), y1: Math.ceil((c.y + c.height) * dpr) }));
  let sampled = 0;
  let stray = 0;
  let worst = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (holes.some((h) => x >= h.x0 && x < h.x1 && y >= h.y0 && y < h.y1)) continue;
      const i = (y * img.width + x) * 4;
      sampled += 1;
      const d = Math.max(Math.abs(img.pixels[i] - canvas.r), Math.abs(img.pixels[i + 1] - canvas.g), Math.abs(img.pixels[i + 2] - canvas.b));
      if (d > tolerance) { stray += 1; worst = Math.max(worst, d); }
    }
  }
  return { sampled, stray, worst };
}

/** "rgb(a, b, c)" or "rgba(a, b, c, d)" as { r, g, b, a }; null otherwise. */
export function parseRgb(text) {
  const match = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(text || "");
  if (!match) return null;
  return { r: Math.round(Number(match[1])), g: Math.round(Number(match[2])), b: Math.round(Number(match[3])), a: match[4] === undefined ? 1 : Number(match[4]) };
}
