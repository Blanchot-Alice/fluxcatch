// The toolbar popup on the v2 system (design review §6.12, §6.14): static
// checks on its sources, then the real popup.js run against popup.html in a
// small DOM with a stubbed chrome.*, since Chrome cannot run here.
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
class Text extends Node { constructor(v) { super(); this.data = String(v); } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
class Element extends Node {
  constructor(tag, ns) { super(); this.tagName = ns ? tag : tag.toUpperCase(); this.localName = tag.toLowerCase(); this.attributes = new Map(); this.style = { props: {}, setProperty(k, v) { this.props[k] = v; }, getPropertyValue(k) { return this.props[k] ?? ""; } }; this.value = ""; this._raw = null;
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
function installPage(htmlPath) {
  const doc = new Element("#document", true);
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (ns, tag) => new Element(tag, ns);
  doc.createTextNode = (v) => new Text(v);
  parseHtml(readFileSync(new URL(htmlPath, import.meta.url), "utf8"), doc);
  doc.documentElement = doc.querySelector("html");
  doc.head = doc.querySelector("head");
  doc.body = doc.querySelector("body");
  doc.activeElement = doc.body;
  doc.readyState = "complete";
  globalThis.document = doc;
  globalThis.Event = class Event { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } stopPropagation() { this.stopped = true; } preventDefault() { this.defaultPrevented = true; } };
  return doc;
}

// ---------- a stubbed chrome.* that answers like the worker ----------
function installChrome({ lang = "en-US", url = "https://example.com/watch", tab = null, items = [], jobs = [], hostStatus = { connected: false }, native = false, notifications = true, settings = { showNotifications: true, outputContainer: "mp4" }, probe = null, probeError = null, handlers = {} } = {}) {
  const sent = [];
  const created = [];
  const ports = [];
  const env = { sent, created, ports, closed: false, permissionRequests: [] };
  const answer = async (message) => {
    sent.push(message);
    if (handlers[message.type]) return handlers[message.type](message);
    switch (message.type) {
      case "GET_TAB_MEDIA": return { ok: true, items, settings, hostStatus };
      case "GET_JOBS": return { ok: true, jobs, hostStatus };
      case "GET_SETTINGS": return { ok: true, settings };
      case "PING_HOST": return { ok: true, hostStatus };
      case "PROBE_MANIFEST": return probeError ? { ok: false, error: probeError } : { ok: true, probe };
      default: return { ok: true };
    }
  };
  const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
  globalThis.chrome = {
    runtime: {
      id: "test",
      connect: () => { const port = { onMessage: event(), onDisconnect: event() }; ports.push(port); return port; },
      sendMessage: answer,
      openOptionsPage: async () => { created.push("options"); },
      getURL: (path) => `chrome-extension://test/${path}`,
      lastError: null
    },
    i18n: { getUILanguage: () => lang },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: event() },
    tabs: {
      query: async () => [tab || { id: 7, windowId: 3, url }],
      create: async ({ url: target }) => { created.push(target); },
      onActivated: event(),
      onUpdated: event()
    },
    permissions: {
      contains: async ({ permissions }) => (permissions.includes("nativeMessaging") ? native : notifications),
      request: async ({ permissions }) => { env.permissionRequests.push(permissions[0]); return true; },
      onAdded: event(),
      onRemoved: event()
    },
    sidePanel: { open: async () => { created.push("sidepanel"); } },
    downloads: { open: async () => {}, show: async () => {} }
  };
  globalThis.window = { addEventListener() {}, innerWidth: 372, innerHeight: 600, scrollY: 0, devicePixelRatio: 2, close: () => { env.closed = true; } };
  globalThis.location = { reload() {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (text) => { env.copied = text; } } }, configurable: true, writable: true });
  return env;
}

const settle = async (rounds = 6) => { for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 5)); };
/** Wait (up to 2 s) until the condition holds, so a loaded test runner does not race the page. */
const until = async (condition, timeout = 2000) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for the page");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await settle(2);
};

// ---------- helpers ----------
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CJK = /[㐀-鿿　-〿＀-￯]/;
const LATIN_OK = new Set(["fluxcatch", "finder", "chrome", "mp4", "mkv", "webm", "mp3", "m4a", "hls", "dash", "mb", "gb", "kb", "http", "https", "youtube", "instagram", "x"]);
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const click = (element) => element.dispatchEvent(new Event("click", { bubbles: true }));

function visible(element) {
  for (let e = element; e && e !== document; e = e.parentNode) {
    if (!(e instanceof Element)) continue;
    if (e.hidden || e.classList.contains("sr-only") || e.localName === "svg") return false;
    if (e.localName === "dialog" && !e.open) return false;
    if (e.classList.contains("menu-layer") && e.hidden) return false;
  }
  return true;
}
function visibleTexts(root = document.body, { userContent = false } = {}) {
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child instanceof Text) { if (child.data.trim()) out.push(child); continue; }
      if (!visible(child)) continue;
      if (!userContent && child.hasAttribute("data-user-content")) continue;
      walk(child);
    }
  };
  if (visible(root)) walk(root);
  return out.map((node) => node.data.trim());
}
const lineText = (selector) => $(selector).querySelector(".line-text > span")?.textContent || "";

let caseNumber = 0;
async function bootPopup({ ready = (env) => env.sent.some((message) => message.type === "PING_HOST"), ...options } = {}) {
  installPage("../extension/popup/popup.html");
  const env = installChrome(options);
  caseNumber += 1;
  await import(`../extension/popup/popup.js?case=${caseNumber}`);
  await until(() => ready(env));
  return env;
}

