// The side-panel workspace on the v2 system (design review P2, §5, §6.4,
// §6.11): static checks on its sources, then the real sidepanel.js run against
// sidepanel.html in a small DOM with a stubbed chrome.*, since Chrome cannot
// run here. The DOM shim is the popup test's (tests/ui-v2-popup.test.js).
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
const LATIN_OK = new Set(["havre", "finder", "chrome", "mp4", "mkv", "webm", "mp3", "m4a", "hls", "dash", "mb", "gb", "kb", "http", "https", "youtube", "instagram", "x"]);
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
async function bootPanel({ ready = (env) => env.sent.some((message) => message.type === "PING_HOST"), ...options } = {}) {
  installPage("../extension/sidepanel/sidepanel.html");
  const env = installChrome({ ...options });
  window.innerWidth = 420;
  window.innerHeight = 900;
  caseNumber += 1;
  await import(`../extension/sidepanel/sidepanel.js?case=${caseNumber}`);
  await until(() => ready(env));
  return env;
}

const NOW = Date.now();
const FILE = { id: "m1", kind: "video", displayUrl: "https://cdn.example.com/lecture.mp4", displayTitle: "Lecture 12 · Pharmacokinetics.mp4", contentLength: 812_000_000, copyable: true, generation: 2 };
const AUDIO = { id: "m3", kind: "audio", displayUrl: "https://cdn.example.com/keynote.m4a", displayTitle: "Keynote Highlights.m4a", contentLength: 48_300_000 };
const READY_HOST = { connected: true, compatible: true, capabilities: { ffmpeg: { available: true, encoders: { libmp3lame: true } } } };
const LIVE_A = { jobId: "j1", status: "downloading", method: "native", filename: "Keynote 2026.mp4", progress: 0.62, bytes: 0, total: 0, speed: 0, message: "DASH 分片 31/50", pausable: true, createdAt: NOW - 1000, updatedAt: NOW };
const LIVE_B = { jobId: "j3", status: "queued", method: "native", filename: "Trailer.mp4", progress: 0, createdAt: NOW - 9000, updatedAt: NOW - 9000 };
const DONE = { jobId: "j2", status: "failed", method: "native", filename: "Broken.mp4", error: "HTTP Error 403: Forbidden", retryable: true, hasSource: true, createdAt: NOW - 90_000, updatedAt: NOW - 60_000 };

/** Elements in document order, for checking the panel's top-to-bottom layout. */
function order(...selectors) {
  const all = [];
  const walk = (node) => { for (const child of node.children) { all.push(child); walk(child); } };
  walk(document.body);
  return selectors.map((selector) => all.indexOf($(selector)));
}

test("the side panel is built on v2 only: no v1 stylesheets or UI modules, no copy in HTML, no literals", async () => {
  const html = read("extension/sidepanel/sidepanel.html");
  const js = read("extension/sidepanel/sidepanel.js");
  const css = read("extension/sidepanel/sidepanel.css");
  const positions = ["../ui/v2/tokens.css", "../ui/v2/system.css", "../ui/v2/media.css", "sidepanel.css"].map((href) => html.indexOf(`href="${href}"`));
  assert.ok(positions.every((index, i) => index >= 0 && (i === 0 || positions[i - 1] < index)), "tokens, system, media, page in order");
  assert.doesNotMatch(html, /ui\/tokens\.css|ui\/components\.css|ui\/atmosphere\.css/);
  assert.match(html, /<html[^>]*data-surface="sidepanel"/);
  assert.ok(!CJK.test(html.replace(/<!--[\s\S]*?-->/g, "")) && !CJK.test(js) && !CJK.test(css));
  assert.doesNotMatch(js, /from "\.\.\/ui\/(?:i18n|interactions|job-rows|speed-graph|customization)\.js"|job-presentation|friendlyJobMessage|friendlyDashMessage|loadPrivacySafeThumbnail/);
  assert.doesNotMatch(js, /innerHTML|window\.confirm/);
  assert.doesNotMatch(css, /border(-top|-bottom|-left|-right|-block|-inline)?(-width)?:\s*1px|text-transform:\s*uppercase|letter-spacing:\s*[1-9.]|font-style:\s*italic|monospace/);
  const { scanColourLiterals } = await import("../scripts/design-audit.mjs");
  assert.deepEqual(scanColourLiterals().filter((f) => f.file.startsWith("extension/sidepanel/")), []);
});

