// Pond layer (design review v3 §3.1, principle P4): broken colour that lives in
// the background only. The port of docs/design-review/pond-reference/
// pond_layer.py, render_pond(spec="v3"): a handful of horizontal drifts with
// one hue family each, touches at three scales placed by rejection sampling
// against the drift density, Morning touches below the ground's lightness and
// Dusk touches above the water's, alpha 0 under every content box with a
// 64 px feather. The script is the specification; the parameters here are its
// parameters, not a reinterpretation. Procedural; no image asset ships.
// Seeded once per install, so the same seed gives the same layer on every
// surface and across sessions.

const SEED_KEY = "fluxcatch.pondSeed.v1";

// ---------- PRNG: mulberry32, the same sequence as the reference's Rng ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** uniform(lo, hi) and normal(mu, sigma) draw in the reference's order (Box-Muller, two uniforms). */
function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    normal(mu = 0, sigma = 1) {
      const u1 = Math.max(next(), 1e-12);
      const u2 = next();
      return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
  };
}

// ---------- OKLCH and sRGB, with chroma clamped into the gamut ----------
function oklabToLinear(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
}
const toSrgb = (c) => {
  const v = Math.min(1, Math.max(0, c));
  return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255);
};
const toLinear = (v8) => {
  const v = v8 / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const inGamut = (lin) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export function oklchToRgb(L, C, H) {
  const rad = (H * Math.PI) / 180;
  let chroma = C;
  let lin = oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i += 1) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(L, mid * Math.cos(rad), mid * Math.sin(rad)))) lo = mid; else hi = mid;
    }
    chroma = lo;
    lin = oklabToLinear(L, chroma * Math.cos(rad), chroma * Math.sin(rad));
  }
  return { r: toSrgb(lin[0]), g: toSrgb(lin[1]), b: toSrgb(lin[2]), chroma };
}

/** sRGB 8-bit to OKLCH { L, C, h } (h in degrees, 0 to 360). */
export function rgbToOklch(r8, g8, b8) {
  const r = toLinear(r8);
  const g = toLinear(g8);
  const b = toLinear(b8);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { L, C: Math.hypot(a, bb), h: ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 };
}

/** "#rrggbb" or "rgb(r, g, b)" (what getComputedStyle returns) as [r, g, b], or null. */
export function parseCssColor(text) {
  const value = String(text || "").trim();
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => Number.parseInt(hex[1].slice(i, i + 2), 16));
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((n) => Math.round(Number(n)));
  return null;
}

// ======================================================================
// The plan: pond_layer.py render_pond(spec="v3"), draw for draw
// ======================================================================

const REFERENCE_AREA = 1280 * 900;
const SIZE_BUCKET = 128;
export const MASK_FEATHER = 64;
// Hue families in order round the drift field, so neighbours in the list are
// neighbours on the hue circle and a drift never crosses red: celadon,
// pond-soft, lilac, rose, apricot (OKLCH degrees measured from the Morning
// tokens; tokens.css --pond-families carries the same numbers).
const FAMILY_HUES = Object.freeze([162.5, 241.8, 295.6, 12.1, 56.6]);
// Touches per 1280 × 900 at three scales: count, length, width, alpha.
const SCALES = Object.freeze([
  { count: 420, length: [30, 84], width: [6, 11], alpha: [0.1, 0.24] },     // atmosphere
  { count: 2600, length: [10, 30], width: [3, 6.5], alpha: [0.22, 0.48] },  // body of the water
  { count: 3800, length: [4, 11], width: [2, 3.4], alpha: [0.26, 0.55] }    // fine touches
]);
// Lightness offset from the canvas (mean, σ) and chroma range, per scale.
// Morning touches sit below the cream ground; Dusk touches above the dark water.
const LIGHTNESS = Object.freeze({
  morning: { dl: [[-0.03, 0.012], [-0.06, 0.02], [-0.075, 0.025]], chroma: [[0.022, 0.04], [0.028, 0.052], [0.03, 0.058]] },
  dusk: { dl: [[0.07, 0.018], [0.135, 0.028], [0.165, 0.032]], chroma: [[0.03, 0.05], [0.04, 0.07], [0.045, 0.08]] }
});
// The soft ellipse: full inside d ≤ 0.55, then ((1 − d) / 0.45)^0.75 to the rim.
const FEATHER = 0.55;
const FEATHER_STOPS = Object.freeze([0, FEATHER, 0.62, 0.7, 0.78, 0.86, 0.93, 0.97, 1].map((t) => [t, Math.min(1, (1 - t) / (1 - FEATHER)) ** 0.75]));