const NOW = Date.now();
const FILE = { id: "m1", kind: "video", displayUrl: "https://cdn.example.com/lecture.mp4", displayTitle: "Lecture 12 · Pharmacokinetics.mp4", contentLength: 812_000_000, copyable: true, generation: 2 };
const STREAM = { id: "m2", kind: "hls", displayUrl: "https://cdn.example.com/master.m3u8", displayTitle: "Keynote 2026", height: 1080, duration: 3480, recommended: true, generation: 2 };
const AUDIO = { id: "m3", kind: "audio", displayUrl: "https://cdn.example.com/keynote.m4a", displayTitle: "Keynote Highlights.m4a", contentLength: 48_300_000, copyable: true };
const READY_HOST = { connected: true, compatible: true, capabilities: { ffmpeg: { available: true, encoders: { libmp3lame: true } } } };
const LIVE_JOB = { jobId: "j1", status: "downloading", method: "native", filename: "Keynote 2026.mp4", progress: 0.4, bytes: 400_000_000, total: 1_000_000_000, speed: 5_000_000, pausable: true, createdAt: NOW - 5000, updatedAt: NOW };
const DONE_JOB = { jobId: "j2", status: "completed", method: "native", filename: "Keynote Highlights.m4a", total: 48_300_000, hasFile: true, hasSource: true, sourceHost: "example.com", createdAt: NOW - 90_000, updatedAt: NOW - 60_000 };

// ---------- static checks ----------
test("the popup is built on v2 only: no v1 stylesheets or UI modules, no copy in HTML, no literals", async () => {
  const html = read("extension/popup/popup.html");
  const js = read("extension/popup/popup.js");
  const css = read("extension/popup/popup.css") + read("extension/ui/v2/media.css");
  const order = ["../ui/v2/tokens.css", "../ui/v2/system.css", "../ui/v2/media.css", "popup.css"].map((href) => html.indexOf(`href="${href}"`));
  assert.ok(order.every((index) => index >= 0) && order.every((index, i) => i === 0 || order[i - 1] < index), "tokens, system, media, page in order");
  assert.doesNotMatch(html, /ui\/tokens\.css|ui\/components\.css|ui\/atmosphere\.css/, "no v1 stylesheets");
  assert.match(html, /<html[^>]*data-surface="popup"[^>]*data-density="compact"/);
  assert.ok(!CJK.test(html.replace(/<!--[\s\S]*?-->/g, "")), "copy comes from messages.js, not the HTML");
  assert.ok(!CJK.test(js), "no Chinese in the controller");
  assert.doesNotMatch(js, /from "\.\.\/ui\/(?:i18n|interactions|job-rows|speed-graph|customization)\.js"|job-presentation|friendlyJobMessage|friendlyDashMessage/, "no v1 UI modules or progress text");
  assert.doesNotMatch(js, /innerHTML|window\.confirm/, "DOM nodes and in-place confirmations only");
  assert.doesNotMatch(css, /border(-top|-bottom|-left|-right|-block|-inline)?(-width)?:\s*1px|\b0 0 0 1px\b/, "no 1px rules");
  assert.doesNotMatch(css, /text-transform:\s*uppercase|letter-spacing:\s*[1-9.]|font-style:\s*italic|monospace/, "no tracked caps, italics or monospace");
  const { scanColourLiterals } = await import("../scripts/design-audit.mjs");
  const literals = scanColourLiterals().filter((f) => f.file.startsWith("extension/popup/") || f.file === "extension/ui/v2/media.css" || f.file === "extension/ui/v2/media.js");
  assert.deepEqual(literals, [], "colour literals live only in tokens.css");
});

test("v1 safety rules carry over: opaque candidate references, strict trusted hosts, blocked HLS modes", () => {
  const media = read("extension/ui/v2/media.js");
  const surfaces = [read("extension/popup/popup.js"), read("extension/sidepanel/sidepanel.js"), media];
  assert.match(media, /return \{ id: item\?\.id, kind: item\?\.kind, generation: item\?\.generation \}/, "pages send opaque references");
  for (const source of surfaces) {
    assert.doesNotMatch(source, /candidate:\s*item\b/, "never the whole candidate");
    assert.doesNotMatch(source, /\bitem\.url\b/, "never a private media URL");
  }
  assert.match(media, /navigator\.clipboard\.writeText\(item\.displayUrl\)/, "Copy link copies the public URL only");
  assert.match(media, /item\.copyable === true/);
  assert.match(media, /hostname === "cdninstagram\.com"/);
  assert.match(media, /hostname\.endsWith\("\.fbcdn\.net"\)/);
  assert.match(media, /\/\\\.mp4\$\/i\.test\(url\.pathname\)/);
  assert.match(media, /url\.hostname\.toLowerCase\(\) === "video\.twimg\.com"/);
  for (const marker of ['probe.protection === "drm"', 'probe.type === "media" && probe.live', "probe.discontinuity"]) assert.ok(media.includes(marker), marker);
  assert.match(media, /item\.kind !== "youtube" \|\| Boolean\(BUILD_PROFILE\.features\.externalToolNetwork\)/);
});

// ---------- the running popup ----------
test("top bar: BrandMark S, then only Download a link (#urlButton) and Settings", async () => {
  await bootPopup({ items: [FILE] });
  const brand = $("#topbarInner [data-brandmark]");
  assert.ok(brand, "BrandMark in the top bar");
  assert.equal(brand.dataset.size, "s");
  const icons = $(".bar-actions").querySelectorAll("button");
  assert.deepEqual(icons.map((element) => element.id), ["urlButton", "settingsButton"]);
  assert.equal($("#urlButton").getAttribute("aria-label"), "Download a link");
  assert.equal($("#settingsButton").getAttribute("aria-label"), "Settings");
  assert.equal($("#topbarInner").querySelectorAll("button").length, 2, "nothing else in the bar (Rescan lives in the body)");
});

test("empty page: the empty state carries the view's one primary (Rescan); counts hidden; filter disabled", async () => {
  const env = await bootPopup({ items: [], jobs: [] });
  const tabs = $$('[role="tab"]');
  assert.deepEqual(tabs.map((tab) => tab.dataset.view), ["media", "downloads"]);
  assert.ok(tabs.every((tab) => tab.querySelector(".count").hidden), "count chips are hidden at 0");
  assert.equal($("#filterSelect").disabled, true, "nothing to filter");
  assert.equal($("#mediaHeaderSlot .list-header").hidden, true, "no list header without results");
  const empty = $("#mediaEmpty");
  assert.equal(visible(empty), true);
  assert.equal(empty.querySelector(".t-empty").textContent, "No downloadable media on this page yet.");
  const primaries = $$(".btn-primary").filter((element) => visible(element));
  assert.equal(primaries.length, 1, "one primary per view");
  assert.equal(primaries[0], empty.querySelector("button"));
  assert.equal(primaries[0].textContent, "Rescan");
  click(primaries[0]);
  // Rescan waits 450 ms for the page to answer, then reads the media again.
  await until(() => env.sent.filter((message) => message.type === "GET_TAB_MEDIA").length === 2);
  assert.ok(env.sent.some((message) => message.type === "SCAN_TAB" && message.tabId === 7));
});

