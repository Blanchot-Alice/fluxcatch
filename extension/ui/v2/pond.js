// Pond layer (design review §6.10, principle P4): broken colour that lives in
// the background only. 150–250 short horizontal touches, each an ellipse
// 6–18 × 2–5 px angled 0° ± 12°, placed over a low-frequency noise field.
// Every touch sits at the canvas's own OKLCH lightness (± 0.01), so it carries
// hue but no value: visible in colour, gone in greyscale. Procedural; no image
// asset ships. Seeded once per install, so it is stable across sessions.

const SEED_KEY = "fluxcatch.pondSeed.v1";

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

// ---------- OKLCH → sRGB with chroma clamped into the gamut ----------
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

// ---------- low-frequency value noise ----------
function noiseField(random, cell) {
  const grid = new Map();
  const at = (x, y) => {
    const key = `${x},${y}`;
    if (!grid.has(key)) grid.set(key, random());
    return grid.get(key);
  };
  const smooth = (t) => t * t * (3 - 2 * t);
  return (px, py) => {
    const x = px / cell;
    const y = py / cell;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const sx = smooth(x - x0);
    const sy = smooth(y - y0);
    const top = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
    const bottom = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
    return top * (1 - sy) + bottom * sy;
  };
}

/**
 * Plan the touches for a viewport. Pure and deterministic for a given seed,
 * so it can be tested without a canvas.
 * zones: [{ x, y, width, height }] where touches may land (default: everything).
 */
export function planTouches({ seed, width, height, lightness, hues, opacityMin = 0.35, opacityMax = 0.55, zones }) {
  const random = mulberry32(seed);
  const noise = noiseField(mulberry32(seed ^ 0x9e3779b9), 220);
  const areas = (zones?.length ? zones : [{ x: 0, y: 0, width, height }]).filter((z) => z.width > 4 && z.height > 4);
  const totalArea = areas.reduce((sum, z) => sum + z.width * z.height, 0);
  const count = 150 + Math.floor(random() * 101);
  const touches = [];
  let guard = 0;
  while (touches.length < count && guard < count * 40 && totalArea > 0) {
    guard += 1;
    let pick = random() * totalArea;
    const zone = areas.find((z) => (pick -= z.width * z.height) <= 0) || areas[areas.length - 1];
    const x = zone.x + random() * zone.width;
    const y = zone.y + random() * zone.height;
    // Patches, not a uniform sprinkle: keep a candidate with the noise's say-so.
    if (random() > noise(x, y) ** 1.6) continue;
    const hue = hues[Math.floor(random() * hues.length)] + (random() * 12 - 6);
    const L = lightness + (random() * 0.02 - 0.01);
    const C = 0.03 + random() * 0.04;
    const { r, g, b, chroma } = oklchToRgb(L, C, hue);
    touches.push({
      x,
      y,
      length: 6 + random() * 12,
      thickness: 2 + random() * 3,
      angle: ((random() * 24 - 12) * Math.PI) / 180,
      opacity: opacityMin + random() * (opacityMax - opacityMin),
      rgb: [r, g, b],
      L,
      chroma
    });
  }
  return touches;
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

function readTheme() {
  const style = getComputedStyle(document.documentElement);
  const number = (name, fallback) => {
    const value = Number.parseFloat(style.getPropertyValue(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const hues = style.getPropertyValue("--touch-hues").trim().split(/\s+/).map(Number).filter(Number.isFinite);
  return {
    lightness: number("--touch-l", 0.955),
    hues: hues.length ? hues : [240],
    opacityMin: number("--touch-opacity-min", 0.35),
    opacityMax: number("--touch-opacity-max", 0.55),
    dark: matchMedia("(prefers-color-scheme: dark)").matches
  };
}

async function paint(touches, width, height) {
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * dpr)), Math.max(1, Math.round(height * dpr)));
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.filter = "blur(0.6px)";
  for (const touch of touches) {
    ctx.save();
    ctx.translate(touch.x, touch.y);
    ctx.rotate(touch.angle);
    ctx.globalAlpha = touch.opacity;
    ctx.fillStyle = `rgb(${touch.rgb.join(" ")})`;
    ctx.beginPath();
    ctx.ellipse(0, 0, touch.length / 2, touch.thickness / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return URL.createObjectURL(blob);
}

/**
 * Mount the pond behind the page. getZones() returns the empty areas (page
 * margins, the empty-state neighbourhood) where touches should fall; the CSS
 * mask keeps the content column clear in any case.
 */
export async function mountPond({ element, getZones } = {}) {
  const host = element || document.querySelector("[data-pond]");
  if (!host) return null;
  const seed = await installSeed();
  let url = null;
  let timer = 0;
  let generation = 0;
  // data-pond-state reads "painting" while a paint is pending and "ready" once
  // the current one is on screen, so tools can wait for a settled background.
  const render = async () => {
    const run = ++generation;
    host.dataset.pondState = "painting";
    const width = window.innerWidth;
    const height = window.innerHeight;
    const theme = readTheme();
    const touches = planTouches({ seed: (seed ^ (theme.dark ? 0x2545f491 : 0)) >>> 0, width, height, ...theme, zones: getZones?.() });
    const next = await paint(touches, width, height);
    if (run !== generation) { URL.revokeObjectURL(next); return; }
    host.style.backgroundImage = `url("${next}")`;
    host.style.backgroundSize = `${width}px ${height}px`;
    if (url) URL.revokeObjectURL(url);
    url = next;
    host.dataset.pondState = "ready";
  };
  const schedule = () => { host.dataset.pondState = "painting"; clearTimeout(timer); timer = setTimeout(() => void render(), 180); };
  window.addEventListener("resize", schedule);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => void render());
  await render();
  return { refresh: schedule };
}