test("one skeleton with the popup: BrandMark S, Download a link and Settings; no page card, no engine card", async () => {
  await bootPanel({ items: [FILE] });
  assert.equal($("#topbarInner [data-brandmark]").dataset.size, "s");
  assert.deepEqual($(".bar-actions").querySelectorAll("button").map((element) => element.id), ["urlButton", "settingsButton"]);
  assert.equal($("#topbarInner").querySelectorAll("button").length, 2);
  assert.equal($$(".page-context, .host-card, .page-mark, #pageTitle, #hostCard").length, 0);
  assert.doesNotMatch(document.body.textContent, /Current page|Download settings|Media workspace/);
});

test("top to bottom: the engine line, Media on this page (Rescan · overflow), media rows, then Downloads", async () => {
  await bootPanel({ items: [FILE, AUDIO], jobs: [LIVE_A, LIVE_B, DONE], native: false, url: "https://www.example.com/watch?v=1" });
  const media = $("#mediaHeaderSlot .list-header");
  assert.equal(media.querySelector(".list-title > span").textContent, "Media on this page");
  assert.equal(media.querySelector(".list-meta").hidden, true, "rows carry their hosts; the header repeats none");
  assert.deepEqual(media.querySelector(".list-actions").children.map((element) => element.dataset.action), ["rescan", "more"]);
  assert.ok(visible(media.querySelector('[data-action="rescan"]')) && media.querySelector('[data-action="rescan"]').classList.contains("btn-tertiary"));
  assert.equal(lineText("#engineLine"), "Local engine isn’t set up");
  assert.equal($("#engineLine").parentNode, $("#page"), "the engine line is app-wide, outside the media section (as in the popup)");
  const downloads = $("#downloadsHeaderSlot .list-header");
  assert.equal(downloads.querySelector(".list-title > span").textContent, "Downloads");
  assert.deepEqual(downloads.querySelector(".list-actions").children.map((element) => element.textContent), ["All downloads", "Clear finished"]);
  const positions = order("#engineLine", "#mediaHeaderSlot", "#mediaRows", "#downloadsHeaderSlot", "#focusSlot", "#jobRows");
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, "the popup's order");
  assert.equal($$(".status-line").filter((element) => visible(element) && !element.closest("dialog")).length, 1, "the one status line");
});

test("media rows are the popup's rows; Download opens the shared Download dialog", async () => {
  await bootPanel({ items: [FILE, AUDIO] });
  const rows = $$("#mediaRows > li.row");
  assert.deepEqual(rows.map((row) => row.querySelector(".row-meta").textContent), ["MP4 · 812 MB", "M4A · 48.3 MB"]);
  assert.ok(rows.every((row) => row.querySelector(".row-lead > svg") && !row.querySelector("img")));
  assert.equal($$(".chip, .variant-select").length, 0);
  click(rows[0].querySelector('button[data-media-action="download"]'));
  await settle();
  assert.equal($("#downloadDialog").open, true);
  assert.equal($("#downloadDialog .t-title").textContent, "Download");
  click($("#urlButton"));
  assert.ok($('#downloadDialog input[type="url"]'));
});

test("Downloads: the active download is the one focus panel, then rows; Clear finished and All downloads", async () => {
  const env = await bootPanel({ items: [], jobs: [LIVE_A, LIVE_B, DONE], native: true, hostStatus: READY_HOST, handlers: { CLEAR_COMPLETED_JOBS: () => ({ ok: true, removed: 1, jobs: [LIVE_A, LIVE_B] }) } });
  assert.equal($("#jobsEmpty").hidden, true);
  const panels = $$(".focus-panel");
  assert.equal(panels.length, 1, "one focus panel");
  assert.equal(panels[0].parentNode, $("#focusSlot"));
  assert.equal(panels[0].dataset.jobId, "j1");
  assert.ok(panels[0].querySelector('.progress[data-size="panel"]'));
  const meta = panels[0].querySelector(".row-meta").textContent;
  assert.match(meta, /^Downloading62%/);
  assert.doesNotMatch(meta, /parts/, "the parts count stays in Details (rename table)");
  const details = panels[0].querySelector(".focus-details .details-body").textContent;
  assert.match(details, /31 of 50 parts/, "parts from the engine text, localised, inside Details");
  assert.ok(!CJK.test(meta) && !CJK.test(details));
  const rows = $$("#jobRows > li.row");
  assert.deepEqual(rows.map((row) => row.dataset.jobId), ["j3", "j2"]);
  assert.equal(rows[1].querySelector(".status").textContent, "Failed");
  assert.match(rows[1].querySelector(".row-meta").textContent, /refused|403/i);
  assert.doesNotMatch(rows[1].querySelector(".row-meta").textContent, /HTTP Error 403: Forbidden/, "never the raw engine text");
  assert.deepEqual(rows[1].querySelectorAll(".row-actions button").map((element) => element.dataset.action), ["retry", "more"]);
  const clear = $('#downloadsHeaderSlot [data-action="clear-finished"]');
  assert.equal(clear.disabled, false);
  assert.ok(clear.classList.contains("btn-destructive"), "destructive text (§6.1)");
  click(clear);
  await settle(2);
  const confirm = $("#menuLayer .confirm");
  assert.ok(confirm && !$("#menuLayer").hidden, "Clear finished asks in place, like the popup's Clear results");
  assert.match(confirm.textContent, /Your download history stays/);
  assert.ok(!env.sent.some((message) => message.type === "CLEAR_COMPLETED_JOBS"), "nothing is cleared before the answer");
  click(confirm.querySelector(".btn-destructive"));
  await settle(10);
  assert.ok(env.sent.some((message) => message.type === "CLEAR_COMPLETED_JOBS"));
  assert.equal(clear.hidden, true, "nothing finished is left to clear: the action steps out");
  assert.equal(clear.disabled, false, "hidden, never left disabled, so it works when it comes back");
  click($('#downloadsHeaderSlot [data-action="history"]'));
  await settle();
  assert.ok(env.sent.some((message) => message.type === "OPEN_DOWNLOADS_PAGE"));
});