test("media rows: a glyph lead, the name middle-truncated, one meta line, the source line, a tertiary Download; no chips", async () => {
  await bootPopup({ items: [FILE, STREAM, { ...AUDIO, lastSeen: Date.now() - 5 * 60_000 }] });
  const rows = $$("#mediaRows > li.row");
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.querySelector(".row-meta").textContent), ["MP4 · 812 MB", "Stream · 1080p · 58:00 · Best", "M4A · 48.3 MB"]);
  for (const row of rows) {
    assert.ok(row.querySelector(".row-lead > svg") && !row.querySelector("img"), "a 20px glyph, never a poster in the popup");
    assert.equal(row.querySelectorAll(".row-main > p").length, 3, "title, one meta line, the source line (§6.4)");
    const host = row.querySelector(".row-source [data-user-content]");
    assert.equal(host.textContent, "cdn.example.com", "the media's host is user content");
    assert.ok(row.querySelector(".row-title [data-filename]"), "the name is a middle-truncated filename");
    const download = row.querySelector('button[data-media-action="download"]');
    assert.ok(download.classList.contains("btn-tertiary"));
    assert.equal(download.textContent, "Download");
  }
  assert.equal(rows[2].querySelector(".row-source").textContent, "cdn.example.com · 5 min. ago", "the age follows locale.js");
  assert.equal(rows[0].querySelector(".row-source").textContent, "cdn.example.com", "no age when the worker sent none");
  assert.equal($$(".chip").length, 0, "no chips at all");
  assert.doesNotMatch(document.body.textContent, /Multi-connection|Pick/);
  assert.ok(rows[0].querySelector('button[data-media-action="more"]'), "Copy link lives in the row overflow");
  assert.equal(rows[1].querySelector('button[data-media-action="more"]'), null, "nothing to copy for this stream");
  // Every Download ends on one right edge: a row without the overflow keeps its slot.
  const slot = rows[1].querySelector(".row-actions .icon-slot");
  assert.ok(slot && slot.getAttribute("aria-hidden") === "true" && !slot.textContent, "an inert slot in place of the overflow");
  assert.equal(rows[1].querySelector(".row-actions").lastElementChild, slot);
  assert.equal(rows[0].querySelector(".row-actions .icon-slot"), null, "a row with the overflow needs no slot");
  assert.ok(rows.every((row) => row.querySelector(".row-actions").children.length === 2), "Download plus one overflow-sized cell on every row");
  assert.equal($("#filterSelect").disabled, false);
  const counts = $$('[role="tab"] .count');
  assert.equal(counts[0].textContent, "3");
});

test("the list header is the side panel's: Rescan and an overflow with Download all and Clear results (confirmed)", async () => {
  const env = await bootPopup({ items: [FILE, AUDIO] });
  const header = $("#mediaHeaderSlot .list-header");
  assert.equal(header.hidden, false);
  assert.equal(header.querySelector(".list-title").textContent.trim(), "Media on this page");
  const actions = header.querySelector(".list-actions").children;
  assert.deepEqual(actions.map((element) => element.dataset.action), ["rescan", "more"]);
  assert.ok(actions[0].classList.contains("btn-tertiary"));
  assert.equal($$(".list-header .btn-destructive").length, 0, "no destructive link beside Rescan");
  click(actions[1]);
  const menuItems = $$("#menuLayer .menu-item");
  assert.deepEqual(menuItems.map((element) => element.textContent), ["Download all", "Clear results"]);
  assert.equal(menuItems[1].dataset.tone, "destructive");
  click(menuItems[1]);
  await settle(2);
  const confirm = $("#menuLayer .confirm");
  assert.ok(confirm && !$("#menuLayer").hidden, "Clear results asks in place");
  click(confirm.querySelector(".btn-destructive"));
  await settle(20);
  assert.ok(env.sent.some((message) => message.type === "CLEAR_TAB" && message.tabId === 7));
  assert.ok(env.sent.some((message) => message.type === "CLEAR_COMPLETED_JOBS"));

  const second = await bootPopup({ items: [FILE, AUDIO], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD_BATCH: () => ({ ok: true, started: 2, failed: 0 }) } });
  click($('#mediaHeaderSlot [data-action="more"]'));
  const item = $("#menuLayer .menu-item");
  assert.equal(item.textContent, "Download all");
  click(item);
  await settle(20);
  const batch = second.sent.find((message) => message.type === "DOWNLOAD_BATCH");
  assert.deepEqual(batch.candidates, [{ id: "m1", kind: "video", generation: 2 }, { id: "m3", kind: "audio", generation: undefined }]);
  assert.equal($('[role="tab"][data-view="downloads"]').getAttribute("aria-selected"), "true");
});

