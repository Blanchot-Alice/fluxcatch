// The component preview on the v2 system (design review §0: 1440 × auto):
// static checks on its sources and message module, then the real preview.js
// run against preview.html in a small DOM with a stubbed chrome.*, since
// Chrome cannot run here. Budgets are checked per view by proxy (type roles,
// Display uses, primaries, containers, locale); the Chrome design audit
// measures the rendered pixels.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ---------- a small DOM that can parse the surface HTML ----------
const REFLECT = { id: "id", title: "title", type: "type", alt: "alt", src: "src", decoding: "decoding", htmlFor: "for", href: "href", name: "name", placeholder: "placeholder", method: "method", inputMode: "inputmode", min: "min", max: "max", step: "step" };
const BOOL = { hidden: "hidden", disabled: "disabled", required: "required", noValidate: "novalidate" };
const VOID = new Set(["meta", "link", "input", "br", "img", "hr", "source"]);
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; this.listeners = {}; }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === "string" ? new Text(n) : n); }
  appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); return n; }
  prepend(...nodes) { const list = nodes.map((n) => (typeof n === "string" ? new Text(n) : n)); for (const n of list) { if (n.parentNode) n.remove(); n.parentNode = this; } this.childNodes.unshift(...list); }
  insertBefore(n, ref) { if (!ref) return this.appendChild(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.splice(this.childNodes.indexOf(ref), 0, n); return n; }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) c.parentNode = null; this.childNodes = []; this.append(...nodes); }
  remove() { if (!this.parentNode) return; const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); this.parentNode = null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.replaceChildren(); if (String(v ?? "") !== "") this.append(new Text(String(v))); }
  get firstChild() { return this.childNodes[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(event) { event.target ??= this; event.currentTarget = this; for (const fn of this.listeners[event.type] || []) fn.call(this, event); if (event.bubbles && this.parentNode && !event.stopped) this.parentNode.dispatchEvent(event); return true; }
  contains(n) { for (let e = n; e; e = e.parentNode) if (e === this) return true; return false; }
}
class Text extends Node {
  constructor(v) { super(); this.data = String(v); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  cloneNode() { return new Text(this.data); }
}
class Element extends Node {
  constructor(tag, ns) { super(); this.tagName = ns ? tag : tag.toUpperCase(); this.localName = tag.toLowerCase(); this.ns = ns; this.attributes = new Map(); this.style = { props: {}, setProperty(k, v) { this.props[k] = v; }, getPropertyValue(k) { return this.props[k] ?? ""; } }; this.value = ""; this._raw = null;
    const self = this;
    const attr = (k) => `data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute(attr(k)) ?? undefined,
      set: (_, k, v) => { self.setAttribute(attr(k), String(v)); return true; },
      deleteProperty: (_, k) => { self.removeAttribute(attr(k)); return true; },
      has: (_, k) => self.hasAttribute(attr(k))
    });
    this.classList = { add: (...c) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); this.className = [...s].join(" "); }, remove: (...c) => { this.className = this.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(" "); }, contains: (c) => this.className.split(/\s+/).includes(c), toggle: (c, f) => { const on = f ?? !this.classList.contains(c); if (on) this.classList.add(c); else this.classList.remove(c); return on; } };
  }
  get className() { return this.getAttribute("class") || ""; }
  set className(v) { this.setAttribute("class", v); }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  get children() { return this.childNodes.filter((c) => c instanceof Element); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const list = this.children; return list[list.length - 1] || null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === globalThis.document; }
  set innerHTML(v) { this._raw = String(v); this.childNodes = []; }
  get innerHTML() { return this._raw ?? ""; }
  get tabIndex() { return Number(this.getAttribute("tabindex") ?? -1); }
  set tabIndex(v) { this.setAttribute("tabindex", String(v)); }
  get maxLength() { return Number(this.getAttribute("maxlength") ?? -1); }
  set maxLength(v) { this.setAttribute("maxlength", String(v)); }
  get spellcheck() { return this.getAttribute("spellcheck") !== "false"; }
  set spellcheck(v) { this.setAttribute("spellcheck", String(Boolean(v))); }
  get options() { return this.querySelectorAll("option"); }
  focus() { globalThis.document.activeElement = this; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = globalThis.document.body; }
  click() { this.dispatchEvent(new globalThis.Event("click", { bubbles: true })); }
  showModal() { this.open = true; }
  close(value) { if (!this.open) return; if (value !== undefined) this.returnValue = value; this.open = false; this.dispatchEvent(new globalThis.Event("close")); }
  cloneNode(deep = false) {
    const copy = new Element(this.ns ? this.tagName : this.localName, this.ns);
    for (const [k, v] of this.attributes) copy.setAttribute(k, v);
    copy.style.props = { ...this.style.props };
    copy.value = this.value;
    copy._raw = this._raw;
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  getClientRects() { return []; }
  matches(selector) { return selector.split(",").some((part) => matchCompound(this, part.trim())); }
  closest(selector) { for (let e = this; e instanceof Element; e = e.parentNode) if (e.matches(selector)) return e; return null; }
  querySelectorAll(selector) { const out = []; const walk = (n) => { for (const c of n.children) { if (c.matches(selector)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
for (const [prop, attr] of Object.entries(REFLECT)) Object.defineProperty(Element.prototype, prop, { get() { return this.getAttribute(attr) ?? ""; }, set(v) { this.setAttribute(attr, String(v)); }, configurable: true });
for (const [prop, attr] of Object.entries(BOOL)) Object.defineProperty(Element.prototype, prop, { get() { return this.hasAttribute(attr); }, set(v) { if (v) this.setAttribute(attr, ""); else this.removeAttribute(attr); }, configurable: true });
function matchSimple(el, simple) {
  const re = /([a-z][a-z0-9-]*)|\.([\w-]+)|#([\w-]+)|\[([\w-]+)(?:([~^$*]?=)"?([^"\]]*)"?)?\]/gi;
  let m; let used = 0;
  while ((m = re.exec(simple))) {
    used += m[0].length;
    if (m[1] && el.localName !== m[1].toLowerCase()) return false;
    if (m[2] && !el.className.split(/\s+/).includes(m[2])) return false;
    if (m[3] && el.getAttribute("id") !== m[3]) return false;
    if (m[4]) { const v = el.getAttribute(m[4]); if (v === null) return false; if (m[5] === "=" && v !== m[6]) return false; }
  }
  return used === simple.length;
}
function matchCompound(el, selector) {
  const parts = selector.replace(/\s*>\s*/g, " > ").split(/\s+/);
  const check = (e, i) => {
    if (!matchSimple(e, parts[i])) return false;
    if (i === 0) return true;
    if (parts[i - 1] === ">") return e.parentNode instanceof Element && check(e.parentNode, i - 2);
    for (let p = e.parentNode; p instanceof Element; p = p.parentNode) if (check(p, i - 1)) return true;
    return false;
  };
  return check(el, parts.length - 1);
}
function parseHtml(html, doc) {
  const stack = [doc];
  const re = /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/([a-z0-9-]+)\s*>|<([a-z0-9-]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[1]) { while (stack.length > 1 && stack.pop().localName !== m[1].toLowerCase()); continue; }
    if (m[2]) {
      const el = new Element(m[2]);
      for (const a of (m[3] || "").matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? "");
      top.appendChild(el);
      if (!VOID.has(el.localName) && !m[4]) stack.push(el);
      continue;
    }
    if (m[5] && m[5].trim()) top.appendChild(new Text(m[5].replace(/\s+/g, " ")));
  }
}
function installPage() {
  const doc = new Element("#document", true);
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (ns, tag) => new Element(tag, ns);
  doc.createTextNode = (v) => new Text(v);
  parseHtml(readFileSync(new URL("../extension/preview/preview.html", import.meta.url), "utf8"), doc);
  doc.documentElement = doc.querySelector("html");
  doc.head = doc.querySelector("head");
  doc.body = doc.querySelector("body");
  doc.activeElement = doc.body;
  doc.readyState = "complete";
  globalThis.document = doc;
  globalThis.Event = class Event { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } stopPropagation() { this.stopped = true; } preventDefault() { this.defaultPrevented = true; } };
  return doc;
}

// ---------- stubbed chrome.*, window, history and timers ----------
function installChrome({ lang = "en-US", search = "" } = {}) {
  const env = { urls: [], intervals: [], created: [], copied: null };
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  globalThis.chrome = {
    runtime: { id: "test", openOptionsPage: async () => { env.created.push("options"); }, getURL: (path) => `chrome-extension://test/${path}`, lastError: null },
    i18n: { getUILanguage: () => lang },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: event() },
    tabs: { create: async ({ url }) => { env.created.push(url); } }
  };
  globalThis.window = { addEventListener() {}, innerWidth: 1440, innerHeight: 900, scrollY: 0, devicePixelRatio: 2 };
  globalThis.location = { search, pathname: "/preview/preview.html" };
  globalThis.history = { replaceState: (_state, _title, url) => { env.urls.push(url); } };
  globalThis.setInterval = (fn, ms) => { env.intervals.push({ fn, ms }); return env.intervals.length; };
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text) => { env.copied = text; } } }, configurable: true, writable: true });
  return env;
}