// ---------- value noise as the reference makes it: a random lattice, bicubic upsample ----------
// Pillow's bicubic (a = −0.5, support 2), one axis at a time, 8-bit between passes.
function cubic(x) {
  const t = Math.abs(x);
  if (t < 1) return (1.5 * t - 2.5) * t * t + 1;
  if (t < 2) return ((-0.5 * t + 2.5) * t - 4) * t + 2;
  return 0;
}
function resampleCoefficients(inSize, outSize) {
  const scale = inSize / outSize;
  const support = 2 * Math.max(1, scale);
  const taps = [];
  for (let out = 0; out < outSize; out += 1) {
    const center = (out + 0.5) * scale;
    const min = Math.max(0, Math.trunc(center - support + 0.5));
    const max = Math.min(inSize, Math.trunc(center + support + 0.5));
    const k = [];
    let sum = 0;
    for (let i = min; i < max; i += 1) {
      const w = cubic((i - center + 0.5) / Math.max(1, scale));
      k.push(w);
      sum += w;
    }
    taps.push({ min, k: sum ? k.map((w) => w / sum) : k });
  }
  return taps;
}
const clip8 = (v) => Math.min(255, Math.max(0, Math.round(v)));
function valueNoise(rng, w, h, cellsX, cellsY) {
  const cols = cellsX + 1;
  const rows = cellsY + 1;
  const lattice = new Uint8Array(rows * cols);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < cols; x += 1) lattice[y * cols + x] = Math.floor(rng.next() * 255);
  const horizontal = new Uint8Array(rows * w);
  const kx = resampleCoefficients(cols, w);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const { min, k } = kx[x];
      let sum = 0;
      for (let i = 0; i < k.length; i += 1) sum += lattice[y * cols + min + i] * k[i];
      horizontal[y * w + x] = clip8(sum);
    }
  }
  const out = new Float32Array(w * h);
  const ky = resampleCoefficients(rows, h);
  for (let y = 0; y < h; y += 1) {
    const { min, k } = ky[y];
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let i = 0; i < k.length; i += 1) sum += horizontal[(min + i) * w + x] * k[i];
      out[y * w + x] = clip8(sum) / 255;
    }
  }
  return out;
}
function fbm(rng, w, h, [baseX, baseY], octaves = 3, gain = 0.5) {
  const total = new Float32Array(w * h);
  let amp = 1;
  let norm = 0;
  let cx = baseX;
  let cy = baseY;
  for (let o = 0; o < octaves; o += 1) {
    const noise = valueNoise(rng, w, h, cx, cy);
    for (let i = 0; i < total.length; i += 1) total[i] += amp * noise[i];
    norm += amp;
    amp *= gain;
    cx *= 2;
    cy *= 2;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < total.length; i += 1) {
    total[i] /= norm;
    if (total[i] < lo) lo = total[i];
    if (total[i] > hi) hi = total[i];
  }
  const span = Math.max(hi - lo, 1e-6);
  for (let i = 0; i < total.length; i += 1) total[i] = (total[i] - lo) / span;
  return total;
}

const mod360 = (h) => ((h % 360) + 360) % 360;

/**
 * Plan the layer for a canvas of width × height CSS px. Pure and
 * deterministic for a seed, so it can be tested without a canvas; the draw
 * order of the PRNG follows the reference script exactly.
 * theme: "morning" | "dusk"; canvasL: the canvas's OKLCH lightness.
 * Returns { width, height, drifts, touches: [{ x, y, length, width, angle (deg), L, C, hue, rgb, alpha, scale }] }.
 */