test("Download probes a stream's qualities, then opens the Download dialog", async () => {
  const env = await bootPopup({ items: [STREAM], probe: { kind: "hls", type: "master", variants: [{ url: "sel-1", height: 1080, bandwidth: 5_000_000 }, { url: "sel-2", height: 720 }] } });
  click($('#mediaRows button[data-media-action="download"]'));
  await until(() => $("#downloadDialog").open);
  assert.ok(env.sent.some((message) => message.type === "PROBE_MANIFEST" && message.candidate.id === "m2"));
  const dialog = $("#downloadDialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector(".dialog-head .t-title").textContent, "Download");
  assert.equal(dialog.querySelectorAll('input[type="checkbox"]').length, 0, "no trusted-direct-links checkbox");
  assert.doesNotMatch(dialog.textContent, /Permission|permission/, "no permission note");
  assert.equal(dialog.querySelectorAll(".btn-primary").length, 1, "one primary");
  assert.deepEqual(dialog.querySelector(".dialog-actions").children.map((element) => element.textContent), ["Cancel", "Download"]);
  const format = $("#mediaFormat");
  assert.equal(format.value, "mp4");
  assert.ok(format.options.find((option) => option.value === "original").disabled, "streams are never saved as original");
  const quality = $("#mediaQuality");
  assert.equal(visible(quality), true);
  assert.deepEqual(quality.options.map((option) => option.textContent), ["Best available", "1080p · 5 Mb/s", "720p"]);
  assert.equal(visible($("#mediaLink")), false, "no link field for a detected item");
});

test("a failed quality probe still opens the dialog (v1 threw on a bare probeError)", async () => {
  await bootPopup({ items: [STREAM], probeError: "HTTP 403", native: true, hostStatus: READY_HOST });
  click($('#mediaRows button[data-media-action="download"]'));
  await until(() => $("#downloadDialog").open);
  assert.equal(lineText("#mediaDialogLine"), "Couldn’t read qualities; the best one will be used.");
  assert.doesNotMatch($("#downloadDialog").textContent, /403/, "raw probe text is never shown");
});

test("a blocked stream disables Download and says why in the one line", async () => {
  await bootPopup({ items: [STREAM], probe: { kind: "hls", type: "media", live: true, variants: [] } });
  click($('#mediaRows button[data-media-action="download"]'));
  await until(() => $("#downloadDialog").open);
  assert.equal(lineText("#mediaDialogLine"), "Live streams can’t be saved yet.");
  assert.equal($("#downloadDialog .btn-primary").disabled, true);
});

test("the dialog sends the v1 message shape and shows the new download", async () => {
  const env = await bootPopup({ items: [FILE], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD: () => ({ ok: true, method: "native", jobId: "j9" }) } });
  click($('#mediaRows button[data-media-action="download"]'));
  await settle();
  assert.equal($("#mediaName").value, "Lecture 12 · Pharmacokinetics.mp4");
  assert.equal($("#mediaFormat").value, "original");
  assert.equal(visible($("#mediaQuality")), false, "no quality without variants");
  $("#downloadDialog form").dispatchEvent(new Event("submit"));
  await until(() => !$("#downloadDialog").open);
  assert.deepEqual(env.permissionRequests, ["nativeMessaging"], "the engine permission is asked on the click");
  const start = env.sent.find((message) => message.type === "DOWNLOAD");
  assert.equal(start.tabId, 7);
  assert.deepEqual(start.candidate, { id: "m1", kind: "video", generation: 2 });
  assert.deepEqual(Object.keys(start.options).sort(), ["convert", "extractAudio", "filename", "outputContainer", "outputFormat", "useNativeForDirect", "variantUrl"]);
  assert.equal(start.options.convert, false);
  assert.equal($("#downloadDialog").open, false);
  assert.equal($('[role="tab"][data-view="downloads"]').getAttribute("aria-selected"), "true", "a native start shows the Downloads view");
  assert.equal($("#downloadsView").hidden, false);
  await settle(2);
  assert.equal(document.activeElement, $('[role="tab"][data-view="downloads"]'), "focus follows the new download, not the hidden row");
});

test("a worker error reaches the dialog line through errors.js, never as raw text", async () => {
  await bootPopup({ items: [FILE], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD: () => ({ ok: false, error: "Traceback: socket.timeout at /Users/me/x.py", code: "network_timeout" }) } });
  click($('#mediaRows button[data-media-action="download"]'));
  await settle();
  $("#downloadDialog form").dispatchEvent(new Event("submit"));
  await until(() => $("#mediaDialogLine").getAttribute("role") === "alert");
  const text = lineText("#mediaDialogLine");
  assert.ok(text && !/Traceback|\/Users/.test(text), `localised from the code: ${text}`);
  assert.equal($("#mediaDialogLine").getAttribute("role"), "alert");
  assert.equal($("#downloadDialog").open, true);
});

test("Download a link: #urlButton opens the dialog with an input[type=url]", async () => {
  const env = await bootPopup({ items: [], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD_URL: () => ({ ok: true, method: "native", jobId: "j5" }) } });
  click($("#urlButton"));
  await settle(2);
  const dialog = $("#downloadDialog");
  assert.equal(dialog.open, true);
  const link = dialog.querySelector('input[type="url"]');
  assert.ok(link && visible(link));
  assert.equal(document.activeElement, link);
  link.value = "not a link";
  dialog.querySelector("form").dispatchEvent(new Event("submit"));
  await settle(2);
  assert.equal(lineText("#mediaDialogLine"), "Enter a link that starts with http or https");
  link.value = "https://media.example.com/show/episode.m3u8";
  link.dispatchEvent(new Event("input"));
  assert.equal($("#mediaFormat").value, "mp4", "a pasted stream picks a container");
  dialog.querySelector("form").dispatchEvent(new Event("submit"));
  await until(() => env.sent.some((message) => message.type === "DOWNLOAD_URL"));
  const sent = env.sent.find((message) => message.type === "DOWNLOAD_URL");
  assert.equal(sent.url, "https://media.example.com/show/episode.m3u8");
  assert.equal(sent.tabId, 7);
  assert.equal("filename" in sent.options, false, "a blank name lets the engine name the file");
});

test("the local engine is one status line with Set up, which opens Settings at #local-engine", async () => {
  const env = await bootPopup({ items: [FILE], native: false });
  assert.equal(lineText("#engineLine"), "Local engine isn’t set up");
  const setUp = $("#engineLine .line-actions button");
  assert.equal(setUp.textContent, "Set up");
  click(setUp);
  await settle();
  assert.ok(env.created.some((url) => String(url).endsWith("options/options.html#local-engine")));
  assert.equal(env.closed, true);
  assert.equal($$(".status-line").filter((element) => visible(element) && !element.closest("dialog")).length, 1, "one line, no explanation");

  await bootPopup({ items: [FILE], native: true, hostStatus: READY_HOST });
  assert.equal($("#engineLine").hidden, true, "a ready engine needs no line");
});

