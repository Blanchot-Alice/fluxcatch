// In-page measurement for scripts/design-audit.mjs. `pageAudit` is serialised
// with Function.prototype.toString and evaluated inside each extension page, so
// it must stay self-contained (no references to module scope).
//
// Definitions (kept in sync with the report legend in design-audit.mjs):
//  a  text style  = (font-family stack, font-size, font-weight, line-height) of
//                   every rendered text run and every form control showing a
//                   value or placeholder.
//  b  left edge   = left x of the "anchor" of every LEADING text box. The anchor
//                   is the outermost visibly boxed element (background, border or
//                   shadow) inside the text's outermost control (a filled button,
//                   a field, a segmented track); otherwise the text run itself.
//                   A box is leading when no other text box on the same line, in
//                   the same row (closest common ancestor ≤ rowMax px tall), sits
//                   to its left. Edges within 1.5 px are merged.
//  c  container   = element with its own background, border or shadow, other
//                   than html/body, controls, indicators, media and the pond
//                   layer. A container inside another container is a violation.
//  d  contrast    = text colour (alpha × ancestor opacity) composited over the
//                   ancestor background stack on the canvas colour.
//  e  clipping    = text or control cut by an overflow:hidden/clip ancestor or by
//                   a viewport that cannot scroll; any control or text partly or
//                   wholly under a fixed/sticky bar at rest; any control under a
//                   fixed/sticky bar after it receives keyboard focus; any dialog
//                   action not fully visible at rest.
//  f  locale      = CJK in visible UI text when the UI is English, or Latin words
//                   (outside an allowlist of names, formats and units) when it is
//                   Chinese. User content is excluded.
//  g  rules       = any visible border, outline, hairline box-shadow (blur 0,
//                   ≤ 2 px), or element/pseudo-element ≤ 2 px thick and ≥ 16 px
//                   long with a fill.
export function pageAudit(cfg) {
  const doc = document;
  const view = window;
  const result = {};

  // ---------- helpers ----------
  const colorCanvas = new OffscreenCanvas(1, 1).getContext("2d", { willReadFrequently: true });
  const colorCache = new Map();
  function parseColor(value) {
    if (!value) return { r: 0, g: 0, b: 0, a: 0 };
    if (colorCache.has(value)) return colorCache.get(value);
    colorCanvas.clearRect(0, 0, 1, 1);
    colorCanvas.fillStyle = "rgba(0,0,0,0)";
    colorCanvas.fillStyle = value;
    colorCanvas.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = colorCanvas.getImageData(0, 0, 1, 1).data;
    const parsed = { r, g, b, a: a / 255 };
    colorCache.set(value, parsed);
    return parsed;
  }
  const styleCache = new Map();
  const cs = (el, pseudo) => {
    if (pseudo) return getComputedStyle(el, pseudo);
    let s = styleCache.get(el);
    if (!s) { s = getComputedStyle(el); styleCache.set(el, s); }
    return s;
  };
  function describe(el) {
    if (!el || el.nodeType !== 1) return String(el);
    let label = el.tagName.toLowerCase();
    if (el.id) label += `#${el.id}`;
    const cls = [...el.classList].slice(0, 3);
    if (cls.length) label += "." + cls.join(".");
    const text = (el.textContent || el.value || el.placeholder || "").replace(/\s+/g, " ").trim().slice(0, 48);
    return text ? `${label} “${text}”` : label;
  }
  function isRendered(el) {
    if (!el || !el.getClientRects().length) return false;
    const s = cs(el);
    if (s.visibility !== "visible" && s.visibility !== "") return false;
    return true;
  }
  function effectiveOpacity(el) {
    let value = 1;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) value *= parseFloat(cs(e).opacity || "1");
    return value;
  }
  function isSrOnly(el) {
    for (let e = el; e && e !== doc.body; e = e.parentElement) {
      const s = cs(e);
      const r = e.getBoundingClientRect();
      if ((s.position === "absolute" || s.position === "fixed") && r.width <= 1 && r.height <= 1) return true;
      if (s.clip && s.clip !== "auto" && /rect\(0px,?\s*0px,?\s*0px,?\s*0px\)/.test(s.clip)) return true;
      if (s.clipPath && /inset\(50%\)/.test(s.clipPath)) return true;
    }
    return false;
  }
  function hasBox(el) {
    const s = cs(el);
    if (parseColor(s.backgroundColor).a > 0.02) return true;
    if (s.backgroundImage && s.backgroundImage !== "none") return true;
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      if (parseFloat(s[`border${side}Width`]) > 0 && s[`border${side}Style`] !== "none" && s[`border${side}Style`] !== "hidden" && parseColor(s[`border${side}Color`]).a > 0.02) return true;
    }
    if (s.boxShadow && s.boxShadow !== "none") return true;
    return false;
  }
  const inModal = doc.querySelector("dialog[open]");
  const inScope = (el) => !inModal || inModal.contains(el);

  // ---------- collect text boxes ----------
  const boxes = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.data.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "TITLE"].includes(el.tagName)) continue;
    if (el.closest("svg")) continue;
    if (!isRendered(el) || isSrOnly(el)) continue;
    const range = doc.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
    if (!rects.length) continue;
    const opacity = effectiveOpacity(el);
    if (opacity < 0.05) continue;
    boxes.push({ kind: "text", el, text, rects, first: rects[0], opacity });
  }
  for (const el of doc.querySelectorAll("input, textarea, select")) {
    if (el.tagName === "INPUT" && ["checkbox", "radio", "range", "color", "file", "hidden", "image"].includes(el.type)) continue;
    if (!isRendered(el) || isSrOnly(el)) continue;
    const value = el.tagName === "SELECT" ? (el.selectedOptions[0]?.textContent || "") : (el.value || "");
    const placeholder = !value && el.placeholder ? el.placeholder : "";
    const text = (value || placeholder).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const r = el.getBoundingClientRect();
    const s = cs(el);
    const left = r.left + parseFloat(s.borderLeftWidth) + parseFloat(s.paddingLeft);
    const rect = { left, top: r.top, right: r.right, bottom: r.bottom, width: r.right - left, height: r.height };
    boxes.push({ kind: placeholder ? "placeholder" : "control", el, text, rects: [rect], first: rect, opacity: effectiveOpacity(el) });
  }
  const scoped = boxes.filter((b) => inScope(b.el));

  // ---------- a: text styles ----------
  // Chrome reports line-height "normal" for ::placeholder whatever the author
  // sets (checked on Chrome 149, even with !important). In a single-line input
  // the placeholder sits in the control's own line box, so measure that.
  const styleKey = (b) => {
    const s = b.kind === "placeholder" ? cs(b.el, "::placeholder") : cs(b.el);
    const lineHeight = b.kind === "placeholder" && b.el.tagName === "INPUT" ? cs(b.el).lineHeight : s.lineHeight;
    const family = s.fontFamily.replace(/["']/g, "").replace(/\s*,\s*/g, ",");
    return { key: `${family}|${s.fontSize}|${s.fontWeight}|${lineHeight}`, family, size: s.fontSize, weight: s.fontWeight, lineHeight };
  };
  const styles = new Map();
  for (const b of boxes) {
    const k = styleKey(b);
    b.style = k;
    if (!styles.has(k.key)) styles.set(k.key, { ...k, n: 0, samples: [] });
    const entry = styles.get(k.key);
    entry.n += 1;
    if (entry.samples.length < 3) entry.samples.push(b.text.slice(0, 40));
  }
  result.textStyles = [...styles.values()].sort((x, y) => y.n - x.n);
  const firstFamily = (b) => b.style.family.split(",")[0].trim().toLowerCase();
  const displayBoxes = boxes.filter((b) => firstFamily(b) === cfg.displayFamily.toLowerCase());
  const brandBoxes = displayBoxes.filter((b) => b.el.closest(cfg.brandSelector));
  // Count Display *elements* (a sentence split over several text nodes is one use).
  const displayElements = new Set(displayBoxes.filter((b) => !b.el.closest(cfg.brandSelector)).map((b) => b.el.closest("h1,h2,h3,h4,p,div,span,strong,small") || b.el));
  result.display = {
    all: new Set(displayBoxes.map((b) => b.el)).size,
    excludingBrand: displayElements.size,
    brand: brandBoxes.length,
    samples: [...displayElements].slice(0, 6).map(describe)
  };

  // ---------- b: left edges ----------
  const CONTROL_ROOT = cfg.controlRootSelector;
  const anchorFor = (b) => {
    let root = null;
    for (let e = b.el; e && e !== doc.body; e = e.parentElement) if (e.matches(CONTROL_ROOT)) root = e;
    if (root) {
      let pick = null;
      for (let e = b.el; e; e = e.parentElement) {
        if (hasBox(e)) pick = e;
        if (e === root) break;
      }
      if (pick) { const r = pick.getBoundingClientRect(); return { left: r.left, right: r.right, by: pick }; }
    }
    return { left: b.first.left, right: b.rects[b.rects.length - 1].right, by: null };
  };
  const rectCache = new Map();
  const heightOf = (el) => { if (!rectCache.has(el)) rectCache.set(el, el.getBoundingClientRect().height); return rectCache.get(el); };
  const commonAncestor = (a, b) => {
    const seen = new Set();
    for (let e = a; e; e = e.parentElement) seen.add(e);
    for (let e = b; e; e = e.parentElement) if (seen.has(e)) return e;
    return null;
  };
  const items = scoped.map((b) => ({ b, anchor: anchorFor(b) }));
  const overlapRatio = (r1, r2) => {
    const overlap = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
    return overlap / Math.max(1, Math.min(r1.height, r2.height));
  };
  const leading = [];
  const trailing = [];
  for (const item of items) {
    let isLeading = true;
    for (const other of items) {
      if (other === item) continue;
      if (overlapRatio(item.b.first, other.b.first) < 0.5) continue;
      if (other.anchor.right > item.anchor.left + 1) continue;
      const ancestor = commonAncestor(item.b.el, other.b.el);
      if (ancestor && heightOf(ancestor) <= cfg.rowMax) { isLeading = false; break; }
    }
    (isLeading ? leading : trailing).push(item);
  }
  const cluster = (values, tolerance) => {
    const sorted = [...values].sort((x, y) => x.x - y.x);
    const groups = [];
    for (const value of sorted) {
      const last = groups[groups.length - 1];
      if (last && value.x - last.max <= tolerance) { last.members.push(value); last.max = value.x; }
      else groups.push({ min: value.x, max: value.x, members: [value] });
    }
    return groups.map((g) => ({ x: Math.round(g.min * 10) / 10, n: g.members.length, samples: g.members.slice(0, 4).map((m) => m.label) }));
  };
  result.edges = cluster(leading.map((i) => ({ x: i.anchor.left, label: describe(i.anchor.by || i.b.el) })), 1.5);
  result.trailingRightEdges = cluster(trailing.map((i) => ({ x: i.anchor.right, label: describe(i.anchor.by || i.b.el) })), 1.5);

  // ---------- c: container nesting ----------
  const all = [...doc.body.querySelectorAll("*")].filter((el) => inScope(el) && isRendered(el) && !isSrOnly(el));
  const exempt = (el) => el.matches(cfg.exemptContainerSelector) || el.closest(cfg.controlSelector) !== null || el.closest(cfg.indicatorSelector) !== null;
  const containers = new Set(all.filter((el) => !exempt(el) && hasBox(el)));
  const nesting = [];
  for (const el of containers) {
    for (let e = el.parentElement; e && e !== doc.body; e = e.parentElement) {
      if (containers.has(e)) { nesting.push({ outer: describe(e), inner: describe(el) }); break; }
    }
  }
  // Depth of the deepest container chain, for the record.
  let depth = 0;
  for (const el of containers) {
    let d = 1;
    for (let e = el.parentElement; e && e !== doc.body; e = e.parentElement) if (containers.has(e)) d += 1;
    depth = Math.max(depth, d);
  }
  result.nesting = { violations: nesting, containers: containers.size, maxDepth: depth };

  // ---------- d: contrast ----------
  const rootBg = (() => {
    const html = parseColor(cs(doc.documentElement).backgroundColor);
    const body = parseColor(cs(doc.body).backgroundColor);
    if (body.a > 0.99) return body;
    if (html.a > 0.99) return html;
    return { r: 255, g: 255, b: 255, a: 1 };
  })();
  const over = (top, bottom) => {
    const a = top.a + bottom.a * (1 - top.a);
    if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (k) => (top[k] * top.a + bottom[k] * bottom.a * (1 - top.a)) / a;
    return { r: mix("r"), g: mix("g"), b: mix("b"), a };
  };
  const lum = (c) => {
    const f = (v) => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (x, y) => { const [h, l] = [lum(x), lum(y)].sort((p, q) => q - p); return (h + 0.05) / (l + 0.05); };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
  const contrastFailures = [];
  const contrastUncertain = [];
  let contrastChecked = 0;
  for (const b of scoped) {
    if (b.el.closest(":disabled, [aria-disabled='true'], [inert]")) continue;
    const s = b.kind === "placeholder" ? cs(b.el, "::placeholder") : cs(b.el);
    const layers = [];
    let uncertain = null;
    for (let e = b.el; e; e = e.parentElement) {
      const es = cs(e);
      if (es.backgroundImage && es.backgroundImage !== "none" && !uncertain && e !== doc.documentElement && e !== doc.body) uncertain = describe(e);
      const bg = parseColor(es.backgroundColor);
      if (bg.a > 0) layers.push(bg);
      if (bg.a >= 0.999) break;
    }
    let bg = rootBg;
    for (let i = layers.length - 1; i >= 0; i -= 1) bg = over(layers[i], bg);
    const fg0 = parseColor(s.color);
    const fg = over({ ...fg0, a: fg0.a * b.opacity }, bg);
    const value = ratio(fg, bg);
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    contrastChecked += 1;
    const record = { text: b.text.slice(0, 60), where: describe(b.el), ratio: Math.round(value * 100) / 100, required, fg: hex(fg), bg: hex(bg), size: s.fontSize, weight: s.fontWeight };
    if (uncertain) contrastUncertain.push({ ...record, gradientOn: uncertain });
    if (value + 1e-6 < required) contrastFailures.push(record);
  }
  result.contrast = { checked: contrastChecked, failures: contrastFailures, uncertain: contrastUncertain };

  // ---------- e: clipping and covering ----------
  const FOCUSABLE = "button, a[href], input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex='-1'])";
  const textContainers = new Set(scoped.map((b) => b.el));
  const controls = [...doc.body.querySelectorAll(FOCUSABLE)].filter((el) => inScope(el) && isRendered(el) && !isSrOnly(el) && !el.closest(":disabled") && !el.disabled);
  const candidates = [...new Set([...controls, ...textContainers])];
  const htmlS = cs(doc.documentElement);
  const bodyS = cs(doc.body);
  const se = doc.scrollingElement || doc.documentElement;
  const docScrollsY = se.scrollHeight > view.innerHeight + 1 && htmlS.overflowY !== "hidden" && bodyS.overflowY !== "hidden" && htmlS.overflowY !== "clip";
  const docScrollsX = se.scrollWidth > view.innerWidth + 1 && htmlS.overflowX !== "hidden" && bodyS.overflowX !== "hidden" && htmlS.overflowX !== "clip";
  const clipped = [];
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let reason = null;
    let insideScroller = false;
    for (let a = el.parentElement; a && a !== doc.body && a !== doc.documentElement; a = a.parentElement) {
      const as = cs(a);
      const scrollY = as.overflowY === "auto" || as.overflowY === "scroll";
      const scrollX = as.overflowX === "auto" || as.overflowX === "scroll";
      const clipY = as.overflowY === "hidden" || as.overflowY === "clip";
      const clipX = as.overflowX === "hidden" || as.overflowX === "clip";
      if (clipX || clipY) {
        // Intentional single-line truncation of the element's own text is allowed.
        if (as.textOverflow === "ellipsis" && textContainers.has(el) && a.contains(el) && a.querySelectorAll("*").length <= 4) continue;
        const ar = a.getBoundingClientRect();
        const top = ar.top + parseFloat(as.borderTopWidth);
        const bottom = ar.bottom - parseFloat(as.borderBottomWidth);
        const left = ar.left + parseFloat(as.borderLeftWidth);
        const right = ar.right - parseFloat(as.borderRightWidth);
        if (clipY && (r.top < top - 1 || r.bottom > bottom + 1)) { reason = `cut by overflow:${as.overflowY} on ${describe(a)}`; break; }
        if (clipX && (r.left < left - 1 || r.right > right + 1)) { reason = `cut by overflow-x:${as.overflowX} on ${describe(a)}`; break; }
      }
      if (scrollY || scrollX) { insideScroller = true; break; }
    }
    if (!reason && !insideScroller) {
      const fixedAncestor = (() => { for (let a = el; a; a = a.parentElement) if (cs(a).position === "fixed") return true; return false; })();
      if (!fixedAncestor || inModal) {
        if (!docScrollsY && (r.bottom > view.innerHeight + 1 || r.top < -1)) reason = "outside the viewport, which cannot scroll vertically";
        else if (!docScrollsX && (r.right > view.innerWidth + 1 || r.left < -1)) reason = "outside the viewport, which cannot scroll horizontally";
      }
    }
    if (reason) clipped.push({ where: describe(el), reason });
  }
  const obstructions = [...doc.body.querySelectorAll("*")].filter((el) => {
    const p = cs(el).position;
    return (p === "fixed" || p === "sticky") && isRendered(el) && hasBox(el) && !el.matches("dialog, [data-pond]") && inScope(el);
  });
  const coveredBy = (el) => {
    const r = el.getBoundingClientRect();
    for (const o of obstructions) {
      if (o.contains(el) || el.contains(o)) continue;
      const orr = o.getBoundingClientRect();
      const x1 = Math.max(r.left, orr.left);
      const x2 = Math.min(r.right, orr.right);
      const y1 = Math.max(r.top, orr.top);
      const y2 = Math.min(r.bottom, orr.bottom);
      if (x2 - x1 < 1 || y2 - y1 < 1) continue;
      const stack = doc.elementsFromPoint((x1 + x2) / 2, (y1 + y2) / 2);
      const hit = stack.find((node) => o.contains(node) || el.contains(node) || node === el);
      if (hit && o.contains(hit)) return describe(o);
    }
    return null;
  };
  const coveredAtRest = [];
  for (const el of candidates) {
    const by = coveredBy(el);
    if (by) coveredAtRest.push({ where: describe(el), by });
  }
  // Dialog actions are judged at rest, before the focus pass scrolls anything.
  const dialogActions = [];
  if (inModal) {
    const dr = inModal.getBoundingClientRect();
    for (const el of inModal.querySelectorAll(cfg.dialogActionSelector)) {
      if (!isRendered(el)) continue;
      const r = el.getBoundingClientRect();
      const visibleTop = Math.max(dr.top, 0);
      const visibleBottom = Math.min(dr.bottom, view.innerHeight);
      if (r.top < visibleTop - 1 || r.bottom > visibleBottom + 1) dialogActions.push({ where: describe(el), reason: `action not fully visible at rest (bottom ${Math.round(r.bottom)} > ${Math.round(visibleBottom)})` });
      else {
        // Inside a scrolled region of the dialog? Check against scrolling ancestors too.
        for (let a = el.parentElement; a && a !== inModal.parentElement; a = a.parentElement) {
          const as = cs(a);
          if (as.overflowY === "auto" || as.overflowY === "scroll" || as.overflowY === "hidden") {
            const ar = a.getBoundingClientRect();
            if (r.bottom > ar.bottom + 1 || r.top < ar.top - 1) { dialogActions.push({ where: describe(el), reason: `action cut by the dialog's scroll area ${describe(a)}` }); break; }
          }
        }
      }
    }
  }
  // Keyboard focus must never land under a fixed or sticky bar.
  const focusObscured = [];
  if (cfg.checkFocus) {
    const style = doc.createElement("style");
    style.textContent = "*{scroll-behavior:auto !important}";
    doc.head.append(style);
    const previous = doc.activeElement;
    for (const el of controls) {
      if (el.closest("details:not([open])")) continue;
      view.scrollTo(0, 0);
      for (const scroller of doc.querySelectorAll("*")) if (scroller.scrollTop) scroller.scrollTop = 0;
      try { el.focus({ preventScroll: false }); } catch { continue; }
      if (doc.activeElement !== el) continue;
      const by = coveredBy(el);
      if (by) focusObscured.push({ where: describe(el), by });
    }
    try { previous?.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    doc.activeElement?.blur?.();
    view.scrollTo(0, 0);
    for (const scroller of doc.querySelectorAll("*")) if (scroller.scrollTop) scroller.scrollTop = 0;
    style.remove();
  }
  result.clipping = { clipped, coveredAtRest, focusObscured, dialogActions };

  // ---------- f: locale leaks ----------
  const CJK = /[㐀-䶿一-鿿豈-﫿　-〿！-｠]/;
  const allow = new Set(cfg.latinAllowlist.map((w) => w.toLowerCase()));
  const leaks = [];
  for (const b of scoped) {
    if (b.kind !== "text" && b.kind !== "placeholder") continue;
    if (b.el.closest(cfg.userContentSelector)) continue;
    if (cfg.lang === "en") {
      if (CJK.test(b.text)) leaks.push({ text: b.text.slice(0, 60), where: describe(b.el), kind: "CJK in English UI" });
    } else {
      const stripped = b.text
        .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ")
        .replace(/\b[\w-]+(\.[\w-]+)+\b/g, " ")
        .replace(/\b\d+(\.\d+)?\s?(k|m|g|t)?i?b(\/s)?\b/gi, " ")
        .replace(/\b\d+p\b/gi, " ");
      const words = (stripped.match(/[A-Za-z][A-Za-z0-9'’-]*/g) || []).filter((w) => /[A-Za-z].*[A-Za-z]/.test(w));
      const bad = words.filter((w) => !allow.has(w.toLowerCase()));
      if (bad.length) leaks.push({ text: b.text.slice(0, 60), where: describe(b.el), kind: `Latin in Chinese UI: ${[...new Set(bad)].slice(0, 6).join(", ")}` });
    }
  }
  result.locale = { leaks };

  // ---------- g: rules ----------
  const rules = [];
  const shadowParts = (value) => {
    const parts = [];
    let depthP = 0;
    let current = "";
    for (const ch of value) {
      if (ch === "(") depthP += 1;
      if (ch === ")") depthP -= 1;
      if (ch === "," && depthP === 0) { parts.push(current.trim()); current = ""; } else current += ch;
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  };
  const checkShadow = (el, value, label) => {
    if (!value || value === "none") return;
    for (const part of shadowParts(value)) {
      const color = (part.match(/(rgba?\([^)]*\)|color\([^)]*\)|oklch\([^)]*\)|#[0-9a-f]{3,8})/i) || [])[0];
      const lengths = part.replace(color || "", "").replace("inset", "").trim().split(/\s+/).map(parseFloat).filter((n) => !Number.isNaN(n));
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
      if (parseColor(color).a <= 0.02) continue;
      if (blur === 0 && (spread > 0 || Math.abs(x) > 0 || Math.abs(y) > 0) && Math.max(Math.abs(x), Math.abs(y), spread) <= 2) rules.push({ where: describe(el) + label, what: `hairline shadow “${part}”` });
    }
  };
  for (const el of all) {
    if (cfg.prefersContrastMore && el.matches("input, select, textarea")) continue;
    const s = cs(el);
    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const width = parseFloat(s[`border${side}Width`]);
      if (width > 0 && s[`border${side}Style`] !== "none" && s[`border${side}Style`] !== "hidden" && parseColor(s[`border${side}Color`]).a > 0.02) {
        rules.push({ where: describe(el), what: `${side.toLowerCase()} border ${s[`border${side}Width`]} ${s[`border${side}Style`]}` });
      }
    }
    if (parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== "none" && parseColor(s.outlineColor).a > 0.02) rules.push({ where: describe(el), what: `outline ${s.outlineWidth} at rest` });
    checkShadow(el, s.boxShadow, "");
    const r = el.getBoundingClientRect();
    const filled = parseColor(s.backgroundColor).a > 0.05 || (s.backgroundImage && s.backgroundImage !== "none");
    if (filled && ((r.height > 0 && r.height <= 2 && r.width >= 16) || (r.width > 0 && r.width <= 2 && r.height >= 16)) && !el.closest(cfg.indicatorSelector)) {
      rules.push({ where: describe(el), what: `thin filled element ${Math.round(r.width)}×${Math.round(r.height)}` });
    }
    for (const pseudo of ["::before", "::after"]) {
      const ps = cs(el, pseudo);
      if (!ps || ps.content === "none" || ps.content === "normal" || ps.display === "none") continue;
      const w = parseFloat(ps.width);
      const h = parseFloat(ps.height);
      const pf = parseColor(ps.backgroundColor).a > 0.05;
      if (pf && ((h > 0 && h <= 2 && (w >= 16 || Number.isNaN(w))) || (w > 0 && w <= 2 && h >= 16))) rules.push({ where: describe(el) + pseudo, what: `thin filled pseudo-element ${ps.width}×${ps.height}` });
      for (const side of ["Top", "Right", "Bottom", "Left"]) {
        const width = parseFloat(ps[`border${side}Width`]);
        if (width > 0 && ps[`border${side}Style`] !== "none" && parseColor(ps[`border${side}Color`]).a > 0.02 && (parseFloat(ps.width) >= 16 || parseFloat(ps.height) >= 16)) {
          rules.push({ where: describe(el) + pseudo, what: `${side.toLowerCase()} border on pseudo-element` });
        }
      }
      checkShadow(el, ps.boxShadow, pseudo);
    }
  }
  result.rules = rules;

  // ---------- filenames: the extension must survive truncation ----------
  const endTruncated = [];
  for (const el of doc.querySelectorAll(cfg.filenameSelector)) {
    if (!isRendered(el) || !inScope(el)) continue;
    if (el.hasAttribute("data-filename")) {
      const tail = el.querySelector("[data-filename-tail]");
      const name = el.getAttribute("data-filename") || "";
      const ext = (name.match(/\.[a-z0-9]{1,6}$/i) || [""])[0];
      if (!ext) continue;
      const ok = tail && tail.textContent.endsWith(ext) && tail.scrollWidth <= tail.clientWidth + 1;
      if (!ok) endTruncated.push({ where: describe(el), name });
      continue;
    }
    const s = cs(el);
    if (s.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) endTruncated.push({ where: describe(el), name: el.textContent.trim().slice(0, 60) });
  }
  result.filenames = { endTruncated };

  // ---------- pond layer presence ----------
  const pond = doc.querySelector("[data-pond]");
  result.pond = pond ? { present: true, image: cs(pond).backgroundImage !== "none" } : { present: false };
  result.viewport = { width: view.innerWidth, height: view.innerHeight, scrollHeight: se.scrollHeight, lang: doc.documentElement.lang };
  return result;
}