test("the media empty state carries Rescan as the one primary, as in the popup; no downloads is one body line", async () => {
  const env = await bootPanel({ items: [], jobs: [], url: "https://www.example.com/watch?v=1" });
  const media = $("#mediaEmpty");
  assert.ok(media.classList.contains("text-column") && visible(media));
  assert.equal(media.querySelector(".t-empty").textContent, "No downloadable media on this page yet.");
  const primaries = $$(".btn-primary").filter((element) => visible(element));
  assert.equal(primaries.length, 1, "one primary per view");
  assert.equal(primaries[0], media.querySelector("button"));
  assert.equal(primaries[0].textContent, "Rescan");
  assert.equal(visible($('#mediaHeaderSlot [data-action="rescan"]')), false, "no second Rescan in the header");
  assert.equal($("#mediaHeaderSlot .list-meta").textContent, "example.com", "the host names the page the sentence speaks of");
  assert.equal($('#mediaHeaderSlot [data-action="more"]').hidden, true, "Download all needs two items");
  // No downloads: one body line, no second Display sentence.
  const jobs = $("#jobsEmpty");
  assert.ok(visible(jobs));
  assert.equal(visible(jobs.querySelector(".t-empty")), false);
  assert.equal(jobs.querySelector(".t-body").textContent, "Choose Download beside any media, or paste a link.");
  assert.equal($$(".t-empty").filter((element) => visible(element)).length, 1, "one Display sentence on the panel");
  assert.equal(visible($('#downloadsHeaderSlot [data-action="clear-finished"]')), false, "nothing to clear, no Clear finished");
  click(primaries[0]);
  await until(() => env.sent.filter((message) => message.type === "GET_TAB_MEDIA").length === 2);
  assert.ok(env.sent.some((message) => message.type === "SCAN_TAB"));
});

test("Clear finished appears once a download has ended", async () => {
  const env = await bootPanel({ items: [], jobs: [LIVE_A], native: true, hostStatus: READY_HOST });
  const clear = $('#downloadsHeaderSlot [data-action="clear-finished"]');
  assert.equal(clear.hidden, true, "only running downloads: nothing to clear");
  const send = (message) => { for (const port of env.ports) for (const listener of port.onMessage.listeners) listener(message); };
  send({ type: "JOB_UPDATED", job: { ...LIVE_A, status: "failed", updatedAt: Date.now() } });
  assert.equal(clear.hidden, false);
  assert.equal(clear.disabled, false);
});

test("a late tab A response never lands after tab B became active", async () => {
  let release;
  let released = false;
  const slow = new Promise((resolve) => { release = resolve; });
  await bootPanel({
    ready: (env) => env.sent.some((message) => message.type === "GET_TAB_MEDIA"),
    tab: { id: 101, windowId: 3, url: "https://a.example/" },
    items: [],
    handlers: {
      GET_TAB_MEDIA: async (message) => (message.tabId === 101 && !released ? slow : { ok: true, items: [AUDIO], settings: {}, hostStatus: {} })
    }
  });
  assert.equal(lineText("#mediaState"), "Looking for media…", "tab A is still loading");
  // Tab B becomes active while tab A's answer is still on its way.
  chrome.tabs.query = async () => [{ id: 202, windowId: 3, url: "https://b.example/" }];
  for (const listener of chrome.tabs.onActivated.listeners) listener({ tabId: 202 });
  await settle();
  released = true;
  release({ ok: true, items: [FILE], settings: {}, hostStatus: {} });
  await settle();
  const names = $$("#mediaRows .row-title [data-filename]").map((element) => element.dataset.filename);
  assert.deepEqual(names, ["Keynote Highlights.m4a"], "tab B's media only");
  assert.equal($("#mediaHeaderSlot .list-meta").hidden, true, "with rows, the header repeats no host");
});