test("Downloads view: compact rows.js rows; live rows Pause and Cancel (confirmed), finished rows Open and an overflow", async () => {
  const env = await bootPopup({ items: [FILE], jobs: [LIVE_JOB, DONE_JOB], native: true, hostStatus: READY_HOST });
  click($('[role="tab"][data-view="downloads"]'));
  assert.equal($("#filterSelect").disabled, false, "the filter stays and filters the downloads too");
  assert.equal($("#viewBar").children.length, 2, "the same neighbours in both views");
  const rows = $$("#jobRows > li.row");
  assert.equal(rows.length, 2);
  const [live, done] = rows;
  assert.ok(live.hasAttribute("data-live") && live.querySelector(".progress"));
  assert.deepEqual(live.querySelectorAll(".row-actions button").map((element) => element.dataset.action), ["pause", "cancel"]);
  // Compact live meta: percent, time left, speed; the size stays out so the line fits at 372.
  assert.equal(live.querySelector(".row-meta").textContent, "Downloading40% · 2:00 left · 5.0 MB/s");
  assert.deepEqual(done.querySelectorAll(".row-actions button").map((element) => element.dataset.action), ["open", "more"]);
  assert.equal(done.querySelector(".status"), null, "completed rows carry no status");
  click(live.querySelector('[data-action="cancel"]'));
  assert.ok($("#menuLayer .confirm"), "Cancel asks first");
  click($("#menuLayer .confirm .btn-destructive"));
  await settle(10);
  assert.ok(env.sent.some((message) => message.type === "CANCEL_JOB" && message.jobId === "j1"));
  click(done.querySelector('[data-action="more"]'));
  assert.deepEqual($$("#menuLayer .menu-item").map((element) => element.textContent), ["Show in Finder", "Open source page", "Remove from history"]);
  assert.equal($$('[role="tab"] .count')[1].textContent, "2");
});

test("engine progress text reaches the rows only through describeJobActivity", async () => {
  await bootPopup({ jobs: [{ ...LIVE_JOB, total: 0, bytes: 0, speed: 0, status: "remuxing", message: "正在无损合并 DASH 音视频" }] });
  click($('[role="tab"][data-view="downloads"]'));
  const meta = $("#jobRows .row-meta").textContent;
  assert.match(meta, /Joining picture and sound/);
  assert.ok(!CJK.test(meta));
});

test("footer: Open workspace and All downloads as tertiary links; Folder is gone", async () => {
  const env = await bootPopup({ items: [FILE] });
  const links = $("#footer").querySelectorAll("button");
  assert.deepEqual(links.map((element) => element.textContent), ["Open workspace", "All downloads"]);
  assert.ok(links.every((element) => element.classList.contains("btn-tertiary")));
  assert.doesNotMatch(document.body.textContent, /Folder/);
  click(links[0]);
  await settle();
  assert.ok(env.created.includes("sidepanel"));
  assert.equal(env.closed, true);
  const second = await bootPopup({ items: [FILE] });
  click($("#historyButton"));
  await settle();
  assert.ok(second.sent.some((message) => message.type === "OPEN_DOWNLOADS_PAGE"));
});

test("a page FluxCatch cannot read says so plainly and offers no Rescan", async () => {
  const env = await bootPopup({ url: "chrome://newtab/" });
  assert.equal($("#mediaEmpty .t-empty").textContent, "FluxCatch can’t read this page.");
  assert.equal($("#mediaEmpty button").hidden, true);
  assert.ok(env.sent.some((message) => message.type === "GET_SETTINGS"));
  assert.ok(!env.sent.some((message) => message.type === "GET_TAB_MEDIA"));
});

test("locale: no CJK in the English UI and no stray Latin words in the Chinese UI", async () => {
  await bootPopup({ items: [FILE, STREAM], jobs: [LIVE_JOB, DONE_JOB], native: false });
  for (const text of visibleTexts()) assert.ok(!CJK.test(text), `English UI: ${text}`);
  await bootPopup({ lang: "zh-CN", items: [FILE, STREAM], jobs: [LIVE_JOB, DONE_JOB], native: false });
  assert.equal(document.documentElement.lang, "zh-CN");
  const words = [];
  for (const view of ["media", "downloads"]) {
    click($(`[role="tab"][data-view="${view}"]`));
    for (const text of visibleTexts()) {
      const stripped = text.replace(/\b\d+(\.\d+)?\s?(k|m|g|t)?i?b(\/s)?\b/gi, " ").replace(/\b\d+p\b/gi, " ");
      words.push(...(stripped.match(/[A-Za-z][A-Za-z0-9]+/g) || []).filter((word) => !LATIN_OK.has(word.toLowerCase())));
    }
  }
  assert.deepEqual(words, [], "Chinese UI has no Latin UI words");
  assert.equal($("#urlButton").getAttribute("aria-label"), "粘贴链接下载");
});

test("status changes are announced once per job, and a same-name retry is still announced", async () => {
  await bootPopup({});
  const { createJobList } = await import("../extension/ui/v2/media.js");
  const announcer = document.createElement("div");
  const list = document.createElement("ul");
  document.body.append(announcer, list);
  const menus = { confirm: async () => false, openItems() {} };
  const jobs = createJobList({ list, menus, toast() {}, onError() {}, announcer });
  const first = { jobId: "job-a", filename: "Same name.mp4", status: "failed" };
  jobs.upsert({ ...first, status: "downloading" });
  await settle(1);
  jobs.upsert(first);
  await settle(1);
  assert.equal(announcer.textContent, "Same name.mp4: Failed");
  announcer.textContent = "";
  jobs.upsert(first);
  await settle(1);
  assert.equal(announcer.textContent, "", "the port and catch race for one job is idempotent");
  jobs.upsert({ ...first, jobId: "job-b" });
  await settle(1);
  assert.equal(announcer.textContent, "Same name.mp4: Failed", "a retry with the same name is announced");
});