export function planPond({ seed, width, height, theme = "morning", canvasL, families = FAMILY_HUES }) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const rng = makeRng(seed);
  const Lc = Number.isFinite(canvasL) ? canvasL : theme === "dusk" ? 0.25 : 0.955;
  const areaScale = (w * h) / REFERENCE_AREA;

  // Large-scale structure first: horizontal drifts, each with a hue position
  // along the family list. Density gathers inside them and thins to open canvas.
  const drifts = [];
  const count = Math.max(3, Math.round(6 * Math.sqrt(areaScale)));
  for (let i = 0; i < count; i += 1) {
    const cx = rng.uniform(-0.1 * w, 1.1 * w);
    const cy = rng.uniform(-0.05 * h, 1.05 * h);
    const sx = rng.uniform(0.12 * w, 0.38 * w);
    const sy = rng.uniform(0.04 * h, 0.13 * h);
    const amp = rng.uniform(0.55, 1);
    const hue = rng.next();
    drifts.push({ cx, cy, sx, sy, amp, hue });
  }
  const band = fbm(rng, w, h, [1, 9], 2); // fine horizontal ripples in density
  const fieldAt = (x, y) => {
    let density = 0;
    let hueAcc = 0;
    let weight = 0;
    for (const d of drifts) {
      const g = d.amp * Math.exp(-(((x - d.cx) ** 2) / (2 * d.sx * d.sx) + ((y - d.cy) ** 2) / (2 * d.sy * d.sy)));
      density += g;
      hueAcc += g * d.hue;
      weight += g;
    }
    density = Math.min(1, density);
    return {
      density: (0.012 + 0.988 * density ** 2.2) * (0.6 + 0.4 * band[y * w + x]),
      hue: weight > 1e-4 ? hueAcc / weight : 0.5
    };
  };
  const pickHue = (v) => {
    const pos = v * (families.length - 1);
    const i = Math.min(Math.floor(pos), families.length - 2);
    const t = pos - i;
    const h0 = families[i];
    const h1 = families[i + 1];
    const d = ((h1 - h0 + 540) % 360) - 180;
    return mod360(h0 + d * t + rng.normal(0, 9));
  };

  const { dl, chroma } = LIGHTNESS[theme === "dusk" ? "dusk" : "morning"];
  const touches = [];
  SCALES.forEach((scale, k) => {
    const target = Math.floor(scale.count * areaScale);
    let placed = 0;
    let attempts = 0;
    while (placed < target && attempts < target * 8) {
      attempts += 1;
      const x = rng.uniform(0, w);
      const y = rng.uniform(0, h);
      const field = fieldAt(Math.floor(x) % w, Math.floor(y) % h);
      if (rng.next() > field.density) continue;
      placed += 1;
      const length = rng.uniform(scale.length[0], scale.length[1]);
      const thickness = rng.uniform(scale.width[0], scale.width[1]);
      const angle = rng.normal(0, 7);
      const L = Math.min(0.995, Math.max(0.05, Lc + rng.normal(dl[k][0], dl[k][1])));
      const C = rng.uniform(chroma[k][0], chroma[k][1]);
      const hue = pickHue(field.hue);
      const { r, g, b, chroma: clamped } = oklchToRgb(L, C, hue);
      const alpha = rng.uniform(scale.alpha[0], scale.alpha[1]);
      touches.push({ x, y, length, width: thickness, angle, L, C: clamped, hue, rgb: [r, g, b], alpha, scale: k });
    }
  });
  return { width: w, height: h, drifts, touches };
}

/** Draw a plan to an OffscreenCanvas at `dpr` and hand back its ImageBitmap. */
export function renderPondBitmap(plan, dpr = 1) {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(plan.width * dpr)), Math.max(1, Math.round(plan.height * dpr)));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  for (const touch of plan.touches) {
    ctx.save();
    ctx.translate(touch.x, touch.y);
    ctx.rotate((touch.angle * Math.PI) / 180);
    ctx.scale(touch.length / 2, touch.width / 2);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [stop, a] of FEATHER_STOPS) gradient.addColorStop(stop, `rgba(${touch.rgb[0]}, ${touch.rgb[1]}, ${touch.rgb[2]}, ${a})`);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = touch.alpha;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  return canvas.transferToImageBitmap();
}

// ======================================================================
// The content mask: column_mask for any number of boxes
// ======================================================================

/**
 * The mask's factor at a point: 0 inside a box, rising linearly to 1 over
 * `feather` px outside its edge (distance to the box, so corners are rounded);
 * where feathers overlap the factors multiply. Boxes and the point share one
 * unit (CSS px, or device px with the boxes scaled). Exported for tests; the
 * drawn mask (maskContent) is this function, painted.
 */
export function maskFactor(boxes, x, y, feather = MASK_FEATHER) {
  let factor = 1;
  for (const box of boxes || []) {
    if (!(box.width > 0 && box.height > 0)) continue;
    const dx = Math.max(box.x - x, x - (box.x + box.width), 0);
    const dy = Math.max(box.y - y, y - (box.y + box.height), 0);
    factor *= Math.min(1, Math.hypot(dx, dy) / feather);
    if (factor === 0) break;
  }
  return factor;
}

