// Settings on the v2 system (design review §6.13) and the UI editor (Lab ->
// Developer). Static checks on the sources, then the real options.html and
// options.js booted in a minimal DOM with a stubbed chrome, since Chrome
// cannot run here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const CJK = /[㐀-鿿　-〿＀-￯]/;
const SURFACE_FILES = [
  "extension/options/options.html",
  "extension/options/options.css",
  "extension/options/options.js",
  "extension/options/form-state.js",
  "extension/options/native-recovery.js",
  "extension/designer/designer.html",
  "extension/designer/designer.css",
  "extension/designer/designer.js",
  "extension/ui/customization.js"
];

// ---------- a minimal DOM with a tiny HTML parser ----------
const REFLECT = { id: "id", title: "title", type: "type", alt: "alt", src: "src", htmlFor: "for", href: "href", name: "name", placeholder: "placeholder", method: "method", inputMode: "inputmode", min: "min", max: "max", step: "step", lang: "lang", accept: "accept" };
const BOOL = { hidden: "hidden", disabled: "disabled", required: "required", noValidate: "novalidate", open: "open" };
class Node {
  constructor() { this.childNodes = []; this.parentNode = null; this.listeners = {}; }
  get parentElement() { return this.parentNode instanceof Element ? this.parentNode : null; }
  append(...nodes) { for (const n of nodes) this.appendChild(typeof n === "string" ? new Text(n) : n); }
  appendChild(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); return n; }
  prepend(...nodes) { const list = nodes.map((n) => (typeof n === "string" ? new Text(n) : n)); for (const n of list) { if (n.parentNode) n.remove(); n.parentNode = this; } this.childNodes.unshift(...list); }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) c.parentNode = null; this.childNodes = []; this.append(...nodes); }
  remove() { if (!this.parentNode) return; const list = this.parentNode.childNodes; list.splice(list.indexOf(this), 1); this.parentNode = null; }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v) { this.replaceChildren(); if (String(v ?? "") !== "") this.append(new Text(String(v))); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(event) { event.target ??= this; event.currentTarget = this; for (const fn of this.listeners[event.type] || []) fn.call(this, event); if (event.bubbles && this.parentNode && !event.stopped) this.parentNode.dispatchEvent(event); return true; }
}
class Text extends Node { constructor(v) { super(); this.data = String(v); } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
class Element extends Node {
  constructor(tag, ns) {
    super();
    this.tagName = ns ? tag : tag.toUpperCase();
    this.localName = tag.toLowerCase();
    this.attributes = new Map();
    this.style = { props: {}, setProperty(k, v) { this.props[k] = v; }, removeProperty(k) { delete this.props[k]; }, getPropertyValue(k) { return this.props[k] ?? ""; } };
    this.value = "";
    this._raw = null;
    const self = this;
    const attr = (k) => `data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute(attr(k)) ?? undefined,
      set: (_, k, v) => { self.setAttribute(attr(k), String(v)); return true; },
      deleteProperty: (_, k) => { self.removeAttribute(attr(k)); return true; },
      has: (_, k) => self.hasAttribute(attr(k))
    });
    this.classList = {
      add: (...c) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); this.className = [...s].join(" "); },
      remove: (...c) => { this.className = this.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(" "); },
      contains: (c) => this.className.split(/\s+/).includes(c),
      toggle: (c, f) => { const on = f ?? !this.classList.contains(c); on ? this.classList.add(c) : this.classList.remove(c); return on; }
    };
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
  get rows() { return Number(this.getAttribute("rows") || 2); }
  set rows(v) { this.setAttribute("rows", String(v)); }
  get maxLength() { return Number(this.getAttribute("maxlength") ?? -1); }
  set maxLength(v) { this.setAttribute("maxlength", String(v)); }
  get spellcheck() { return this.getAttribute("spellcheck") !== "false"; }
  set spellcheck(v) { this.setAttribute("spellcheck", String(Boolean(v))); }
  get options() { return this.querySelectorAll("option"); }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }
  scrollIntoView() { globalThis.__scrolledTo = this.id; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
  focus() { globalThis.document.activeElement = this; }
  click() { this.dispatchEvent({ type: "click", bubbles: true }); }
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
const VOID = new Set(["meta", "link", "input", "br", "img"]);
function parseInto(parent, html) {
  const stack = [parent];
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|([^<]+)/g)) {
    if (m[0].startsWith("<!--")) continue;
    const top = stack[stack.length - 1];
    if (m[4] !== undefined) { if (m[4].trim()) top.append(new Text(m[4])); continue; }
    const tag = m[2].toLowerCase();
    if (m[1]) { stack.pop(); continue; }
    const element = new Element(tag);
    for (const a of m[3].matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) element.setAttribute(a[1], a[2] ?? "");
    top.append(element);
    if (!VOID.has(tag) && !m[3].endsWith("/")) stack.push(element);
  }
}
function installDom(page) {
  const doc = new Element("#document", true);
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (ns, tag) => new Element(tag, ns);
  doc.createTextNode = (v) => new Text(v);
  doc.activeElement = null;
  doc.readyState = "complete";
  doc.title = "";
  doc.addEventListener = () => {};
  const html = new Element("html");
  for (const a of page.match(/<html([^>]*)>/)[1].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) html.setAttribute(a[1], a[2] ?? "");
  const body = new Element("body");
  doc.append(html);
  html.append(body);
  doc.documentElement = html;
  doc.body = body;
  const inner = page.slice(page.indexOf("<body>") + 6, page.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");
  parseInto(body, inner);
  globalThis.document = doc;
  globalThis.window = globalThis;
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 900;
  globalThis.scrollY = 0;
  globalThis.addEventListener = () => {};
  globalThis.Event = class Event { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } stopPropagation() { this.stopped = true; } preventDefault() { this.defaultPrevented = true; } };
  return doc;
}

// ---------- a stubbed chrome ----------
const sent = [];
const requests = [];
const tabs = [];
const local = {};
const storageListeners = [];
const permissions = new Set();
const grants = { nativeMessaging: true, notifications: false };
let stored = {
  concurrentFragments: 8, concurrentRanges: 8, concurrentJobs: 3, outputContainer: "mp4", liveDuration: 0,
  minimumBytes: 512000, blockedDomains: [], filenameTemplate: "{title}", saveAs: false, useNativeForDirect: false,
  showNotifications: false, youtubeEnabled: false, autoEnrichSiteQuality: true, allowPrivateNetworkMedia: false
};
let hostOverride = null;
let recoverReply = null;
let failSaves = false;
let saveGate = null;
let cancelFolder = false;
const host = { connected: true, compatible: true, version: "0.3.0", protocolVersion: 1, capabilityProfileVersion: 1, downloadDir: "/Users/someone/Downloads", capabilities: { ffmpeg: { available: true } } };
const { buildDiagnostics } = await import("../extension/lib/build-profile.js");
globalThis.chrome = {
  runtime: {
    id: "abcdefghijklmnopabcdefghijklmnop",
    getURL: (path) => path,
    getPlatformInfo: async () => ({ os: "mac", arch: "arm64", nacl_arch: "arm64" }),
    async sendMessage(message) {
      sent.push(structuredClone(message));
      switch (message.type) {
        case "GET_SETTINGS": return { ok: true, settings: { ...stored } };
        case "SAVE_SETTINGS":
          if (saveGate) await saveGate;
          if (failSaves) return { ok: false, error: "storage unavailable", code: "save_failed" };
          stored = { ...message.settings };
          return { ok: true, settings: { ...stored } };
        case "PING_HOST": return { ok: true, hostStatus: permissions.has("nativeMessaging") ? { ...(hostOverride || host) } : { connected: false, needsPermission: true } };
        case "RECOVER_NATIVE_API": { const reply = recoverReply; hostOverride = null; return { ok: true, ...reply }; }
        case "GET_DIAGNOSTICS": return { ok: true, diagnostics: buildDiagnostics({ extensionId: "abcdefghijklmnopabcdefghijklmnop", manifestVersion: "0.3.0", hostStatus: permissions.has("nativeMessaging") ? host : {} }) };
        case "CHOOSE_DOWNLOAD_FOLDER":
          if (cancelFolder) return { ok: false, error: "selection cancelled", code: "cancelled" };
          return { ok: true, downloadDir: message.reset ? "/Users/someone/Downloads" : "/Users/someone/Movies/Saved" };
        case "OPEN_DOWNLOAD_FOLDER": case "OPEN_DOWNLOADS_PAGE": return { ok: true };
        default: return { ok: false, error: "unknown" };
      }
    }
  },
  permissions: {
    async contains({ permissions: [name] }) { return permissions.has(name); },
    request({ permissions: [name] }) {
      requests.push(name);
      return Promise.resolve(grants[name]).then((granted) => { if (granted) permissions.add(name); return granted; });
    },
    onAdded: { addListener() {} },
    onRemoved: { addListener() {} }
  },
  storage: {
    local: {
      async get(key) { return { [key]: local[key] }; },
      async set(values) {
        const changes = {};
        for (const [key, value] of Object.entries(values)) { changes[key] = { oldValue: local[key], newValue: value }; local[key] = value; }
        for (const listener of storageListeners) listener(changes, "local");
      }
    },
    onChanged: { addListener: (listener) => storageListeners.push(listener), removeListener() {} }
  },
  i18n: { getUILanguage: () => "en-US" },
  commands: { async getAll() { return [{ name: "_execute_action", shortcut: "⌥⇧F" }, { name: "open-downloads", shortcut: "⌥⇧D" }, { name: "open-workspace", shortcut: "⌥⇧W" }]; } },
  tabs: { async create({ url }) { tabs.push(url); } }
};
let clipboard = "";
Object.defineProperty(globalThis, "navigator", { value: { clipboard: { async writeText(text) { clipboard = text; } } }, configurable: true });
const replaced = [];
globalThis.location = { hash: "#localCapabilities" };
globalThis.history = { replaceState(_, __, url) { replaced.push(url); globalThis.location.hash = url; } };

const doc = installDom(read("extension/options/options.html"));
const settle = async (rounds = 8) => { for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setTimeout(resolve, 0)); };
const { MESSAGES, msg } = await import("../extension/ui/v2/messages.js");
const page = await import("../extension/options/options.js");
await settle(20);

const $ = (selector) => doc.querySelector(selector);
const $$ = (selector) => doc.querySelectorAll(selector);
const lastSave = () => [...sent].reverse().find((message) => message.type === "SAVE_SETTINGS")?.settings;
const savesSince = (count) => sent.slice(count).filter((message) => message.type === "SAVE_SETTINGS");
const change = (element) => element.dispatchEvent(new Event("change", { bubbles: true }));
const visibleText = (root) => {
  const out = [];
  const walk = (node, hidden) => {
    if (node instanceof Text) { if (!hidden && node.data.trim()) out.push(node.data.trim()); return; }
    if (!(node instanceof Element)) return;
    const skip = hidden || node.hidden || node.hasAttribute("data-user-content") || node.getAttribute("translate") === "no" || node.localName === "option" || node.localName === "svg";
    for (const child of node.childNodes) walk(child, skip);
  };
  walk(root, false);
  return out;
};
const AUDIT_LATIN_OK = new Set(["havre", "finder", "chrome", "macos", "mp4", "mkv", "webm", "kb", "mb", "gb", "instagram", "youtube", "bilibili", "x", "mac", "yt-dlp"]);

// ---------- static ----------

test("Settings and the UI editor load only the v2 system, with no copy or CJK outside the message modules", () => {
  for (const page of ["extension/options/options.html", "extension/designer/designer.html"]) {
    const html = read(page);
    assert.match(html, /href="\.\.\/ui\/v2\/tokens\.css"[\s\S]*href="\.\.\/ui\/v2\/system\.css"/, `${page} loads the v2 tokens then system`);
    assert.doesNotMatch(html, /ui\/(?:tokens|components|atmosphere)\.css/, `${page} loads no v1 CSS`);
  }
  assert.match(read("extension/options/options.html"), /<html lang="zh-CN" data-surface="settings">/);
  for (const file of SURFACE_FILES) {
    const source = stripComments(read(file));
    assert.ok(!CJK.test(source), `${file} has no CJK characters`);
    assert.doesNotMatch(source, /innerHTML/, `${file} builds DOM nodes, not HTML strings`);
    assert.doesNotMatch(source, /font-family:\s*[^;]*mono|font-style:\s*italic|letter-spacing|text-transform:\s*uppercase/i, `${file}: no monospace, italics or tracked caps`);
    assert.doesNotMatch(source, /\b1px solid\b/, `${file}: no 1px rules`);
  }
  for (const file of ["extension/options/options.js", "extension/designer/designer.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /ui\/(?:interactions|job-rows|speed-graph)\.js|bindUiI18n|applyDomI18n/, `${file} imports no v1 UI modules`);
  }
});

test("Settings sources hold no colour literals and the customization defaults carry none", async () => {
  const { scanColourLiterals } = await import("../scripts/design-audit.mjs");
  const findings = scanColourLiterals().filter((f) => f.file.startsWith("extension/options/") || f.file.startsWith("extension/designer/") || f.file === "extension/ui/customization.js");
  assert.deepEqual(findings, []);
  const { DEFAULT_UI_CUSTOMIZATION } = await import("../extension/ui/customization.js");
  assert.equal(DEFAULT_UI_CUSTOMIZATION.accentColor, "", "the default accent is the theme's --pond");
});

test("every settings.* key the pages use exists in both tables; Display lists the page title", () => {
  const sources = ["extension/options/options.js", "extension/designer/designer.js", "extension/designer/designer.html", "extension/options/options.html"].map(read).join("\n");
  const used = new Set([...sources.matchAll(/["'`](settings\.[\w.]+)["'`]/g)].map((m) => m[1]).filter((key) => !key.endsWith(".")));
  for (const key of used) {
    assert.ok(Object.hasOwn(MESSAGES.en, key), `en has ${key}`);
    assert.ok(Object.hasOwn(MESSAGES.zh, key), `zh has ${key}`);
  }
});

// ---------- the booted page ----------

test("the page: top bar with the BrandMark only, the display title on the nav edge, a nav and ten sections without numbers", () => {
  assert.ok($("#topbarInner [data-brandmark]"), "BrandMark in the top bar");
  assert.equal($$("#topbarInner button").length, 0, "Settings has no other top-bar control");
  assert.equal($("#settingsTitle").textContent, "Settings");
  assert.equal($("#settingsTitle").className, "t-display");
  assert.equal($$(".t-display").length, 1, "one Display use besides the BrandMark");
  const ids = $$("#sections > section").map((section) => section.id);
  assert.deepEqual(ids, ["status", "local-engine", "capabilities", "saving", "speed", "finding", "privacy", "notifications", "general", "lab"]);
  const nav = $$("#navSlot .nav-item");
  assert.deepEqual(nav.map((item) => item.getAttribute("href")), ids.map((id) => `#${id}`));
  assert.equal($$('#navSlot [aria-current="true"]').length, 1, "the nav marks one current section");
  for (const heading of $$("#sections h2")) assert.doesNotMatch(heading.textContent, /^\d/, "no section numbers");
  // Every heading that looks like a section is one, so the nav mirrors the page (§6.13).
  const titles = $$("#sections .t-title");
  assert.deepEqual(titles.map((heading) => heading.localName), ids.map(() => "h2"), "no sub-headings in the section style");
  assert.deepEqual(titles.map((heading) => heading.textContent), nav.map((item) => item.textContent));
  assert.equal($("#capabilities-heading").textContent, "What Havre can save");
  assert.equal($("#saveBar"), null, "no save bar");
  assert.equal($$(".btn-primary").length, 0, "no primary button on Settings (autosave)");
  assert.equal($("#sections").hasAttribute("inert"), false, "the page is live once loaded");
});

test("the section rule (v3.1 §2.2): one hr between consecutive top-level sections, nowhere else, built as a mist line", () => {
  const children = $("#sections").childNodes.filter((node) => node.localName);
  const kinds = children.map((node) => node.localName);
  assert.deepEqual(kinds, kinds.map((kind, index) => (index % 2 ? "hr" : "section")), "sections and rules alternate");
  assert.equal(kinds[0], "section", "no rule before the first section");
  assert.equal(kinds.at(-1), "section", "no rule after the last section");
  const rules = $$("#sections > hr");
  assert.equal(rules.length, $$("#sections > section").length - 1, "one rule per pair of adjacent sections");
  for (const rule of rules) assert.equal(rule.className, "section-rule");
  assert.equal($$("#sections section hr").length, 0, "no rule inside a section");
  assert.equal($$("#navSlot hr").length, 0, "no rule in the nav");
  const css = read("extension/options/options.css");
  const block = /\.section-rule \{([^}]*)\}/.exec(css)?.[1] || "";
  assert.match(block, /height:\s*1px/);
  assert.match(block, /margin:\s*28px 0 24px/);
  assert.match(block, /border:\s*0/);
  assert.match(block, /background:\s*linear-gradient\(90deg, transparent 0, var\(--rule-section\) 10%, var\(--rule-section\) 90%, transparent 100%\)/);
  assert.doesNotMatch(block, /box-shadow|border-(top|bottom|left|right)/);
  assert.match(css, /\.section-rule \+ \.settings-section \{\s*padding-top:\s*0;/, "the section after a rule drops its padding-top");
  assert.match(css, /\.settings-section:nth-of-type\(2\)/, "the second-section gap counts sections, not rules");
  const tokens = read("extension/ui/v2/tokens.css");
  assert.match(tokens, /--rule-section:\s*rgba\(43, 46, 74, 0\.22\)/, "Morning");
  assert.equal((tokens.match(/--rule-section:\s*rgba\(239, 233, 224, 0\.18\)/g) || []).length, 2, "Dusk, in both dark blocks");
  const contrast = tokens.slice(tokens.indexOf("@media (prefers-contrast: more)"));
  assert.match(contrast, /--rule-section:\s*rgba\(43, 46, 74, 0\.36\)/);
  assert.equal((contrast.match(/--rule-section:\s*rgba\(239, 233, 224, 0\.3\)/g) || []).length, 2);
  // Settings only: no other surface carries the rule.
  for (const file of ["extension/popup/popup.js", "extension/sidepanel/sidepanel.js", "extension/downloads/downloads.js", "extension/preview/preview.js"]) {
    assert.doesNotMatch(read(file), /section-rule/, `${file} has no section rule`);
  }
});

test("legacy #localCapabilities opens #local-engine, where the engine is explained exactly once", () => {
  assert.ok(replaced.includes("#local-engine"), "the legacy hash is rewritten");
  // Every Set up elsewhere lands here: the page starts at Status, whose first row is the engine
  // with its Set up, and the explanation follows right below it.
  assert.equal(globalThis.__scrolledTo, "status");
  assert.equal($$("#status .setting-row")[0].id, "row-engine");
  assert.equal($$("#sections > section")[1].id, "local-engine", "the explanation is the next section");
  assert.equal($('#navSlot [aria-current="true"]').getAttribute("href"), "#local-engine");
  const explain = msg("settings.engine.explain");
  const all = visibleText(doc.body).join("\n");
  assert.equal(all.split(explain).length - 1, 1, "the explanation appears once");
  assert.ok($("#local-engine").textContent.includes(explain));
  assert.ok($("#local-engine #install"), "install steps sit in a disclosure in #local-engine");
  assert.equal($$("#local-engine .setting-row").length, 0, "the explanation and the install steps only: no second engine row");
});

test("every setting is one row: a name, at most one line of description, the control on the trailing edge", () => {
  const rows = $$("#sections .setting-row");
  assert.ok(rows.length >= 30, `rows: ${rows.length}`);
  for (const row of rows) {
    assert.ok(row.querySelector(".setting-name")?.textContent, `${row.id} has a name`);
    assert.ok(row.querySelectorAll(".setting-description").length <= 1, `${row.id} has at most one description`);
    assert.ok(row.querySelector(".setting-trail"), `${row.id} has a trailing cell`);
  }
  for (const selector of [".text-column", ".lead-grid", ".status-line", ".group-label", ".list-header", ".empty-state"]) {
    assert.equal($$(`#sections ${selector}`).length, 0, `no ${selector} inside the content column (edge budget)`);
  }
});

test("the status rows: one engine row, merging, Instagram and X, local network; the list says what saves today", async () => {
  const capabilityRows = () => $$("#capabilities .setting-row").filter((row) => row.id.startsWith("row-capability-"));
  const listed = () => capabilityRows().map((row) => [row.querySelector(".setting-name").textContent, row.querySelector(".row-status").textContent]);
  // Not set up until the user sets it up: one engine row, in Status, with the state line and the announcer.
  const engine = $("#row-engine");
  assert.equal(engine.closest("section").id, "status");
  assert.equal($$("#sections .setting-row").filter((row) => row.querySelector(".setting-name")?.textContent === "Local engine").length, 1, "the engine row appears once");
  assert.equal(engine.querySelector(".row-status").textContent, "Not set up");
  assert.equal(engine.querySelector(".row-status").dataset.tone, "queued", "harbour, as on every other surface");
  assert.equal(engine.querySelector(".setting-description").textContent, "Chrome will ask you to allow it.");
  assert.equal(engine.querySelector("#engine-action").textContent, "Set up");
  assert.equal(engine.querySelector("#engine-action").hidden, false);
  assert.equal($("#install").hidden, false, "the install steps are offered while the engine is missing");
  // What needs the engine says so; "Not yet" stays for what this build lacks.
  assert.equal($("#row-merge .row-status").textContent, "Not set up");
  assert.equal($("#row-direct .setting-name").textContent, "Instagram and X videos");
  assert.equal($("#row-direct .row-value").textContent, "Saved by Chrome");
  assert.equal($("#row-network .row-value").textContent, "Off");
  assert.deepEqual(listed(), [
    ["Video and audio files", "Not set up"],
    ["Streaming video", "Not set up"],
    ["Bilibili videos", "Not set up"],
    ["Live streams", "Not yet"],
    ["Encrypted streams", "Not set up"],
    ["Copy-protected video", "Not yet"],
    ["Videos with separate sound", "Not set up"],
    ["YouTube", "Not set up"],
    ["Video thumbnails", "Yes"]
  ]);
  // The Instagram/X engine switch cannot be turned on without a working engine.
  assert.equal($("#field-useNativeForDirect").disabled, true);
  assert.equal($("#field-saveAs").disabled, false);
  assert.ok($$("#saving .setting-row").findIndex((row) => row.id === "row-useNativeForDirect") < $$("#saving .setting-row").findIndex((row) => row.id === "row-saveAs"), "the engine switch leads");

  // Set up: the permission request is the first call of the click, then the engine is checked.
  const before = requests.length;
  $("#engine-action").click();
  assert.equal(requests[before], "nativeMessaging", "requested synchronously in the gesture");
  await settle(20);
  assert.equal(engine.querySelector(".row-status").textContent, "Ready");
  assert.equal($("#engine-action").hidden, true, "a Ready engine offers no Retry");
  assert.equal($("#install").hidden, true, "nor the install steps");
  assert.equal($("#row-merge .row-status").textContent, "Yes");
  // YouTube turns to Yes only once a Ready engine reports yt-dlp; this host does not.
  assert.deepEqual(listed().map(([, value]) => value), ["Yes", "Yes", "Yes", "Not yet", "Yes", "Not yet", "Yes", "Needs an extra component", "Yes"], "no tool name in a status word (v3 §3.8)");
  assert.equal($("#row-capability-7 .row-status").dataset.tone, "cancelled");
  assert.equal($("#field-useNativeForDirect").disabled, false);
  assert.equal($("#row-location .setting-description").textContent, "~/Downloads", "files go straight into Downloads");
  assert.equal($("#row-location .setting-description").hasAttribute("data-user-content"), true, "the path is user content");
  assert.ok(sent.some((message) => message.type === "PING_HOST"));
});

test("switches autosave the full settings record with the build gates closed and show Saved inline", async () => {
  const count = sent.length;
  $("#field-saveAs").click();
  await settle();
  const saves = savesSince(count);
  assert.equal(saves.length, 1);
  const saved = saves[0].settings;
  assert.equal(saved.saveAs, true);
  assert.equal(saved.liveDuration, 0);
  assert.equal(saved.youtubeEnabled, false);
  for (const key of ["concurrentFragments", "concurrentRanges", "concurrentJobs", "outputContainer", "minimumBytes", "filenameTemplate", "blockedDomains", "useNativeForDirect", "allowPrivateNetworkMedia", "autoEnrichSiteQuality", "showNotifications"]) {
    assert.ok(Object.hasOwn(saved, key), `the payload carries ${key}`);
  }
  const note = $("#row-saveAs .saved-note");
  assert.equal(note.textContent, "Saved");
  assert.equal(note.dataset.visible, "true");

  $("#field-useNativeForDirect").click();
  await settle();
  assert.equal(lastSave().useNativeForDirect, true);
  assert.equal($("#row-direct .row-value").textContent, "Saved by the local engine");
  assert.equal($("#field-saveAs").disabled, true, "Chrome no longer saves these videos, so it cannot ask where");
  $("#field-useNativeForDirect").click();
  await settle();
  assert.equal(lastSave().useNativeForDirect, false);
  assert.equal($("#field-saveAs").disabled, false);
});

test("Ignore files smaller than uses decimal KB and invalid numbers stay unsaved with an inline error", async () => {
  const field = $("#field-minimumKB");
  assert.equal(field.value, "512", "512000 bytes read as 512 KB");
  assert.ok($("#row-minimumKB .field-unit").textContent === "KB");
  assert.equal($("#row-minimumKB .setting-description").textContent, "0 to 100,000. Skips icons and tiny clips.");
  field.value = "750";
  change(field);
  await settle();
  assert.equal(lastSave().minimumBytes, 750000);

  const count = sent.length;
  const jobs = $("#field-concurrentJobs");
  jobs.value = "9";
  change(jobs);
  await settle();
  assert.equal(savesSince(count).length, 0, "nothing is saved while invalid");
  assert.equal($("#row-concurrentJobs .setting-error").textContent, "Use a number from 1 to 6.");
  assert.equal($("#row-concurrentJobs .setting-error").hidden, false);
  assert.deepEqual(page.settingsSnapshot().invalid, ["concurrentJobs"]);
  jobs.value = "2";
  change(jobs);
  await settle();
  assert.equal(lastSave().concurrentJobs, 2);
  assert.equal($("#row-concurrentJobs .setting-error").hidden, true);
  assert.deepEqual(page.settingsSnapshot().invalid, []);
});

test("speed presets are a radio group and set both connection counts in one save", async () => {
  assert.equal($("#field-preset").getAttribute("role"), "radiogroup");
  // The stored 8 / 8 matches no preset: no segment is raised and the line says why.
  assert.equal($$("#field-preset [role=radio]").filter((option) => option.getAttribute("aria-checked") === "true").length, 0);
  assert.equal($("#row-preset .setting-description").textContent, "Custom. If downloads stall, choose Steady.");
  assert.equal($$("#field-preset [role=tab]").length, 0, "no tabs without tab panels");
  const fast = $$("#field-preset [role=radio]").find((option) => option.dataset.value === "fast");
  fast.click();
  await settle();
  assert.equal(lastSave().concurrentFragments, 12);
  assert.equal(lastSave().concurrentRanges, 12);
  assert.equal($("#field-concurrentFragments").value, "12");
  assert.equal(fast.getAttribute("aria-checked"), "true");
  assert.deepEqual($$("#field-preset [role=radio]").filter((option) => option.getAttribute("aria-checked") === "true").map((option) => option.dataset.value), ["fast"]);
  assert.equal($("#row-preset .setting-description").textContent, "If downloads stall, choose Steady.");
});

test("a failed save puts the stored values back, and a typed value stays on screen as unsaved", async () => {
  failSaves = true;
  try {
    $$("#field-preset [role=radio]").find((option) => option.dataset.value === "stable").click();
    await settle();
    assert.equal($("#field-concurrentFragments").value, "12", "the fields show what the worker uses");
    assert.equal($("#field-concurrentRanges").value, "12");
    assert.deepEqual($$("#field-preset [role=radio]").filter((option) => option.getAttribute("aria-checked") === "true").map((option) => option.dataset.value), ["fast"]);
    assert.equal($("#row-preset .setting-error").hidden, false);

    const jobs = $("#field-concurrentJobs");
    jobs.value = "5";
    change(jobs);
    await settle();
    assert.equal(jobs.value, "5", "the typed value stays");
    assert.deepEqual(page.settingsSnapshot().invalid, ["concurrentJobs"], "and counts as unsaved (leave-page warning)");
    assert.equal($("#row-concurrentJobs .setting-error").hidden, false);
  } finally {
    failSaves = false;
  }
  change($("#field-concurrentJobs"));
  await settle();
  assert.equal(lastSave().concurrentJobs, 5);
  assert.deepEqual(page.settingsSnapshot().invalid, []);
  assert.equal($("#row-concurrentJobs .setting-error").hidden, true);
});

test("file names: chips Title · Site · Type · Resolution · Date insert their tokens at the cursor, with a live preview", async () => {
  const labels = $$("#row-filename .token-chips button").map((chip) => chip.textContent);
  assert.deepEqual(labels, ["Title", "Site", "Type", "Resolution", "Date"]);
  const input = $("#field-filenameTemplate");
  input.selectionStart = input.value.length;
  input.selectionEnd = input.value.length;
  input.dispatchEvent(new Event("keyup"));
  $$("#row-filename .token-chips button").find((chip) => chip.dataset.token === "{height}").click();
  await settle();
  assert.equal(input.value, "{title}{height}");
  assert.equal(lastSave().filenameTemplate, "{title}{height}");
  assert.equal($("#filename-preview .filename-preview-value").textContent, "Sample video1080p.mp4", "the height reads as the worker writes it");
  const shown = $("#filename-preview [data-filename]");
  assert.equal(shown?.getAttribute("data-filename"), "Sample video1080p.mp4", "a filename: middle-truncated, extension kept");
  assert.ok(shown.className.split(" ").includes("t-row"), "in the row role");
  assert.ok(shown.querySelector(".filename-tail").textContent.endsWith(".mp4"));

  input.value = "{nope}";
  change(input);
  await settle();
  assert.match($("#row-filename .setting-error").textContent, /^Unknown field: \{nope\}/);
  assert.equal(input.getAttribute("aria-invalid"), "true", "the input itself is marked invalid");
  input.value = "{title} - {date}";
  change(input);
  await settle();
  assert.equal(lastSave().filenameTemplate, "{title} - {date}");
  assert.equal(input.hasAttribute("aria-invalid"), false);
});

test("ignored sites normalize on save and report bad lines by number", async () => {
  const field = $("#field-blockedDomains");
  field.value = "HTTPS://Ads.Example.com/path\nads.example.com";
  change(field);
  await settle();
  assert.deepEqual(lastSave().blockedDomains, ["ads.example.com"]);
  assert.equal(field.value, "ads.example.com");
  field.value = "good.example.com\n127.0.0.1";
  change(field);
  await settle();
  assert.equal($("#row-blockedDomains .setting-error").textContent, "Line 2 can’t be used.");
});

test("home-network downloads ask with the shared confirm popover before anything is saved", async () => {
  const toggle = $("#field-allowPrivateNetworkMedia");
  const count = sent.length;
  toggle.click();
  await settle();
  assert.equal($("#menuLayer").hidden, false, "the confirm popover is open");
  assert.equal(toggle.getAttribute("aria-checked"), "false", "not on until confirmed");
  assert.equal(savesSince(count).length, 0);
  const [keep, allow] = $$("#menuLayer .confirm-actions button");
  assert.equal(keep.textContent, "Cancel");
  assert.ok(allow.className.split(" ").includes("btn-tertiary"), "Allow is not styled as destructive");
  assert.equal(allow.className.split(" ").includes("btn-destructive"), false);
  keep.click();
  await settle();
  assert.equal(savesSince(count).length, 0, "cancelled: nothing saved");
  toggle.click();
  await settle();
  $$("#menuLayer .confirm-actions button")[1].click();
  await settle();
  assert.equal(lastSave().allowPrivateNetworkMedia, true);
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.equal($("#row-network .row-value").textContent, "On");
  assert.ok(allow);
});

test("notifications request permission inside the switch gesture; a refusal leaves them off with a one-line error", async () => {
  const toggle = $("#field-showNotifications");
  const count = sent.length;
  const before = requests.length;
  toggle.click();
  assert.equal(requests[before], "notifications", "requested synchronously");
  await settle();
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.equal($("#row-showNotifications .setting-error").textContent, "Chrome didn’t allow notifications.");
  assert.equal(savesSince(count).length, 0);
  grants.notifications = true;
  toggle.click();
  await settle();
  assert.equal(lastSave().showNotifications, true);
});

test("save location: Change and Show in Finder, the path as user content; the default needs no reset", async () => {
  const actions = $$("#row-location .trail-group button").filter((b) => !b.hidden).map((b) => b.textContent);
  assert.deepEqual(actions, ["Change", "Show in Finder"]);
  $("#location-change").click();
  await settle();
  assert.equal($("#row-location .setting-description").textContent, "~/Movies/Saved");
  assert.equal($("#location-reset").hidden, false, "a custom folder offers Use default");
  $("#location-reveal").click();
  await settle();
  assert.ok(sent.some((message) => message.type === "OPEN_DOWNLOAD_FOLDER"));

  cancelFolder = true;
  try {
    $("#location-change").click();
    await settle();
  } finally {
    cancelFolder = false;
  }
  assert.equal($("#row-location .setting-error").hidden, true, "closing the folder sheet is not an error");
  assert.equal($("#row-location .setting-description").textContent, "~/Movies/Saved");
});

test("privacy facts and shortcuts: Sign-in info carries its value; shortcuts use the approved names", () => {
  assert.equal($("#row-signin .row-value").textContent, "Never stored");
  assert.equal($("#row-signin .setting-description").textContent, "Used only for the site it came from.");
  assert.equal($("#row-cloud .row-value").textContent, "None");
  assert.equal($("#row-shortcuts .setting-description").textContent, "⌥⇧F Open Havre · ⌥⇧D All downloads · ⌥⇧W Open workspace");
  assert.equal(MESSAGES.zh["settings.shortcuts.workspace"], "打开工作台");
  assert.equal(MESSAGES.zh["settings.cap.protected"], "带数字版权加密的视频", "DRM, never 'copyrighted video'");
  assert.equal(MESSAGES.zh["settings.engine.descNotSetUp"], "Chrome 会弹出授权请求，点“允许”即可。");
  // The preview label and the sample name are centred, not tied to the nested flex baseline.
  assert.match(read("extension/options/options.css"), /\.filename-preview \{[^}]*align-items: center;/);
});

test("action buttons keep their own words as names; clicking a row name never runs an action", () => {
  const labelled = new Set($$("label.setting-name").map((label) => label.getAttribute("for")));
  for (const [id, rowId] of [["history-open", "row-history"], ["shortcuts-change", "row-shortcuts"], ["version-copy", "row-version"], ["editor-open", "row-editor"], ["location-change", "row-location"], ["engine-action", "row-engine"]]) {
    const action = $(`#${id}`);
    assert.ok(action, id);
    assert.equal(labelled.has(id), false, `${id} is not the target of a row label`);
    assert.equal(action.getAttribute("aria-labelledby"), null, `${id} is named by its own text`);
    assert.ok((action.getAttribute("aria-describedby") || "").split(" ").includes(`${rowId}-name`), `${id} is described by its row name`);
    assert.equal($(`#${rowId} .setting-name`).localName, "span", `${rowId}: the name is not a <label>`);
  }
  assert.equal($("#history-open").textContent, "All downloads");
});

test("a stored byte size survives saves of other settings", async () => {
  stored = { ...stored, minimumBytes: 307200 };
  $("#loadRetry").click();
  await settle(20);
  assert.equal($("#field-minimumKB").value, "307");
  $("#field-saveAs").click();
  await settle();
  assert.equal(lastSave().minimumBytes, 307200, "not rounded to 307,000");
  $("#field-saveAs").click();
  await settle();
});

test("engine states: a missing engine opens the install steps; Chrome's API recovery waits, then retries by itself", async () => {
  hostOverride = { connected: false, failureReason: "host_missing" };
  $("#engine-action").click();
  await settle();
  assert.equal($("#row-engine .row-status").textContent, "Not installed");
  assert.equal($("#row-engine .setting-description").textContent, "Install it with the steps below, then choose Retry.");
  assert.equal($("#install").open, true);
  assert.equal($("#engine-announce").getAttribute("role"), "status", "engine state changes are announced");
  assert.equal($("#engine-announce").textContent, "Local engine: Not installed. Install it with the steps below, then choose Retry.");
  assert.deepEqual($$("#sections .sr-only").map((node) => node.id).filter((id) => id.endsWith("-announce")), ["engine-announce"], "one engine row, one announcer");
  assert.equal($("#install").hidden, false, "the install steps come back when the engine breaks");
  assert.equal($("#engine-action").hidden, false);
  assert.equal($("#engine-action").textContent, "Retry");
  assert.equal($("#row-capability-0 .row-status").textContent, "Not installed", "the list mirrors the engine");

  hostOverride = { connected: false, failureReason: "api_unavailable" };
  recoverReply = { hostStatus: { connected: false, failureReason: "api_unavailable" }, retryAfterMs: 40 };
  const count = sent.length;
  $("#engine-action").click();
  await settle();
  assert.equal($("#row-engine .row-status").textContent, "Finishing setup…");
  assert.equal($("#row-engine .setting-description").textContent, "Trying again in 1 second…");
  const during = sent.length;
  await new Promise((resolve) => setTimeout(resolve, 60));
  await settle();
  assert.deepEqual(sent.slice(count, during).map((m) => m.type), ["PING_HOST", "RECOVER_NATIVE_API"]);
  assert.equal(sent[during]?.type, "PING_HOST", "after the wait the next message is a fresh ping");
  assert.equal($("#row-engine .row-status").textContent, "Ready");
  assert.equal($("#row-engine .setting-description").hidden, true);
  assert.equal($("#engine-announce").textContent, "Local engine: Ready.");
  assert.equal($("#install").hidden, true);
  assert.equal($("#row-capability-0 .row-status").textContent, "Yes");
});

test("Lab: Developer tools is off by default; on, it reveals the UI editor and version info", async () => {
  assert.equal($("#field-developerTools").getAttribute("aria-checked"), "false");
  assert.equal($("#field-developerTools").closest("section").id, "lab", "the row sits straight under Lab, no Developer sub-heading");
  assert.equal($("#developer-rows").hidden, true);
  assert.match($("#row-unsupported .setting-description").textContent, /^Live streams · Copy-protected video$/);
  $("#field-developerTools").click();
  await settle();
  assert.equal(local["havre.developerTools.v1"], true);
  assert.equal($("#developer-rows").hidden, false);
  assert.equal($("#editor-open").getAttribute("href"), "../designer/designer.html");
  assert.equal($("#row-versionExtensionId .row-value").textContent, "abcdefghijklmnopabcdefghijklmnop");
  assert.equal($("#row-versionCompat .row-status").textContent, "OK");
  $("#version-copy").click();
  await settle();
  assert.equal(JSON.parse(clipboard).extension.id, "abcdefghijklmnopabcdefghijklmnop");

  // The UI editor's layout values apply while Developer tools is on; its saved copy never does.
  await globalThis.chrome.storage.local.set({ "havre.uiCustomization.v1": { language: "en", pageTitle: "Preferences", sectionGap: 30 } });
  await settle();
  assert.equal($("#settingsTitle").textContent, "Settings", "saved copy never replaces v2 copy");
  assert.equal(doc.documentElement.style.props["--settings-section-gap"], "30px");
  assert.equal($$("[data-ui-copy]").length, 0, "no copy hooks on the page");

  $("#field-developerTools").click();
  await settle();
  assert.equal($("#developer-rows").hidden, true);
  assert.equal($("#settingsTitle").textContent, "Settings");
  assert.equal(doc.documentElement.style.props["--settings-section-gap"], undefined, "off: no override applies");
});

test("language: Auto / English / 中文 through a select; switching rebuilds the page in Chinese with no Latin UI words", async () => {
  const select = $("#field-language");
  assert.deepEqual(select.querySelectorAll("option").map((option) => option.textContent), ["Auto", "English", "中文"]);
  const english = visibleText($("#page"));
  assert.ok(english.every((line) => !CJK.test(line)), `no CJK in the English UI: ${english.filter((line) => CJK.test(line))}`);
  const jobs = $("#field-concurrentJobs");
  jobs.value = "9";
  change(jobs);
  await settle();
  select.value = "zh";
  change(select);
  await settle(20);
  assert.equal($("#field-concurrentJobs").value, "9", "an unsaved typed value survives the rebuild");
  assert.equal($("#row-concurrentJobs .setting-error").textContent, "请输入 1 到 6 之间的整数。");
  $("#field-concurrentJobs").value = "3";
  change($("#field-concurrentJobs"));
  await settle();
  assert.equal(doc.documentElement.getAttribute("lang"), "zh-CN");
  assert.equal($("#settingsTitle").textContent, "设置");
  assert.equal($("#row-direct .setting-name").textContent, "Instagram 与 X 视频", "the approved wording");
  assert.equal($("#row-saveAs .setting-name").textContent, "保存 Instagram 与 X 视频前先选择位置");
  assert.equal($("#field-language").value, "zh");
  assert.equal($("#row-language .saved-note").dataset.visible, "true");
  // The audit's rule: words of two or more letters, host names and paths removed.
  const leaks = visibleText($("#page")).flatMap((line) => (line.replace(/\b[\w-]+(\.[\w-]+)+\b/g, " ").match(/[A-Za-z][A-Za-z0-9'’-]*/g) || []).filter((word) => /[A-Za-z].*[A-Za-z]/.test(word) && !AUDIT_LATIN_OK.has(word.toLowerCase())));
  assert.deepEqual(leaks, [], "Chinese UI shows no Latin UI words");
  // Back to English for any later reader of this DOM.
  select.value = "en";
  change($("#field-language"));
  await settle(20);
});

test("a save that ends after a language switch catches the rebuilt controls up", async () => {
  let release;
  saveGate = new Promise((resolve) => { release = resolve; });
  const before = $("#field-saveAs").getAttribute("aria-checked");
  $("#field-saveAs").click();
  await settle();
  await globalThis.chrome.storage.local.set({ "havre.uiLanguage.v1": "zh" });
  await settle(20);
  assert.equal($("#settingsTitle").textContent, "设置", "rebuilt in Chinese while the save is held");
  saveGate = null;
  release();
  await settle(20);
  const expected = before === "true" ? false : true;
  assert.equal(stored.saveAs, expected);
  assert.equal($("#field-saveAs").getAttribute("aria-checked"), String(expected), "the new switch shows the stored value");
  assert.equal($("#row-saveAs .saved-note").dataset.visible, "true", "the note lands on the rebuilt row");
  await globalThis.chrome.storage.local.set({ "havre.uiLanguage.v1": "en" });
  await settle(20);
});

test("shortcuts are named for the platform: macOS glyphs stay on a Mac, elsewhere they are spelled out (v3 §3.8)", () => {
  assert.equal(page.shortcutLabel("⌥⇧F", "mac"), "⌥⇧F");
  assert.equal(page.shortcutLabel("⌥⇧F", "other"), "Alt+Shift+F");
  assert.equal(page.shortcutLabel("⌘⇧D", "other"), "Ctrl+Shift+D", "Command is Ctrl's counterpart, as in a manifest's suggested_key");
  assert.equal(page.shortcutLabel("⌃⌥W", "other"), "Ctrl+Alt+W");
  assert.equal(page.shortcutLabel("⌘⌃W", "other"), "Ctrl+W", "one Ctrl");
  assert.equal(page.shortcutLabel("Alt+Shift+F", "other"), "Alt+Shift+F", "Chrome's own key names pass through");
  assert.equal(page.shortcutLabel("", "mac"), "");
});