test("a language switch in Settings rebuilds the popup's copy in place", async () => {
  await bootPopup({ items: [FILE], jobs: [DONE_JOB] });
  assert.equal($('[role="tab"][data-view="media"] span').textContent, "Media");
  for (const listener of chrome.storage.onChanged.listeners) listener({ "fluxcatch.uiLanguage.v1": { newValue: "zh" } }, "local");
  await settle(2);
  assert.equal(document.documentElement.lang, "zh-CN");
  assert.equal($('[role="tab"][data-view="media"] span').textContent, "媒体");
  assert.equal($("#urlButton").getAttribute("aria-label"), "粘贴链接下载");
  assert.equal($("#mediaRows .row-meta").textContent, "MP4 · 812 MB");
  assert.equal($('#mediaRows button[data-media-action="download"]').textContent, "下载");
  assert.equal($("#workspaceButton").textContent, "打开工作台");
  assert.equal($$('[role="tab"]').length, 2, "rebuilt, not duplicated");
  assert.equal($$("#topbarInner [data-brandmark]").length, 1);
  for (const listener of chrome.storage.onChanged.listeners) listener({ "fluxcatch.uiLanguage.v1": { newValue: "en" } }, "local");
});

// ---------- review fixes ----------
test("while the Download dialog is open the empty state behind the scrim steps out (six styles, one primary)", () => {
  const css = read("extension/ui/v2/system.css");
  assert.match(css, /:root:has\(\.dialog-shell\[open\]\) \.empty-state \{\s*visibility: hidden;/);
  assert.doesNotMatch(read("extension/ui/v2/media.css"), /\.empty-state/, "one copy, in system.css next to the popup dialog rule");
});

test("the pond zone of an empty state stays inside its section, never above it", async () => {
  await bootPopup({ items: [] });
  const { pondZones } = await import("../extension/ui/v2/media.js");
  const section = $("#mediaEmpty");
  const sentence = section.querySelector(".t-empty");
  section.getBoundingClientRect = () => ({ left: 60, top: 140, right: 356, bottom: 300, width: 296, height: 160 });
  sentence.getBoundingClientRect = () => ({ left: 60, top: 172, right: 356, bottom: 198, width: 296, height: 26 });
  sentence.getClientRects = () => [1];
  const column = { getBoundingClientRect: () => ({ left: 16, right: 356 }) };
  const zones = pondZones(column, sentence);
  const empty = zones[2];
  assert.equal(empty.y, 140, "starts at the section, not 70 px above the sentence");
  assert.equal(empty.y + empty.height, 300, "ends with the section");
  assert.ok(empty.x + empty.width <= window.innerWidth);
  assert.equal(empty.x + empty.width, Math.min(window.innerWidth, 480), "popup-sized by default");
  const wide = pondZones(column, sentence, { width: 560 })[2];
  assert.equal(wide.x, 20);
  assert.equal(wide.width, Math.min(window.innerWidth, 580) - 20, "a full page passes its own width");
});

test("a nameless download reads \"Untitled media\" in the UI language, never a hard-coded word", async () => {
  await bootPopup({ jobs: [] });
  const { createJobList, readableMediaTitle, defaultFilename } = await import("../extension/ui/v2/media.js");
  const list = document.createElement("ul");
  document.body.append(list);
  const jobs = createJobList({ list, menus: { confirm: async () => false, openItems() {} }, toast() {}, onError() {} });
  jobs.upsert({ jobId: "n1", status: "queued", progress: 0 });
  assert.equal(list.querySelector(".row-title [data-filename]").dataset.filename, "Untitled media");
  assert.equal(readableMediaTitle({ displayUrl: "https://cdn.example.com/" }), "Untitled media");
  assert.equal(defaultFilename({ displayUrl: "https://cdn.example.com/", kind: "hls" }, "mp4"), "media.mp4", "a written filename stays neutral");
  await bootPopup({ lang: "zh-CN", jobs: [] });
  const zh = await import("../extension/ui/v2/media.js");
  assert.equal(zh.readableMediaTitle({ displayUrl: "https://cdn.example.com/" }), "未命名媒体");
});

test("a failed start that already became a job is announced before focus moves to Downloads", async () => {
  let failedJob = null;
  await bootPopup({
    items: [FILE],
    native: true,
    hostStatus: READY_HOST,
    handlers: {
      DOWNLOAD: () => { failedJob = { jobId: "jf", status: "failed", method: "native", filename: "Lecture 12.mp4", createdAt: Date.now(), updatedAt: Date.now() }; return { ok: false, error: "", code: "network_timeout", jobId: "jf" }; },
      GET_JOBS: () => ({ ok: true, jobs: failedJob ? [failedJob] : [], hostStatus: READY_HOST })
    }
  });
  click($('#mediaRows button[data-media-action="download"]'));
  await settle();
  $("#downloadDialog form").dispatchEvent(new Event("submit"));
  await until(() => !$("#downloadDialog").open);
  await settle(2);
  assert.equal($("#announcer").textContent, "Lecture 12.mp4: Failed");
  assert.equal($('[role="tab"][data-view="downloads"]').getAttribute("aria-selected"), "true");
});

test("Rescan says the page could not be read instead of \"Scan finished\"", async () => {
  let fail = false;
  await bootPopup({ items: [FILE], handlers: { GET_TAB_MEDIA: () => (fail ? { ok: false, error: "tab gone" } : { ok: true, items: [FILE], settings: {}, hostStatus: {} }) } });
  fail = true;
  click($('#mediaHeaderSlot [data-action="rescan"]'));
  await until(() => $("#toastRegion").children.length > 0);
  const toasts = $("#toastRegion").children.map((element) => `${element.dataset.tone}:${element.textContent}`);
  assert.deepEqual(toasts, ["error:Couldn’t read this page"]);
});

test("the dialog's Download stays disabled while its start is in flight, even when the engine status arrives", async () => {
  let release;
  const env = await bootPopup({ items: [FILE], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD: () => new Promise((resolve) => { release = resolve; }) } });
  click($('#mediaRows button[data-media-action="download"]'));
  await settle();
  $("#downloadDialog form").dispatchEvent(new Event("submit"));
  await until(() => env.sent.some((message) => message.type === "DOWNLOAD"));
  for (const port of env.ports) for (const listener of port.onMessage.listeners) listener({ type: "HOST_EVENT", hostStatus: READY_HOST });
  const submit = $("#downloadDialog .btn-primary");
  assert.equal(submit.disabled, true, "disabled while DOWNLOAD is in flight");
  assert.equal(submit.getAttribute("aria-busy"), "true");
  release({ ok: true, method: "browser" });
  await until(() => !$("#downloadDialog").open);
});