const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)); };
let caseNumber = 0;
async function boot({ lang = "en-US", search = "" } = {}) {
  installPage();
  const env = installChrome({ lang, search });
  caseNumber += 1;
  await import(`../extension/preview/preview.js?case=${caseNumber}`);
  await settle();
  return env;
}

// ---------- helpers ----------
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CJK = /[㐀-鿿　-〿＀-￯]/;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const click = (element) => element.dispatchEvent(new Event("click", { bubbles: true }));
const VIEW_IDS = ["type", "text", "controls", "rows", "feedback", "overlays"];
// The audit's Latin allowlist for the Chinese UI (scripts/design-audit.mjs).
const LATIN_OK = new Set(["havre", "finder", "chrome", "macos", "mp4", "mkv", "webm", "mp3", "m4a", "aac", "hls", "dash", "http", "kb", "mb", "gb", "tb", "youtube", "x"]);

function visible(element) {
  for (let e = element; e && e !== document; e = e.parentNode) {
    if (!(e instanceof Element)) continue;
    if (e.hidden || e.classList.contains("sr-only") || e.localName === "svg") return false;
    if (e.localName === "dialog" && !e.open) return false;
    if (e.localName === "details" && !e.open && e.parentNode?.localName === "details") return false;
  }
  return true;
}
/** Visible text nodes under root with the element that carries them. */
function visibleTexts(rootElement, { userContent = false } = {}) {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child instanceof Text) { if (child.data.trim()) out.push({ text: child.data.trim(), el: node }); continue; }
      if (!visible(child)) continue;
      if (child.localName === "option" || child.localName === "title") continue;
      if (!userContent && child.hasAttribute("data-user-content")) continue;
      walk(child);
    }
  };
  if (visible(rootElement)) walk(rootElement);
  return out;
}
const ROLES = ["wordmark", "display", "empty", "title", "row", "body", "meta", "label"];
/** The type role of an element's text: its own .t-* class, or the role its control uses (buttons, tabs, menu items and summaries are row; field values are body). */
function roleOf(element) {
  for (let e = element; e instanceof Element; e = e.parentNode) {
    const own = ROLES.find((role) => e.classList.contains(`t-${role}`));
    if (own) return own;
    if (e.matches("button, summary, .menu-item")) return "row";
    if (e.matches("input, select, textarea")) return "body";
  }
  return null;
}
function viewBudget(panel) {
  const roles = new Set();
  const unstyled = [];
  const scope = [document.querySelector("#topbar"), document.querySelector(".page-head"), panel];
  for (const area of scope) {
    for (const { text, el } of visibleTexts(area, { userContent: true })) {
      const role = roleOf(el);
      if (role) roles.add(role); else unstyled.push(text);
    }
    for (const control of area.querySelectorAll("input, select")) if (visible(control)) roles.add("body");
  }
  const display = [...document.querySelectorAll(".t-display, .t-empty")].filter((el) => visible(el) && !el.closest("[data-brandmark]") && el.textContent.trim()).length;
  const primaries = [...document.querySelectorAll(".btn-primary")].filter(visible).length;
  return { roles, unstyled, display, primaries };
}
const panelOf = (id) => document.querySelector(`#view-${id}`);