test("Set up opens Settings at #local-engine and keeps the panel open", async () => {
  const env = await bootPanel({ items: [FILE], native: false });
  click($("#engineLine .line-actions button"));
  await settle();
  assert.ok(env.created.some((url) => String(url).endsWith("options/options.html#local-engine")));
  assert.equal(env.closed, false);
});

test("locale: no CJK in the English panel and no stray Latin words in the Chinese panel", async () => {
  await bootPanel({ items: [FILE, AUDIO], jobs: [LIVE_A, DONE], native: false });
  for (const text of visibleTexts()) assert.ok(!CJK.test(text), `English UI: ${text}`);
  await bootPanel({ lang: "zh-CN", items: [FILE, AUDIO], jobs: [LIVE_A, DONE], native: false });
  const words = visibleTexts().flatMap((text) => (text.replace(/\b\d+(\.\d+)?\s?(k|m|g|t)?i?b(\/s)?\b/gi, " ").replace(/\b\d+p\b/gi, " ").match(/[A-Za-z][A-Za-z0-9]+/g) || []).filter((word) => !LATIN_OK.has(word.toLowerCase())));
  assert.deepEqual(words, []);
  assert.equal(document.title, "工作台 · Havre");
});

test("a finished download holds its celadon fill, then takes its history form (§6.7)", async () => {
  const live = { ...LIVE_A, message: "", total: 100, bytes: 50, speed: 10 };
  const env = await bootPanel({ jobs: [live] });
  assert.ok($("#focusSlot .focus-panel"));
  const send = (message) => { for (const port of env.ports) for (const listener of port.onMessage.listeners) listener(message); };
  send({ type: "JOB_UPDATED", job: { ...live, status: "completed", progress: 1, hasFile: true, updatedAt: Date.now() } });
  assert.equal($('#focusSlot .progress').dataset.state, "complete");
  assert.equal($("#focusSlot .row-meta").textContent, "Completed");
  await new Promise((resolve) => setTimeout(resolve, 1300));
  assert.equal($('#focusSlot .progress').dataset.state, "settled");
  await new Promise((resolve) => setTimeout(resolve, 600));
  assert.equal($("#focusSlot").children.length, 0);
  const row = $("#jobRows > li.row");
  assert.equal(row.dataset.jobId, "j1");
  assert.deepEqual(row.querySelectorAll(".row-actions button").map((element) => element.dataset.action), ["open", "more"]);
  assert.equal($("#announcer").textContent, "Keynote 2026.mp4: Completed");
});

// ---------- review fixes ----------
test("the Download dialog starts on the item's own tab, even when the panel followed another tab", async () => {
  const env = await bootPanel({ items: [FILE], native: true, hostStatus: READY_HOST, handlers: { DOWNLOAD: () => ({ ok: true, method: "native", jobId: "j7" }) } });
  click($('#mediaRows button[data-media-action="download"]'));
  await settle();
  assert.equal($("#downloadDialog").open, true);
  chrome.tabs.query = async () => [{ id: 9, windowId: 3, url: "https://other.example/" }];
  for (const listener of chrome.tabs.onActivated.listeners) listener({ tabId: 9 });
  await until(() => env.sent.some((message) => message.type === "GET_TAB_MEDIA" && message.tabId === 9));
  $("#downloadDialog form").dispatchEvent(new Event("submit"));
  await until(() => env.sent.some((message) => message.type === "DOWNLOAD"));
  const start = env.sent.find((message) => message.type === "DOWNLOAD");
  assert.equal(start.tabId, 7, "the tab the item was found on");
  assert.deepEqual(start.candidate, { id: "m1", kind: "video", generation: 2 });
});