test("Notifications are off shows in Downloads beside an engine line, so users without the engine can turn them on", async () => {
  const env = await bootPopup({ items: [FILE], native: false, notifications: false });
  click($('[role="tab"][data-view="downloads"]'));
  assert.equal(lineText("#engineLine"), "Local engine isn’t set up");
  assert.equal(lineText("#jobsState"), "Notifications are off");
  assert.deepEqual($("#jobsState .line-actions").children.map((element) => element.textContent), ["Turn on", "Don’t notify me"]);
  click($("#jobsState .line-actions button"));
  await settle();
  assert.ok(env.permissionRequests.includes("notifications"));
  assert.equal($("#jobsState").hidden, true);
  click($('[role="tab"][data-view="media"]'));
  assert.equal(visible($("#jobsState")), false, "only in the Downloads view");
});

test("a permission granted in Settings rechecks the engine instead of keeping \"not set up\"", async () => {
  let native = false;
  const env = await bootPopup({ items: [FILE], hostStatus: { connected: false, needsPermission: true }, handlers: { PING_HOST: () => ({ ok: true, hostStatus: native ? READY_HOST : { connected: false, needsPermission: true } }) } });
  assert.equal(lineText("#engineLine"), "Local engine isn’t set up");
  const pings = env.sent.filter((message) => message.type === "PING_HOST").length;
  native = true;
  chrome.permissions.contains = async ({ permissions }) => (permissions.includes("nativeMessaging") ? true : true);
  for (const listener of chrome.permissions.onAdded.listeners) listener({ permissions: ["nativeMessaging"] });
  await until(() => env.sent.filter((message) => message.type === "PING_HOST").length > pings);
  assert.equal($("#engineLine").hidden, true, "the fresh status clears the line");
});

test("a quality probe is announced while it runs", async () => {
  let release;
  await bootPopup({ items: [STREAM], handlers: { PROBE_MANIFEST: () => new Promise((resolve) => { release = resolve; }) } });
  click($('#mediaRows button[data-media-action="download"]'));
  await settle(2);
  assert.equal($("#announcer").textContent, "Reading qualities…");
  release({ ok: true, probe: { kind: "hls", type: "master", variants: [] } });
  await until(() => $("#downloadDialog").open);
});

test("the first data load never waits for the pond's paint", () => {
  for (const file of ["extension/popup/popup.js", "extension/sidepanel/sidepanel.js"]) {
    assert.doesNotMatch(read(file), /await mountPond/, file);
  }
});

test("an idle worker's disconnect reconnects and resyncs; only a worker that never answers shows the Reload line", async () => {
  const env = await bootPopup({ items: [FILE], jobs: [] });
  const jobsBefore = env.sent.filter((message) => message.type === "GET_JOBS").length;
  for (const listener of env.ports[0].onDisconnect.listeners) listener();
  await until(() => env.ports.length === 2 && env.sent.filter((message) => message.type === "GET_JOBS").length > jobsBefore);
  assert.notEqual(lineText("#engineLine"), "FluxCatch stopped responding");
  assert.equal(env.ports[1].onMessage.listeners.length, 1, "the new port carries the broadcasts");

  const { connectWorkerPort } = await import("../extension/ui/v2/runtime.js");
  let lost = 0;
  let opened = 0;
  chrome.runtime.connect = () => { opened += 1; if (opened > 1) throw new Error("Extension context invalidated."); return { onMessage: { addListener() {} }, onDisconnect: { addListener(fn) { chrome.__drop = fn; } } }; };
  connectWorkerPort({ name: "fluxcatch-popup", onMessage() {}, onReconnect: async () => true, onLost: () => { lost += 1; }, delays: [1, 1] });
  chrome.__drop();
  await until(() => lost === 1);
  assert.equal(opened, 3, "two attempts, then the loss is reported once");

  let answers = 0;
  const ports = [];
  chrome.runtime.connect = () => { const port = { onMessage: { addListener() {} }, onDisconnect: { addListener(fn) { port.drop = fn; } }, disconnect() { port.closed = true; } }; ports.push(port); return port; };
  let lostAgain = 0;
  connectWorkerPort({ name: "fluxcatch-popup", onMessage() {}, onReconnect: async () => { answers += 1; return false; }, onLost: () => { lostAgain += 1; }, delays: [1, 1] });
  ports[0].drop();
  await until(() => lostAgain === 1);
  assert.equal(answers, 2, "a resync that finds no worker counts as a failed attempt");
  assert.ok(ports.slice(0, -1).every((port) => port.closed), "one live port at a time");
});