// ---------- static checks ----------
test("the preview is built on v2 only: tokens, system, media, page sheet; no v1 sheets or modules; no copy in HTML; no literals", async () => {
  const html = read("extension/preview/preview.html");
  const js = read("extension/preview/preview.js");
  const css = read("extension/preview/preview.css");
  const order = ["../ui/v2/tokens.css", "../ui/v2/system.css", "../ui/v2/media.css", "preview.css"].map((href) => html.indexOf(`href="${href}"`));
  assert.ok(order.every((index) => index >= 0) && order.every((index, i) => i === 0 || order[i - 1] < index), "tokens, system, media, page in order");
  assert.doesNotMatch(html, /ui\/tokens\.css|ui\/components\.css|ui\/atmosphere\.css/, "no v1 stylesheets");
  assert.doesNotMatch(js, /from "\.\.\/ui\/(?!v2\/)/, "no v1 UI modules (speed-graph, i18n, interactions, job-rows …)");
  for (const [name, source] of [["preview.html", html.replace(/<!--[\s\S]*?-->/g, "")], ["preview.js", js], ["preview.css", css]]) {
    assert.ok(!CJK.test(source), `${name} holds no CJK: copy lives in messages/preview.js`);
  }
  assert.doesNotMatch(js, /innerHTML|window\.confirm|\.style\.(?:color|background)/, "DOM nodes, in-place confirmations, no inline colours");
  assert.doesNotMatch(css, /border(-top|-bottom|-left|-right|-block|-inline)?(-width)?:\s*1px|\b0 0 0 1px\b/, "no 1px rules");
  assert.doesNotMatch(css, /text-transform:\s*uppercase|letter-spacing|font-style:\s*italic|monospace/, "no tracked caps, italics or monospace");
  assert.doesNotMatch(css, /font-size|font-weight|line-height|font-family/, "type comes from the .t-* roles only");
  const { scanColourLiterals } = await import("../scripts/design-audit.mjs");
  assert.deepEqual(scanColourLiterals().filter((f) => f.file.startsWith("extension/preview/") || f.file === "extension/ui/v2/messages/preview.js"), [], "colour literals live only in tokens.css");
  assert.doesNotMatch(html + js, /frosted|tonal nav hover|count chips|pv-note/, "no spec annotations as UI text (review §7)");
  assert.match(js, /mountPondLayer\(\{ element: \$\("\[data-pond\]"\), getContentBoxes: \(\) => contentBoxes\(PREVIEW_BOXES\) \}\)/, "the pond layer is masked by the shown view's boxes");
  assert.doesNotMatch(js, /function asRadioGroup|dataset\.indicator/, "radio groups and indicator dots come from the shared builders");
});

test("preview.css layout: segmented tracks on the column edge, specimens 8 px under their group label, the empty state without page padding", () => {
  const css = read("extension/preview/preview.css");
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&");
    const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `${selector} has a rule`);
    return match[1];
  };
  // Boxes start on the column edge, as Downloads' filter track does; the text column is lead + gap in.
  assert.match(rule(".view-switch"), /margin-inline-start:\s*calc\(-1 \* \(var\(--lead\) \+ var\(--lead-gap\)\)\)/);
  assert.doesNotMatch(rule(".switch-specimen"), /padding-inline-start/, "the demo tracks sit on the column edge");
  // Floating specimens start the group label's own 8 px below it.
  for (const selector of [".toast-specimens", ".menu-specimen", ".confirm-specimen"]) {
    assert.match(rule(selector), /padding-block:\s*0 var\(--space-2\)/, `${selector} adds nothing above the box`);
  }
  // system.css places a real empty state with 48 px above and below; the gallery drops it.
  assert.match(rule(".view > .empty-state"), /padding-block:\s*0 var\(--space-2\)/);
});

test("messages/preview.js: identical keys, preview. prefix, natural Chinese, the page title listed as Display", async () => {
  const { default: module } = await import("../extension/ui/v2/messages/preview.js");
  assert.deepEqual(Object.keys(module.zh).sort(), Object.keys(module.en).sort());
  for (const key of Object.keys(module.en)) assert.ok(key.startsWith("preview."), key);
  for (const [key, value] of Object.entries(module.en)) assert.ok(!CJK.test(value), `en ${key} has no CJK`);
  for (const [key, value] of Object.entries(module.zh)) {
    const latin = (value.match(/[A-Za-z]{2,}/g) || []).filter((word) => !["MB", "GB", "Havre", "Chrome", "Finder", "Mac"].includes(word));
    assert.deepEqual(latin, [], `zh ${key} has no stray Latin: ${value}`);
  }
  assert.deepEqual(module.display, ["preview.title"], "the page title is the preview's one Display string");
  for (const id of VIEW_IDS) assert.ok(module.en[`preview.view.${id}`] && module.zh[`preview.view.${id}`], `view ${id} is named in both languages`);
});

// ---------- the running preview ----------
test("skeleton: BrandMark M in the top bar, the page title, and the view switch with one tab per view", async () => {
  await boot();
  const brand = $("#topbarInner [data-brandmark]");
  assert.equal(brand?.dataset.size, "m");
  assert.equal($("#topbarInner").querySelectorAll("button").length, 0, "the bar holds the BrandMark only");
  assert.equal($("#previewTitle").textContent, "Components");
  assert.ok($("#previewTitle").classList.contains("t-display"));
  assert.equal($("#pageTitle"), null, "not the id the audit reads as user content (the v1 popup's tab title)");
  const tabs = $$('#viewSwitch [role="tab"]');
  assert.deepEqual(tabs.map((tab) => tab.dataset.value), VIEW_IDS);
  assert.deepEqual(tabs.map((tab) => tab.querySelector("span").textContent), ["Type and brand", "Text styles", "Controls", "Rows and progress", "Status and empty states", "Dialogs and menus"]);
  for (const tab of tabs) {
    assert.equal(tab.getAttribute("aria-controls"), `view-${tab.dataset.value}`);
    assert.equal(panelOf(tab.dataset.value).getAttribute("aria-labelledby"), tab.id);
  }
  assert.equal(document.title, "Components · Havre");
});