/**
 * Paint the content mask into a 2D context (device px): every box is cut out
 * fully, and its four sides and four corners are cut out by a gradient from
 * 1 at the edge to 0 at `feather` CSS px, which is column_mask's
 * clip(d / feather). Compositing with destination-out multiplies the factors
 * of overlapping feathers, as maskFactor() does.
 */
export function maskContent(ctx, boxes, { dpr = 1, feather = MASK_FEATHER } = {}) {
  const reach = feather * dpr;
  if (!(reach > 0)) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  // Only the alpha of a destination-out fill matters, so the two stops are
  // the context's own default fill (opaque) and transparent: no colour is
  // chosen here.
  const ink = typeof ctx.fillStyle === "string" ? ctx.fillStyle : "transparent";
  const cut = (x, y, w, h, gradient) => {
    ctx.fillStyle = gradient || ink;
    ctx.fillRect(x, y, w, h);
  };
  const fade = (gradient) => {
    gradient.addColorStop(0, ink);
    gradient.addColorStop(1, "transparent");
    return gradient;
  };
  const linear = (x0, y0, x1, y1) => fade(ctx.createLinearGradient(x0, y0, x1, y1));
  const radial = (x, y) => fade(ctx.createRadialGradient(x, y, 0, x, y, reach));
  for (const box of boxes || []) {
    if (!(box.width > 0 && box.height > 0)) continue;
    const x0 = box.x * dpr;
    const y0 = box.y * dpr;
    const w = box.width * dpr;
    const h = box.height * dpr;
    const x1 = x0 + w;
    const y1 = y0 + h;
    cut(x0, y0, w, h);
    cut(x0 - reach, y0, reach, h, linear(x0, 0, x0 - reach, 0));
    cut(x1, y0, reach, h, linear(x1, 0, x1 + reach, 0));
    cut(x0, y0 - reach, w, reach, linear(0, y0, 0, y0 - reach));
    cut(x0, y1, w, reach, linear(0, y1, 0, y1 + reach));
    cut(x0 - reach, y0 - reach, reach, reach, radial(x0, y0));
    cut(x1, y0 - reach, reach, reach, radial(x1, y0));
    cut(x0 - reach, y1, reach, reach, radial(x0, y1));
    cut(x1, y1, reach, reach, radial(x1, y1));
  }
  ctx.restore();
}

// Content every page masks whatever else it lists: an open dialog, an open
// menu or confirm, and the toasts.
const SHARED_BOXES = ["dialog[open]", ".menu-layer:not([hidden]) > .menu", ".toast-region > .toast"];

/**
 * The boxes of the elements `selectors` match that are rendered right now,
 * in CSS px of the viewport, plus the shared overlays. A status line with no
 * text has no box. Pages pass this to mountPondLayer as getContentBoxes.
 */