test("a quality probe is kept per tab: the same id on another tab is probed again", async () => {
  const STREAM = { id: "s1", kind: "hls", displayUrl: "https://cdn.example.com/master.m3u8", displayTitle: "Keynote", generation: 1 };
  const env = await bootPanel({ items: [STREAM], probe: { kind: "hls", type: "master", variants: [] } });
  click($('#mediaRows button[data-media-action="download"]'));
  await until(() => $("#downloadDialog").open);
  click($("#downloadDialog .dialog-actions button"));
  chrome.tabs.query = async () => [{ id: 9, windowId: 3, url: "https://other.example/" }];
  for (const listener of chrome.tabs.onActivated.listeners) listener({ tabId: 9 });
  await until(() => env.sent.some((message) => message.type === "GET_TAB_MEDIA" && message.tabId === 9) && $('#mediaRows button[data-media-action="download"]'));
  click($('#mediaRows button[data-media-action="download"]'));
  await until(() => $("#downloadDialog").open);
  assert.deepEqual(env.sent.filter((message) => message.type === "PROBE_MANIFEST").map((message) => message.tabId), [7, 9]);
});

test("Rescan in the panel reports a page it could not read, not \"Scan finished\"", async () => {
  let fail = false;
  await bootPanel({ items: [FILE], handlers: { GET_TAB_MEDIA: () => (fail ? { ok: false, error: "tab gone" } : { ok: true, items: [FILE], settings: {}, hostStatus: {} }) } });
  fail = true;
  click($('#mediaHeaderSlot [data-action="rescan"]'));
  await until(() => $("#toastRegion").children.length > 0);
  assert.deepEqual($("#toastRegion").children.map((element) => `${element.dataset.tone}:${element.textContent}`), ["error:Couldn’t read this page"]);
});

test("the panel reconnects after an idle worker drops its port, and resyncs downloads and media", async () => {
  const env = await bootPanel({ items: [FILE], jobs: [] });
  const before = { jobs: env.sent.filter((message) => message.type === "GET_JOBS").length, media: env.sent.filter((message) => message.type === "GET_TAB_MEDIA").length };
  for (const listener of env.ports[0].onDisconnect.listeners) listener();
  await until(() => env.ports.length === 2
    && env.sent.filter((message) => message.type === "GET_JOBS").length > before.jobs
    && env.sent.filter((message) => message.type === "GET_TAB_MEDIA").length > before.media);
  assert.notEqual(lineText("#engineLine"), "Havre stopped responding");
  const send = (message) => { for (const listener of env.ports[1].onMessage.listeners) listener(message); };
  send({ type: "JOB_UPDATED", job: { jobId: "jx", status: "downloading", method: "native", filename: "After.mp4", progress: 0.1, createdAt: Date.now(), updatedAt: Date.now() } });
  assert.equal($("#focusSlot .focus-panel").dataset.jobId, "jx", "live updates flow again");
});

test("a permission granted elsewhere rechecks the engine from the panel", async () => {
  let native = false;
  const env = await bootPanel({ items: [FILE], hostStatus: { connected: false, needsPermission: true }, handlers: { PING_HOST: () => ({ ok: true, hostStatus: native ? READY_HOST : { connected: false, needsPermission: true } }) } });
  assert.equal(lineText("#engineLine"), "Local engine isn’t set up");
  native = true;
  chrome.permissions.contains = async () => true;
  const pings = env.sent.filter((message) => message.type === "PING_HOST").length;
  for (const listener of chrome.permissions.onAdded.listeners) listener({ permissions: ["nativeMessaging"] });
  await until(() => env.sent.filter((message) => message.type === "PING_HOST").length > pings);
  assert.equal($("#engineLine").hidden, true);
});

// ---------- design audit pass 2 ----------
test("side-panel CSS: the focus panel bleeds like the row tint; the first header keeps group spacing under an engine line", () => {
  const css = readFileSync(new URL("../extension/sidepanel/sidepanel.css", import.meta.url), "utf8");
  const focus = css.match(/\n\.focus-panel \{([^}]*)\}/)?.[1] || "";
  assert.match(focus, /margin-inline:\s*calc\(-1 \* var\(--space-3\)\)/, "8px inside the panel edge at 420, as the row hover tint");
  assert.match(focus, /padding-inline:\s*var\(--space-3\)/, "the text stays on the text column");
  assert.match(css, /#engineLine\[hidden\] \+ #mediaSection #mediaHeaderSlot \.list-header \{\s*padding-top: var\(--space-3\);/);
  assert.doesNotMatch(css, /\n#mediaHeaderSlot \.list-header \{/, "no unconditional tight header under a shown engine line");
});

test("Download links share one right edge in the panel too", async () => {
  await bootPanel({ items: [FILE, { id: "m2", kind: "hls", displayUrl: "https://cdn.example.com/master.m3u8", displayTitle: "Keynote 2026", height: 1080, recommended: true }] });
  const rows = $$("#mediaRows > li.row");
  assert.ok(rows.every((row) => row.querySelector(".row-actions").children.length === 2));
  assert.ok(rows[1].querySelector(".row-actions .icon-slot"), "the stream row keeps the overflow's slot");
});