test("?view=<id> renders that view directly; an unknown id falls back to the first view", async () => {
  for (const id of VIEW_IDS) {
    await boot({ search: `?view=${id}&demo=static` });
    const shown = $$("[data-view-panel]").filter((panel) => !panel.hidden).map((panel) => panel.dataset.viewPanel);
    assert.deepEqual(shown, [id], `${id} alone is shown`);
    assert.equal($(`#tab-${id}`).getAttribute("aria-selected"), "true");
    assert.ok(panelOf(id).children.length > 0, `${id} is built`);
  }
  await boot({ search: "?view=nope" });
  assert.deepEqual($$("[data-view-panel]").filter((panel) => !panel.hidden).map((panel) => panel.dataset.viewPanel), ["type"]);
});

test("switching views shows one panel and keeps the choice in the URL, with the other parameters", async () => {
  const env = await boot({ search: "?demo=static" });
  click($("#tab-rows"));
  assert.equal(panelOf("rows").hidden, false);
  assert.equal(panelOf("type").hidden, true);
  assert.match(env.urls.at(-1), /view=rows/);
  assert.match(env.urls.at(-1), /demo=static/);
});

test("every view keeps the screen budgets: at most 6 type roles, 2 Display uses, 1 primary; every text has a role", async () => {
  for (const lang of ["en-US", "zh-CN"]) {
    for (const id of VIEW_IDS) {
      await boot({ lang, search: `?view=${id}&demo=static` });
      const { roles, unstyled, display, primaries } = viewBudget(panelOf(id));
      assert.deepEqual(unstyled, [], `${id} (${lang}): every text uses one of the 8 roles`);
      assert.ok(roles.size <= 6, `${id} (${lang}) uses ${roles.size} roles: ${[...roles].join(", ")}`);
      assert.ok(display <= 2, `${id} (${lang}) has ${display} Display uses`);
      assert.ok(primaries <= 1, `${id} (${lang}) has ${primaries} primary buttons`);
      assert.ok(roles.has("wordmark") && roles.has("display"), `${id}: the skeleton is the same on every view`);
    }
  }
});

test("all eight type roles appear across the views", async () => {
  const seen = new Set();
  for (const id of VIEW_IDS) {
    await boot({ search: `?view=${id}&demo=static` });
    for (const role of viewBudget(panelOf(id)).roles) seen.add(role);
  }
  assert.deepEqual([...seen].sort(), [...ROLES].sort());
});

test("no container sits inside another: focus panel, dialog, menus and toasts are each on the canvas", async () => {
  const CONTAINERS = ".focus-panel, .dialog-shell, .menu, .toast";
  for (const id of VIEW_IDS) {
    await boot({ search: `?view=${id}&demo=static` });
    for (const box of panelOf(id).querySelectorAll(CONTAINERS)) {
      assert.equal(box.parentNode.closest(CONTAINERS), null, `${id}: ${box.className} is not nested`);
    }
    assert.ok(panelOf(id).querySelectorAll(".focus-panel").length <= 1, `${id}: at most one focus panel`);
  }
});