export function contentBoxes(selectors, root = globalThis.document) {
  const boxes = [];
  if (!root?.querySelectorAll) return boxes;
  for (const node of root.querySelectorAll([...selectors, ...SHARED_BOXES].join(", "))) {
    if (node.hidden || !node.getClientRects?.().length) continue;
    if (node.classList?.contains("status-line") && !node.textContent.trim()) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) boxes.push({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
  }
  return boxes;
}

// ======================================================================
// Mounting
// ======================================================================

/** One layer per install: plans and bitmaps cached per theme and viewport bucket. */
export class PondLayer {
  constructor({ seed, families = FAMILY_HUES } = {}) {
    this.seed = seed >>> 0;
    this.families = families;
    this.plans = new Map();
    this.bitmaps = new Map();
  }

  static bucket(size) {
    return Math.max(SIZE_BUCKET, Math.ceil(size / SIZE_BUCKET) * SIZE_BUCKET);
  }

  plan(theme, width, height, canvasL) {
    const w = PondLayer.bucket(width);
    const h = PondLayer.bucket(height);
    const key = `${theme}:${w}x${h}:${Number(canvasL).toFixed(3)}`;
    if (!this.plans.has(key)) this.plans.set(key, planPond({ seed: this.seed, width: w, height: h, theme, canvasL, families: this.families }));
    return this.plans.get(key);
  }

  bitmap(theme, width, height, canvasL, dpr = 1) {
    const plan = this.plan(theme, width, height, canvasL);
    const key = `${theme}:${plan.width}x${plan.height}:${Number(canvasL).toFixed(3)}@${dpr}`;
    if (!this.bitmaps.has(key)) this.bitmaps.set(key, renderPondBitmap(plan, dpr));
    return this.bitmaps.get(key);
  }
}

async function installSeed() {
  try {
    const store = globalThis.chrome?.storage?.local;
    if (store?.get) {
      const stored = await store.get(SEED_KEY);
      const value = Number(stored?.[SEED_KEY]);
      if (Number.isInteger(value) && value > 0) return value;
      const fresh = (crypto.getRandomValues(new Uint32Array(1))[0] || 1) >>> 0;
      await store.set({ [SEED_KEY]: fresh });
      return fresh;
    }
  } catch { /* fall through */ }
  return 0x5eed1e5;
}

/** The theme in force and its canvas lightness, read from the tokens. */
function readPondTheme() {
  const style = getComputedStyle(document.documentElement);
  const dark = style.colorScheme === "dark" || (!style.colorScheme && matchMedia("(prefers-color-scheme: dark)").matches);
  const rgb = parseCssColor(style.getPropertyValue("--canvas"));
  const canvasL = rgb ? rgbToOklch(...rgb).L : dark ? 0.25 : 0.955;
  const families = style.getPropertyValue("--pond-families").trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return { name: dark ? "dusk" : "morning", canvasL, families: families.length === 5 ? families : FAMILY_HUES };
}

/**
 * Mount the layer behind a page.
 * element: `div.pond[data-pond]`, first in <body>; it gets a <canvas> child.
 * getContentBoxes(): [{ x, y, width, height }] of every content box (header,
 * title, controls, each text block, lists, forms, dialogs) in CSS px of the
 * viewport; the layer is alpha 0 under them and feathered over 64 px around
 * them (contentBoxes(selectors) builds the list from the page).
 * isShown(): whether the layer shows at all right now (default: always).
 * The plan and its bitmap are cached per theme and 128 px viewport bucket and
 * drawn again on resize (300 ms debounce) and theme change; the mask alone is
 * drawn again on scroll (once per frame) and on refresh() (debounced), which a
 * page calls after a render that moved its boxes.
 * data-pond-state reads "painting" while a draw is pending and "ready" once
 * the current one is on screen, so tools can wait for a settled background.
 */
export async function mountPondLayer({ element, getContentBoxes, isShown } = {}) {
  const host = element || document.querySelector("[data-pond]");
  if (!host) return null;
  const seed = await installSeed();
  const canvas = document.createElement("canvas");
  host.replaceChildren(canvas);
  let layer = null;
  let bitmap = null;
  let dpr = 1;
  let timer = 0;
  let generation = 0;
  let frame = 0;
  const paint = () => {
    const ctx = canvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!bitmap) return;
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(bitmap, 0, 0);
    maskContent(ctx, getContentBoxes?.() || [], { dpr });
  };
  const draw = async () => {
    const run = ++generation;
    host.dataset.pondState = "painting";
    // Let the page's own layout settle before the boxes are measured (a hidden
    // tab may never paint a frame, so a short timer stands in for it).
    await new Promise((resolve) => { requestAnimationFrame(resolve); setTimeout(resolve, 50); });
    if (run !== generation) return;
    const shown = isShown ? Boolean(isShown()) : true;
    host.hidden = !shown;
    if (shown) {
      const width = window.innerWidth;
      const height = window.innerHeight;
      dpr = Math.min(3, globalThis.devicePixelRatio || 1);
      const theme = readPondTheme();
      if (!layer || layer.families.join() !== theme.families.join()) layer = new PondLayer({ seed, families: theme.families });
      bitmap = layer.bitmap(theme.name, width, height, theme.canvasL, dpr);
      if (run !== generation) return;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      paint();
    }
    host.dataset.pondState = "ready";
  };
  const schedule = () => { host.dataset.pondState = "painting"; clearTimeout(timer); timer = setTimeout(() => void draw(), 300); };
  // Scrolling moves the boxes over a fixed layer: the mask follows, once per frame.
  const remask = () => {
    if (frame || host.hidden || !bitmap) return;
    frame = requestAnimationFrame(() => { frame = 0; paint(); });
  };
  window.addEventListener("resize", schedule);
  document.addEventListener("scroll", remask, { capture: true, passive: true });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => void draw());
  await draw();
  return { refresh: schedule, layer: () => layer };
}