// ---------- design audit pass 2 ----------
test("the type filter describes the list under it: it filters Downloads too, and resets when a list is empty", async () => {
  const STREAM_JOB = { jobId: "j4", status: "completed", method: "native", kind: "hls", filename: "Keynote 2026 stream.mp4", hasFile: true, createdAt: NOW - 80_000, updatedAt: NOW - 70_000 };
  await bootPopup({ items: [FILE, AUDIO], jobs: [LIVE_JOB, DONE_JOB, STREAM_JOB], native: true, hostStatus: READY_HOST });
  click($('[role="tab"][data-view="downloads"]'));
  const filter = $("#filterSelect");
  assert.equal(filter.disabled, false, "there are downloads to filter");
  const shownJobs = () => $$("#jobRows > li.row").filter((row) => !row.hidden).map((row) => row.dataset.jobId);
  assert.deepEqual(shownJobs().sort(), ["j1", "j2", "j4"]);
  filter.value = "audio";
  filter.dispatchEvent(new Event("change"));
  assert.deepEqual(shownJobs(), ["j2"], "by the kind the row's glyph shows (an audio file name)");
  filter.value = "stream";
  filter.dispatchEvent(new Event("change"));
  assert.deepEqual(shownJobs(), ["j4"]);
  filter.value = "video";
  filter.dispatchEvent(new Event("change"));
  assert.deepEqual(shownJobs(), ["j1"]);
  assert.equal($$('[role="tab"] .count')[1].textContent, "3", "the tab still counts every download");
  // The same filter applies on Media.
  click($('[role="tab"][data-view="media"]'));
  assert.deepEqual($$("#mediaRows > li.row").map((row) => row.dataset.itemId), ["m1"]);

  // A filter that hides every download says so, with no Display of its own besides that sentence.
  await bootPopup({ items: [FILE], jobs: [LIVE_JOB], native: true, hostStatus: READY_HOST });
  const again = $("#filterSelect");
  again.value = "audio";
  again.dispatchEvent(new Event("change"));
  click($('[role="tab"][data-view="downloads"]'));
  assert.equal($("#jobRows").hidden, true);
  assert.equal($("#jobsEmpty .t-empty").textContent, "No downloads of this type.");
  assert.equal($("#jobsEmpty .t-body").textContent, "Choose another type.");
  assert.equal(again.value, "audio", "the control names the filter that hides the list");

  // No downloads at all: nothing to filter, so the control is disabled on All types.
  await bootPopup({ items: [FILE, AUDIO], jobs: [] });
  const third = $("#filterSelect");
  third.value = "audio";
  third.dispatchEvent(new Event("change"));
  click($('[role="tab"][data-view="downloads"]'));
  assert.equal(third.disabled, true);
  assert.equal(third.value, "all", "never a stale value above an unfiltered list");
  assert.equal($("#jobsEmpty .t-empty").textContent, "No downloads yet.");
  assert.equal($("#jobsEmpty .t-body").textContent, "Choose Download beside any media, or paste a link.");
});

test("a download the user just started is never hidden by the type filter", async () => {
  await bootPopup({ items: [FILE, AUDIO], jobs: [], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD_URL: () => ({ ok: true, method: "native", jobId: "j9" }) } });
  const filter = $("#filterSelect");
  filter.value = "audio";
  filter.dispatchEvent(new Event("change"));
  click($("#urlButton"));
  await settle(2);
  const input = $('#downloadDialog input[type="url"]');
  input.value = "https://cdn.example.com/talk.mp4";
  input.dispatchEvent(new Event("input"));
  $("#downloadDialog form").dispatchEvent(new Event("submit"));
  await until(() => $('[role="tab"][data-view="downloads"]').getAttribute("aria-selected") === "true");
  assert.equal(filter.value, "all");
  assert.deepEqual($$("#jobRows > li.row").map((row) => row.dataset.jobId), ["j9"]);
});

test("the popup is as tall as its content (440 to 600) and scrolls its body at the cap", () => {
  const css = read("extension/popup/popup.css");
  const rule = (selector) => css.match(new RegExp(`(?:^|\\n)${selector} \\{([^}]*)\\}`))?.[1] || "";
  assert.doesNotMatch(rule("html"), /(^|[^-])height:\s*600px/, "no fixed 600 height");
  assert.match(rule("html"), /max-height:\s*600px/);
  assert.match(rule("body"), /height:\s*auto/);
  assert.match(rule("body"), /min-height:\s*440px/);
  assert.match(rule("body"), /max-height:\s*600px/);
  assert.match(rule("\\.popup-main"), /flex:\s*1 1 auto[\s\S]*min-height:\s*0[\s\S]*overflow-y:\s*auto/);
  assert.match(read("extension/ui/v2/system.css"), /\[data-surface="popup"\]:has\(\.dialog-shell\[open\]\) \{\s*min-height: 600px;/, "a dialog still takes the full 600");
});

test("media rows keep one right edge: the slot mirrors the overflow's footprint", () => {
  const css = read("extension/ui/v2/media.css");
  const slot = css.match(/\.row-actions \.icon-slot \{([^}]*)\}/)?.[1] || "";
  assert.match(slot, /width:\s*var\(--icon-button\)/);
  assert.match(slot, /height:\s*var\(--icon-button\)/);
  assert.match(slot, /margin-inline-end:\s*calc\(-1 \* var\(--space-2\)\)/, "the same end margin as .row-actions .icon-button");
});

test("the pond repaints an opening it was asked for before it finished mounting", async () => {
  const { setPondOpening } = await import("../extension/ui/v2/media.js");
  const host = { dataset: {}, style: { setProperty() {} } };
  const sentence = { isConnected: true, getBoundingClientRect: () => ({ left: 60, top: 200, width: 280, height: 26 }) };
  setPondOpening(host, null, sentence);
  await settle(2);
  assert.equal(host.dataset.open, "true", "the opening is recorded before the pond exists");
  let refreshed = 0;
  const pond = { refresh: () => { refreshed += 1; } };
  setPondOpening(host, pond, sentence);
  await settle(2);
  assert.equal(refreshed, 1, "the newly mounted pond paints the opening");
  setPondOpening(host, pond, sentence);
  await settle(2);
  assert.equal(refreshed, 1, "an opening it already painted is not painted again");
  setPondOpening(host, pond, null);
  assert.equal(host.dataset.open, undefined);
  assert.equal(refreshed, 2, "closing repaints");
});

test("empty-state copy: native Chinese, the Display glyphs exist, no 拆/底/推", async () => {
  const { default: media } = await import("../extension/ui/v2/messages/media.js");
  assert.deepEqual(Object.keys(media.en).sort(), Object.keys(media.zh).sort(), "the same keys in both languages");
  assert.equal(media.zh["media.empty.none"], "此页还没有可下载的媒体。", "no 此页面上 calque");
  assert.equal(media.zh["media.downloads.emptyBody"], "点媒体旁的“下载”，或粘贴链接。");
  assert.ok(media.display.includes("media.downloads.noMatch"));
  const glyphs = new Set([...read("extension/ui/fonts/NotoSerifSC-display.txt").trim()]);
  for (const key of media.display) for (const ch of media.zh[key]) if (/[一-鿿]/.test(ch)) assert.ok(glyphs.has(ch), `${key}: ${ch}`);
  for (const value of Object.values(media.zh)) if (typeof value === "string") assert.doesNotMatch(value, /[拆底推]/);
  assert.doesNotMatch(read("extension/popup/popup.js"), /popup\.listTitle/, "one list title key, shared with the side panel");
});