test("no locale leaks: no CJK in the English gallery, no Latin UI words in the Chinese one", async () => {
  for (const id of VIEW_IDS) {
    await boot({ lang: "en-US", search: `?view=${id}&demo=static` });
    for (const { text } of visibleTexts(document.body)) assert.ok(!CJK.test(text), `${id} en: ${text}`);
    await boot({ lang: "zh-CN", search: `?view=${id}&demo=static` });
    assert.equal(document.documentElement.lang, "zh-CN");
    for (const { text } of visibleTexts(document.body)) {
      const stripped = text.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, " ").replace(/\b[\w-]+(\.[\w-]+)+\b/g, " ").replace(/\b\d+(\.\d+)?\s?(k|m|g|t)?i?b(\/s)?\b/gi, " ").replace(/\b\d+p\b/gi, " ");
      const words = (stripped.match(/[A-Za-z][A-Za-z0-9'’-]*/g) || []).filter((word) => /[A-Za-z].*[A-Za-z]/.test(word) && !LATIN_OK.has(word.toLowerCase()));
      assert.deepEqual(words, [], `${id} zh: ${text}`);
    }
  }
});

test("Type and brand: BrandMark S and M, the empty-state sentence and the title role, each named", async () => {
  await boot({ search: "?view=type&demo=static" });
  const panel = panelOf("type");
  assert.deepEqual(panel.querySelectorAll("[data-brandmark]").map((mark) => mark.dataset.size), ["s", "m"]);
  assert.equal(panel.querySelector(".t-empty").textContent, "No downloads yet.");
  assert.equal(panel.querySelector(".t-title").textContent, "Media on this page");
  assert.deepEqual(panel.querySelectorAll(".specimen > .t-label").map((name) => name.textContent), ["Empty-state sentence", "Section and dialog titles"], "names stay in label here: meta would make a seventh style");
  assert.deepEqual(panel.querySelectorAll(".group-label").map((label) => label.textContent), ["Brand mark", "App icon", "Type"]);
  assert.deepEqual(panel.querySelectorAll(".icon-specimens img").map((image) => image.getAttribute("src")), [128, 48, 32, 16].map((size) => `../icons/icon${size}.png`), "the manifest icons");
});

test("Text styles: row (a middle-truncated file name), body, meta and label samples", async () => {
  await boot({ search: "?view=text&demo=static" });
  const panel = panelOf("text");
  const name = panel.querySelector(".t-row [data-filename]");
  assert.equal(name.dataset.filename, "Lecture 12 · Pharmacokinetics.mp4");
  assert.ok(name.querySelector("[data-filename-tail]").textContent.endsWith(".mp4"), "the extension survives truncation");
  assert.equal(panel.querySelector(".specimen > p.t-meta").textContent, "MP4 · 2160p · 2.4 GB · 2:28", "meta from rows.js completedMeta, decimal units");
  // Each name recedes behind its sample: meta, not label, on this view only.
  assert.deepEqual(panel.querySelectorAll(".specimen > span").map((name) => name.className), ["t-meta", "t-meta", "t-meta", "t-meta"]);
  assert.ok(viewBudget(panel).roles.size <= 6, "names in meta keep the view at six styles");
  assert.equal(panel.querySelector(".specimen > .t-body").textContent, "Play the video, then rescan.");
  assert.equal(panel.querySelector(".specimen > p.t-label").textContent, "Yesterday");
});

test("Controls: four button kinds and icon buttons, Settings' own rows with every control, Saved and an error line, the nav", async () => {
  const env = await boot({ search: "?view=controls&demo=static" });
  const panel = panelOf("controls");
  assert.equal(panel.querySelectorAll(".btn-primary").length, 1);
  for (const kind of ["secondary", "tertiary", "destructive"]) assert.ok(panel.querySelector(`.btn-${kind}`), kind);
  assert.equal(panel.querySelectorAll(".button-specimens .icon-button").length, 3);
  assert.equal(panel.querySelectorAll(".button-specimens [disabled]").length, 0, "no bare disabled button: nothing would say why");
  const settingRows = panel.querySelectorAll(".setting-row");
  assert.equal(settingRows.length, 6);
  const theme = settingRows[0].querySelector(".segmented");
  assert.equal(theme.getAttribute("role"), "radiogroup", "a choice of one value with no panels is a radio group");
  assert.deepEqual(theme.querySelectorAll("button").map((b) => [b.getAttribute("role"), b.getAttribute("aria-checked")]), [["radio", "true"], ["radio", "false"], ["radio", "false"]]);
  assert.ok(settingRows[1].querySelector(".select-field select"), "select");
  assert.ok(settingRows[2].querySelector(".switch[role=switch]"), "switch");
  // Settings' File names row: stacked text field and the fields you can add.
  assert.equal(settingRows[3].dataset.layout, "stack");
  assert.equal(settingRows[3].querySelector(".setting-name").textContent, "File names");
  const template = settingRows[3].querySelector('.field input[type="text"]');
  assert.equal(template.value, "{title}");
  assert.ok(template.hasAttribute("data-user-content"), "the typed template is user content");
  const chips = settingRows[3].querySelectorAll(".token-chips .btn-tertiary");
  assert.deepEqual(chips.map((chip) => chip.textContent), ["Title", "Site", "Type", "Resolution", "Date"]);
  click(chips[3]);
  assert.equal(template.value, "{title}{height}", "a field is added at the cursor");
  // Ignore files smaller than: KB, Settings' limits and default.
  assert.equal(settingRows[4].querySelector(".setting-name").textContent, "Ignore files smaller than");
  assert.equal(settingRows[4].querySelector(".field-unit").textContent, "KB", "number field with a unit");
  assert.equal(settingRows[4].querySelector("input").value, "512");
  assert.equal(settingRows[4].querySelector("input").max, "100000");
  assert.equal(settingRows[4].querySelector(".setting-description").textContent, "0 to 100,000. Skips icons and tiny clips.");
  // Connections per large file: 1 to 24, and the error line at rest for 32.
  assert.equal(settingRows[5].querySelector(".setting-name").textContent, "Connections per large file");
  assert.equal(settingRows[5].querySelector("input").max, "24");
  const error = settingRows[5].querySelector(".setting-error");
  assert.equal(error.hidden, false);
  assert.equal(error.textContent, "Use a number from 1 to 24.");
  const connections = settingRows[5].querySelector("input");
  connections.value = "12";
  connections.dispatchEvent(new Event("change"));
  assert.equal(error.hidden, true, "a value in range clears the error");
  connections.value = "25";
  connections.dispatchEvent(new Event("change"));
  assert.equal(error.hidden, false);
  assert.ok(panel.querySelectorAll(".setting-description").filter((d) => !d.hidden).every((d) => !/\n/.test(d.textContent) && d.textContent.length <= 60), "one line under a control at most");
  const links = panel.querySelectorAll("nav.nav .nav-item");
  assert.deepEqual(links.map((link) => link.dataset.navId), VIEW_IDS);
  assert.equal(panel.querySelector('.nav-item[aria-current="true"]').dataset.navId, "controls");
  // A modified click is left to the browser (a new tab); a plain click moves between views.
  const modified = new Event("click", { bubbles: true });
  modified.metaKey = true;
  links[3].dispatchEvent(modified);
  assert.equal(modified.defaultPrevented, undefined, "Cmd-click is not swallowed");
  assert.equal(panelOf("controls").hidden, false);
  click(links[3]);
  assert.equal(panelOf("rows").hidden, false);
  assert.match(env.urls.at(-1), /view=rows/);
  // The links follow the gallery's preferences.
  click(panelOf("controls").querySelectorAll(".setting-row")[0].querySelector('[data-value="dusk"]'));
  assert.match(links[0].href, /theme=dusk/);
  assert.match(links[0].href, /view=type/);
});

test("the gallery's own controls set theme, density and motion on the root and in the URL; v1 parameters still work", async () => {
  let env = await boot({ search: "?view=controls&theme=dark&density=compact&motion=reduced&demo=static" });
  const root = document.documentElement;
  assert.equal(root.dataset.theme, "dusk");
  assert.equal(root.dataset.density, "compact");
  assert.equal(root.dataset.motion, "reduced");
  assert.equal(root.dataset.demo, "static");
  const rowsOf = panelOf("controls").querySelectorAll(".setting-row");
  assert.equal(rowsOf[0].querySelector('[aria-checked="true"]').dataset.value, "dusk");
  assert.equal(rowsOf[2].querySelector(".switch").getAttribute("aria-checked"), "true");

  env = await boot({ search: "?view=controls" });
  const rowsNow = panelOf("controls").querySelectorAll(".setting-row");
  assert.equal(document.documentElement.dataset.theme, undefined, "Auto follows the system");
  click(rowsNow[0].querySelector('[data-value="morning"]'));
  assert.equal(document.documentElement.dataset.theme, "morning");
  assert.match(env.urls.at(-1), /theme=morning/);
  assert.equal(rowsNow[0].querySelector(".saved-note").textContent, "Saved", "inline Saved");
  assert.equal(rowsNow[0].querySelector('[data-value="morning"]').getAttribute("aria-checked"), "true", "the radios announce the choice");
  assert.equal(rowsNow[0].querySelector('[data-value="auto"]').getAttribute("aria-checked"), "false");
  const density = rowsNow[1].querySelector("select");
  density.value = "compact";
  density.dispatchEvent(new Event("change"));
  assert.equal(document.documentElement.dataset.density, "compact");
  assert.match(env.urls.at(-1), /density=compact/);
  click(rowsNow[2].querySelector(".switch"));
  assert.equal(document.documentElement.dataset.motion, "reduced");
  assert.match(env.urls.at(-1), /motion=reduced/);
});

test("Rows and progress: list header, media rows (media.js), the focus panel with parts map and speed line, live rows, history rows, status words", async () => {
  await boot({ search: "?view=rows&demo=static" });
  const panel = panelOf("rows");
  // The popup's view switch with its counts, first; not the popup's audit hook.
  const popupViews = panel.querySelector(".switch-specimen .segmented");
  assert.equal(panel.children[0].querySelector(".segmented"), popupViews);
  assert.equal(popupViews.getAttribute("role"), "radiogroup");
  assert.deepEqual(popupViews.querySelectorAll("button").map((b) => [b.querySelector("span").textContent, b.querySelector(".count").textContent, b.querySelector(".count").hidden]), [["Media", "3", false], ["Downloads", "5", false]]);
  assert.equal(panel.querySelectorAll("[data-view]").length, 0);
  // The selected row: the one whose menu Dialogs and menus shows.
  assert.deepEqual(panel.querySelectorAll(".row[data-selected]").map((row) => row.dataset.jobId), ["pv-h1"]);
  // The popup's header exactly as popup.js builds it: its own title, no count (the switch carries it).
  const header = panel.querySelector(".list-header");
  assert.equal(header.querySelector(".list-title > span").textContent, "Media on this page");
  assert.equal(header.querySelector(".list-count").hidden, true);
  assert.equal(header.querySelector(".list-count").textContent, "");
  // As in popup.js: Rescan is the one visible action; Download all and Clear results live in the overflow.
  assert.deepEqual(header.querySelectorAll(".list-actions .btn").map((b) => b.textContent), ["Rescan"]);
  const downloads = panel.querySelectorAll('[data-media-action="download"]');
  assert.equal(downloads.length, 3, "media rows carry the audit hook");
  const stream = panel.querySelector('.media-rows [data-item-id="pv-stream"]');
  assert.equal(stream.querySelector(".row-meta").textContent, "Stream · 1080p · 58:00 · Best");
  assert.match(stream.querySelector(".row-source").textContent, /^stream\.example\.com · /);
  const focus = panel.querySelectorAll(".focus-panel");
  assert.equal(focus.length, 1);
  // The same item looks the same in each place: the panel downloads the list's stream, with its glyph.
  assert.equal(focus[0].querySelector("[data-filename]").dataset.filename, "Keynote 2026.mp4");
  assert.equal(focus[0].querySelector(".row-lead svg").innerHTML, stream.querySelector(".row-lead svg").innerHTML, "stream glyph in the panel and the list");
  const lecture = panel.querySelector('.media-rows [data-item-id="pv-file"]');
  const finished = panel.querySelectorAll(".job-rows .row").find((row) => row.querySelector("[data-filename]")?.dataset.filename === "Lecture 12 · Pharmacokinetics.mp4");
  assert.ok(finished, "the list's file is the finished live row");
  assert.equal(finished.querySelector(".row-lead svg").innerHTML, lecture.querySelector(".row-lead svg").innerHTML, "video glyph in both places");
  assert.equal(focus[0].querySelector(".focus-details").open, true, "Details open");
  // An aggregate parts count draws no map (§6.8; it would repeat the bar): the count joins the speed line.
  assert.equal(focus[0].querySelector(".segment-map"), null);
  assert.ok(focus[0].querySelector(".speed-block > .speed-chart"));
  assert.match(focus[0].querySelector(".speed-block > .t-meta").textContent, /^\d+ of \d+ parts · Now .+ · Peak .+$/);
  assert.doesNotMatch(focus[0].querySelector(".row-meta").textContent, /parts/, "parts only inside Details");
  assert.equal(focus[0].querySelector(".progress").getAttribute("aria-valuenow"), "62");
  const states = panel.querySelectorAll(".job-rows .progress").map((bar) => bar.dataset.state);
  assert.deepEqual(states, ["paused", "queued", "finishing", "complete"], "the bar is the state's colour (v3 §3.2): a finishing job is ochre, not queued");
  const words = panel.querySelectorAll(".job-rows .row-meta .status").map((s) => s.textContent);
  assert.deepEqual(words, ["Paused", "Waiting", "Finishing", "Completed"]);
  assert.equal(panel.querySelectorAll(".job-rows .row-meta")[2].textContent, "Finishing", "no echo of the status word ('Finishing the file'), no 100%");
  const history = panel.querySelectorAll(".row[data-job-id]").filter((row) => row.dataset.jobId.startsWith("pv-h"));
  assert.equal(history.length, 4);
  const failed = panel.querySelector('[data-job-id="pv-h2"]');
  assert.doesNotMatch(failed.textContent, /HLS media segment/, "raw engine text is never shown");
  assert.match(failed.querySelector(".row-meta").textContent, /HTTP 403/);
  assert.deepEqual(panel.querySelectorAll(".group-label").map((label) => label.textContent), ["In progress", "Today", "Yesterday", "Status"]);
  assert.deepEqual(panel.querySelectorAll(".status-specimens .status").map((s) => s.dataset.tone), ["progress", "paused", "queued", "complete", "warning", "failed", "cancelled"]);
  assert.ok(panel.querySelectorAll("[data-filename]").every((name) => name.querySelector("[data-filename-tail]")), "every file name is middle-truncated");
});

test("Status and empty states: status lines with Set up, frozen toasts and confirmation, the empty state with the view's one primary", async () => {
  const env = await boot({ search: "?view=feedback&demo=static" });
  const panel = panelOf("feedback");
  // The empty state first, in the upper third; the pond layer behind the page shows around its text blocks.
  assert.equal(panel.children[1].classList.contains("empty-state"), true);
  assert.ok($("[data-pond]"), "the pond layer sits behind the page");
  const lines = panel.querySelectorAll(".status-line");
  assert.equal(lines.length, 5);
  assert.equal(lines[0].querySelector(".line-text > span").textContent, "Local engine isn’t set up");
  click(lines[0].querySelector(".line-actions .btn"));
  await settle(2);
  assert.deepEqual(env.created, ["chrome-extension://test/options/options.html#local-engine"], "Set up opens Settings on the local engine section");
  assert.deepEqual(lines[2].querySelectorAll(".line-actions .btn").map((b) => b.textContent), ["Retry", "Set up"]);
  const toasts = panel.querySelectorAll(".toast-specimens .toast");
  assert.deepEqual(toasts.map((t) => t.dataset.tone), ["success", "warning", "error"]);
  assert.ok(toasts.every((t) => !t.hasAttribute("role")), "copies at rest are not live regions");
  const confirm = panel.querySelector(".confirm-specimen .menu .confirm");
  assert.equal(confirm.querySelector("p").textContent, "Cancel this download?");
  assert.equal(confirm.querySelector("p").className, "t-row", "the question is the strongest text in its box");
  assert.deepEqual(confirm.querySelectorAll("button").map((b) => b.textContent), ["Keep", "Cancel download"]);
  assert.equal($("#menuLayer").hidden, true, "the floating layer closed again");
  const empty = panel.querySelector(".empty-state");
  assert.equal(empty.querySelector(".t-empty").textContent, "No downloadable media on this page yet.");
  assert.equal(empty.querySelector(".btn-primary").textContent, "Rescan");
  click($("#tab-rows"));
  assert.equal(panel.hidden, true, "another view hides the feedback view");
  click($("#tab-feedback"));
  assert.equal(panel.hidden, false);
});

test("Dialogs and menus: the Download dialog in link mode (input[type=url]) and item mode, shown in place, and the row overflow menu", async () => {
  const env = await boot({ search: "?view=overlays&demo=static" });
  const panel = panelOf("overlays");
  assert.equal(document.querySelectorAll("dialog").filter((d) => d.isConnected).length, 0, "no dialog element in the page, so nothing is modal");
  const shell = panel.querySelector(".dialog-shell.dialog-specimen");
  assert.equal(shell.querySelector(".dialog-head .t-title").textContent, "Download");
  assert.equal(shell.getAttribute("aria-labelledby"), shell.querySelector(".dialog-head h2").id);
  assert.equal(shell.getAttribute("aria-describedby"), "pvDialogLine");
  const stacks = () => shell.querySelectorAll(".field-stack").map((stack) => [stack.querySelector("label").textContent, stack.hidden]);
  const name = shell.querySelector("#pvDialogName");
  const format = shell.querySelector("#pvDialogFormat");
  const link = shell.querySelector("#pvDialogLink");
  // The mode switch: a radio group above the dialog, on Download a link.
  const modes = panel.querySelector(".switch-specimen .segmented");
  assert.equal(modes.getAttribute("role"), "radiogroup");
  assert.deepEqual(modes.querySelectorAll("button").map((b) => [b.dataset.value, b.querySelector("span").textContent, b.getAttribute("aria-checked")]), [["link", "Download a link", "true"], ["item", "Media on this page", "false"]]);
  // Link mode, as "Download a link" opens it: empty link, blank name, Original, no Quality.
  assert.equal(link.type, "url");
  assert.ok(visible(link), "the dialog has a visible input[type=url]");
  assert.equal(link.placeholder, "Paste a video or audio link");
  assert.deepEqual(stacks(), [["Link", false], ["File name", false], ["Format", false], ["Quality", true]]);
  assert.equal(name.value, "");
  assert.equal(name.placeholder, "Leave blank to name it automatically");
  assert.equal(format.value, "original");
  const actions = shell.querySelectorAll(".dialog-actions .btn");
  assert.deepEqual(actions.map((b) => b.textContent), ["Cancel", "Download"]);
  assert.ok(actions[1].classList.contains("btn-primary") && actions[1].type === "submit");
  assert.equal(panel.querySelectorAll(".btn-primary").filter(visible).length, 1, "the view's one primary");
  assert.ok(shell.querySelector(".dialog-line .line-dot[data-indicator]"), "the dialog's one status line");
  // A pasted stream link picks the stream format; an invalid link is caught on Download.
  link.value = "https://stream.example.com/keynote/master.m3u8";
  link.dispatchEvent(new Event("input"));
  assert.equal(format.value, "mp4");
  link.value = "not a link";
  link.dispatchEvent(new Event("input"));
  shell.querySelector("form").dispatchEvent(new Event("submit"));
  assert.equal(shell.querySelector(".dialog-line").dataset.tone, "failed");
  assert.equal(shell.querySelector(".dialog-line .line-text > span").textContent, "Enter a link that starts with http or https");
  assert.equal(shell.querySelector(".dialog-line").getAttribute("role"), "alert");
  assert.ok(shell.querySelector(".dialog-line .line-dot[data-indicator]"), "the dot stays an indicator after the line changes");
  // Cancel puts the dialog back to how it opened.
  click(actions[0]);
  assert.equal(link.value, "");
  assert.equal(format.value, "original");
  assert.equal(shell.querySelector(".dialog-line").dataset.tone, "");
  // Item mode: a detected stream after its quality probe.
  click(modes.querySelector('[data-value="item"]'));
  assert.match(env.urls.at(-1), /dialog=item/);
  assert.deepEqual(stacks(), [["Link", true], ["File name", false], ["Format", false], ["Quality", false]]);
  assert.equal(name.value, "Keynote 2026.mp4");
  assert.equal(format.value, "mp4");
  assert.deepEqual(shell.querySelector("#pvDialogQuality").querySelectorAll("option").map((o) => o.textContent).slice(0, 1), ["Best available"]);
  // Format follows into the file name, and Quality hides for MP3.
  format.value = "mkv";
  format.dispatchEvent(new Event("change"));
  assert.equal(name.value, "Keynote 2026.mkv");
  format.value = "mp3";
  format.dispatchEvent(new Event("change"));
  assert.equal(shell.querySelectorAll(".field-stack")[3].hidden, true);
  // The close button resets too.
  click(shell.querySelector(".dialog-close"));
  assert.equal(format.value, "mp4");
  assert.equal(name.value, "Keynote 2026.mp4");
  const items = panel.querySelectorAll(".menu-specimen .menu .menu-item");
  assert.deepEqual(items.map((item) => item.textContent), ["Show in Finder", "Open source page", "Copy link", "Remove from history"]);
  assert.equal(items[3].dataset.tone, "destructive");
  assert.ok(items.every((item) => !item.hasAttribute("role")) && !panel.querySelector(".menu-specimen .menu").hasAttribute("role"), "a copy at rest is not a live menu");
  assert.equal(panel.querySelector(".menu-specimen .menu").style.props.left, undefined, "laid into the page flow");
});

test("?dialog=item opens the dialog specimen in item mode; Controls' Download a link opens it in link mode", async () => {
  await boot({ search: "?view=overlays&dialog=item&demo=static" });
  assert.equal($("#pvDialogLink").closest(".field-stack").hidden, true);
  assert.equal($("#pvDialogName").value, "Keynote 2026.mp4");
  click($("#tab-controls"));
  click(panelOf("controls").querySelector('.button-specimens [data-action="link"]'));
  assert.equal(panelOf("overlays").hidden, false);
  assert.equal($("#pvDialogLink").closest(".field-stack").hidden, false, "the link field is shown");
  assert.equal($("#pvDialogName").value, "");
  assert.equal(panelOf("overlays").querySelector('.switch-specimen [data-value="link"]').getAttribute("aria-checked"), "true");
});

test("?demo=static freezes the live values: no timer, the demo at 62 %, the same text on every load", async () => {
  const snapshot = () => ({
    texts: visibleTexts(panelOf("rows"), { userContent: true }).map((t) => t.text),
    bars: panelOf("rows").querySelectorAll(".progress").map((bar) => `${bar.getAttribute("aria-valuenow")}:${bar.dataset.state}`)
  });
  const env = await boot({ search: "?view=rows&demo=static" });
  assert.equal(env.intervals.length, 0, "nothing ticks");
  assert.equal(document.documentElement.dataset.demo, "static");
  const first = snapshot();
  await boot({ search: "?view=rows&demo=static" });
  assert.deepEqual(snapshot(), first);
});

test("?demo=static: a confirmed Cancel restarts the demo live, as v1's Replay did", async () => {
  const env = await boot({ search: "?view=rows&demo=static" });
  assert.equal(env.intervals.length, 0);
  click(panelOf("rows").querySelector('.focus-panel [data-action="cancel"]'));
  click($("#menuLayer .confirm-actions .btn-destructive"));
  await settle(2);
  assert.equal(env.intervals.length, 1, "the demo runs again");
  const bar = () => panelOf("rows").querySelector(".focus-panel .progress");
  assert.equal(bar().getAttribute("aria-valuenow"), "0");
  for (let i = 0; i < 8; i += 1) env.intervals[0].fn();
  assert.ok(Number(bar().getAttribute("aria-valuenow")) > 0, "and moves");
});

test("live mode: the focus panel runs a simulated download; Pause, Resume and a confirmed Cancel steer it", async () => {
  const env = await boot({ search: "?view=rows" });
  assert.equal(env.intervals.length, 1);
  const tick = env.intervals[0].fn;
  const bar = () => panelOf("rows").querySelector(".focus-panel .progress");
  const before = Number(bar().getAttribute("aria-valuenow"));
  for (let i = 0; i < 8; i += 1) tick();
  assert.ok(Number(bar().getAttribute("aria-valuenow")) > before, "progress moves");
  const pause = panelOf("rows").querySelector('.focus-panel [data-action="pause"]');
  click(pause);
  const paused = bar().getAttribute("aria-valuenow");
  tick();
  assert.equal(bar().getAttribute("aria-valuenow"), paused, "paused holds");
  assert.equal(bar().dataset.state, "paused");
  click(panelOf("rows").querySelector('.focus-panel [data-action="resume"]'));
  click(panelOf("rows").querySelector('.focus-panel [data-action="cancel"]'));
  const stop = $("#menuLayer .confirm-actions .btn-destructive");
  assert.equal(stop.textContent, "Cancel download", "Cancel asks in place, with the same verb");
  click(stop);
  await settle(2);
  assert.equal(bar().getAttribute("aria-valuenow"), "0", "a stopped demo starts again");
  assert.equal($("#toastRegion").lastElementChild.textContent, "Download cancelled");
});

test("specimens open the real menus and toasts: row overflow, Copy link, the media Download", async () => {
  const env = await boot({ search: "?view=rows&demo=static" });
  click(panelOf("rows").querySelector('.media-rows [data-media-id="pv-file"][data-media-action="more"]'));
  assert.equal($("#menuLayer").hidden, false);
  const copy = $("#menuLayer .menu-item");
  assert.equal(copy.textContent, "Copy link");
  click(copy);
  await settle(2);
  assert.equal(env.copied, "https://cdn.example.com/lectures/lecture-12.mp4");
  assert.equal($("#toastRegion").lastElementChild.textContent, "Link copied");
  click(panelOf("rows").querySelector('[data-media-action="download"]'));
  assert.equal($("#toastRegion").lastElementChild.textContent, "Download started");
});

test("Chinese gallery: names and specimens in natural Chinese, page title from the Display list", async () => {
  await boot({ lang: "zh-CN", search: "?view=type&demo=static" });
  assert.equal($("#previewTitle").textContent, "组件");
  assert.deepEqual($$('#viewSwitch [role="tab"]').map((tab) => tab.querySelector("span").textContent), ["字体与品牌", "文字样式", "控件", "条目与进度", "状态与空状态", "对话框与菜单"]);
  assert.equal(panelOf("type").querySelector(".t-empty").textContent, "还没有下载。");
});
