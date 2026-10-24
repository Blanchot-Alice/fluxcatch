// v2 shared groundwork (step 5): message modules, errors, runtime, rows and
// the shared controls. Static checks on the sources plus node-level behaviour
// in a minimal DOM (below), since Chrome cannot run here.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// ---------- a minimal DOM, enough for the v2 builders ----------
// Minimal DOM for node probes: enough for the v2 builders, plus a serializer.
const REFLECT = { id: "id", title: "title", type: "type", alt: "alt", src: "src", decoding: "decoding", htmlFor: "for", href: "href", name: "name", placeholder: "placeholder", method: "method", inputMode: "inputmode", min: "min", max: "max", step: "step" };
const BOOL = { hidden: "hidden", disabled: "disabled", required: "required", noValidate: "novalidate" };
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
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(event) { event.target ??= this; event.currentTarget = this; for (const fn of this.listeners[event.type] || []) fn.call(this, event); if (event.bubbles && this.parentNode && !event.stopped) this.parentNode.dispatchEvent(event); return true; }
}
class Text extends Node { constructor(v) { super(); this.data = String(v); } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } }
class Element extends Node {
  constructor(tag, ns) { super(); this.tagName = ns ? tag : tag.toUpperCase(); this.localName = tag.toLowerCase(); this.attributes = new Map(); this.style = { props: {}, setProperty(k, v) { this.props[k] = v; }, getPropertyValue(k) { return this.props[k] ?? ""; } }; this.value = ""; this._raw = null;
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => self.getAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`) ?? undefined,
      set: (_, k, v) => { self.setAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`, String(v)); return true; },
      deleteProperty: (_, k) => { self.removeAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`); return true; },
      has: (_, k) => self.hasAttribute(`data-${String(k).replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`)
    });
    this.classList = { add: (...c) => { const s = new Set(this.className.split(/\s+/).filter(Boolean)); c.forEach((x) => s.add(x)); this.className = [...s].join(" "); }, remove: (...c) => { this.className = this.className.split(/\s+/).filter((x) => x && !c.includes(x)).join(" "); }, contains: (c) => this.className.split(/\s+/).includes(c), toggle: (c, f) => { const on = f ?? !this.classList.contains(c); on ? this.classList.add(c) : this.classList.remove(c); return on; } };
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
  focus() { globalThis.document.activeElement = this; }
  click() { this.dispatchEvent({ type: "click", bubbles: true }); }
  matches(selector) { return selector.split(",").some((part) => matchCompound(this, part.trim())); }
  closest(selector) { for (let e = this; e instanceof Element; e = e.parentNode) if (e.matches(selector)) return e; return null; }
  querySelectorAll(selector) { const out = []; const walk = (n) => { for (const c of n.children) { if (c.matches(selector)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
for (const [prop, attr] of Object.entries(REFLECT)) Object.defineProperty(Element.prototype, prop, { get() { return this.getAttribute(attr) ?? ""; }, set(v) { this.setAttribute(attr, String(v)); }, configurable: true });
for (const [prop, attr] of Object.entries(BOOL)) Object.defineProperty(Element.prototype, prop, { get() { return this.hasAttribute(attr); }, set(v) { if (v) this.setAttribute(attr, ""); else this.removeAttribute(attr); }, configurable: true });
// Simple selectors only: tag, .class, #id, [attr], [attr="v"], :first-child absent; descendant " " and child ">" supported.
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
  const test = (e, i) => {
    if (!matchSimple(e, parts[i])) return false;
    if (i === 0) return true;
    if (parts[i - 1] === ">") return e.parentNode instanceof Element && test(e.parentNode, i - 2);
    for (let p = e.parentNode; p instanceof Element; p = p.parentNode) if (test(p, i - 1)) return true;
    return false;
  };
  return test(el, parts.length - 1);
}
function installDom() {
  const doc = new Element("#document", true);
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (ns, tag) => new Element(tag, ns);
  doc.createTextNode = (v) => new Text(v);
  doc.activeElement = null;
  doc.documentElement = new Element("html");
  doc.body = new Element("body");
  doc.addEventListener = () => {};
  globalThis.document = doc;
  globalThis.Event = class Event { constructor(type, init = {}) { this.type = type; this.bubbles = Boolean(init.bubbles); } stopPropagation() { this.stopped = true; } preventDefault() { this.defaultPrevented = true; } };
  return doc;
}
function serialize(node) {
  if (node instanceof Text) return JSON.stringify(node.data);
  const attrs = [...node.attributes].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ");
  const style = Object.keys(node.style.props).length ? ` style=${JSON.stringify(node.style.props)}` : "";
  const inner = node._raw !== null ? `raw:${node._raw}` : node.childNodes.map(serialize).join("");
  return `<${node.localName}${attrs ? " " + attrs : ""}${style}>${inner}</${node.localName}>`;
}

installDom();
const { setUiLanguage } = await import("../extension/ui/v2/locale.js");
const { MESSAGES, MODULES, DISPLAY_KEYS, mergeModules, msg } = await import("../extension/ui/v2/messages.js");
const { errorText, userError, isKnownFailureCode } = await import("../extension/ui/v2/errors.js");
const { callWorker, connectWorkerPort, workerError } = await import("../extension/ui/v2/runtime.js");
const rows = await import("../extension/ui/v2/rows.js");
const components = await import("../extension/ui/v2/components.js");
const controls = await import("../extension/ui/v2/controls.js");
const { classifyJobFailure, describeJobFailure, FAILURE_CODES } = await import("../extension/lib/job-failure.js");
const { scanColourLiterals } = await import("../scripts/design-audit.mjs");

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const CJK = /[㐀-鿿　-〿＀-￯]/;
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const V2_JS = readdirSync(new URL("../extension/ui/v2/", import.meta.url)).filter((file) => file.endsWith(".js")).map((file) => `extension/ui/v2/${file}`);
const MESSAGE_FILES = readdirSync(new URL("../extension/ui/v2/messages/", import.meta.url)).filter((file) => file.endsWith(".js"));
const click = (element) => element.dispatchEvent(new Event("click", { bubbles: true }));
const key = (element, name) => element.dispatchEvent(Object.assign(new Event("keydown", { bubbles: true }), { key: name }));

// ---------- message modules ----------

const PREFIXES = {
  common: ["brand.", "action.", "status.", "job.", "toast.", "group.", "time."],
  downloads: ["downloads."],
  media: ["media."],
  popup: ["popup."],
  sidepanel: ["sidepanel."],
  settings: ["settings."],
  preview: ["preview."],
  worker: ["worker."]
};

test("every message module exists, is { en, zh, display } with identical keys, and keeps to its own prefix", () => {
  assert.deepEqual(Object.keys(MODULES).sort(), Object.keys(PREFIXES).sort(), "one module per surface plus common");
  assert.deepEqual(MESSAGE_FILES.map((file) => file.replace(/\.js$/, "")).sort(), Object.keys(PREFIXES).sort(), "messages/ holds exactly these modules");
  for (const [name, module] of Object.entries(MODULES)) {
    assert.deepEqual(Object.keys(module).sort(), ["display", "en", "zh"], `${name} shape`);
    assert.ok(Array.isArray(module.display), `${name}.display is an array`);
    assert.deepEqual(Object.keys(module.zh).sort(), Object.keys(module.en).sort(), `${name}: en and zh have the same keys`);
    for (const id of Object.keys(module.en)) {
      assert.ok(PREFIXES[name].some((prefix) => id.startsWith(prefix)), `${name} owns ${id}? keys must start with ${PREFIXES[name].join(" | ")}`);
    }
    for (const id of module.display) {
      assert.ok(Object.hasOwn(module.zh, id), `${name}: Display key ${id} exists`);
      assert.equal(typeof module.zh[id], "string", `${name}: Display key ${id} is a fixed string (the font subset needs its glyphs)`);
    }
  }
  assert.deepEqual([...DISPLAY_KEYS], Object.values(MODULES).flatMap((module) => module.display), "DISPLAY_KEYS merges every module's display list");
});

test("messages.js throws at load on a key defined by two modules", () => {
  const a = { en: { "x.one": "One" }, zh: { "x.one": "一" }, display: [] };
  const b = { en: { "x.one": "Uno" }, zh: { "x.one": "一" }, display: [] };
  assert.throws(() => mergeModules({ a, b }), /duplicate key "x\.one" in a and b/);
  const zhOnly = { en: {}, zh: { "x.one": "一" }, display: [] };
  assert.throws(() => mergeModules({ a, zhOnly }), /duplicate key/, "a key in only one language still counts");
  assert.doesNotThrow(() => mergeModules(MODULES));
  assert.match(read("extension/ui/v2/messages.js"), /Ownership convention: one module per surface/);
});

test("msg() keeps its contract: UI language first, English fallback, then the key itself", () => {
  setUiLanguage("en");
  assert.equal(msg("action.download"), "Download");
  assert.equal(msg("downloads.summary", { count: 1, size: "2 GB" }), "1 file · 2 GB");
  assert.equal(msg("no.such.key"), "no.such.key");
  setUiLanguage("zh");
  assert.equal(msg("action.download"), "下载");
  assert.equal(msg("status.engineNotSetUp"), "本地引擎尚未设置");
  assert.ok(Object.isFrozen(MESSAGES) && Object.isFrozen(MESSAGES.en), "the merged tables are read-only");
});

test("scripts/build-display-font.mjs still reads the merged Display keys", async () => {
  const { displayGlyphs } = await import("../scripts/build-display-font.mjs");
  const glyphs = displayGlyphs();
  for (const id of DISPLAY_KEYS) for (const ch of MESSAGES.zh[id]) if (CJK.test(ch)) assert.ok(glyphs.includes(ch), `${ch} of ${id}`);
});

// ---------- errors.js and runtime.js ----------

test("errorText: user copy, then a known code, then classified text, then the generic sentence", () => {
  setUiLanguage("en");
  assert.equal(errorText(userError("Enter a link")), "Enter a link");
  const coded = Object.assign(new Error("anything"), { code: "disk_full", params: {} });
  assert.equal(errorText(coded), describeJobFailure({ code: "disk_full", params: {} }, "en"));
  assert.ok(isKnownFailureCode("http_forbidden") && !isKnownFailureCode("unknown") && !isKnownFailureCode("nope"));
  assert.ok(FAILURE_CODES.includes("unknown"));
  const unknownCode = Object.assign(new Error(""), { code: "unknown" });
  assert.equal(errorText(unknownCode), msg("toast.genericError"), "the unknown code falls through to the fallbacks");
  const classified = new Error("分片 12 请求失败：HTTP 403");
  const failure = classifyJobFailure({ text: classified.message });
  assert.notEqual(failure.code, "unknown", "the sample is classifiable");
  assert.equal(errorText(classified), describeJobFailure(failure, "en"));
  assert.ok(!CJK.test(errorText(classified)), "classified engine text is localised, never raw");
  assert.equal(errorText(new Error("")), msg("toast.genericError"));
  assert.equal(errorText(new Error("某个未知的中文错误")), msg("toast.genericError"), "untranslatable Chinese never reaches the English UI");
  for (const raw of ["Traceback (most recent call last): File \"/opt/host.py\", line 3", "Error: ENOENT /Users/someone/secret.mp4", "Could not establish connection. Receiving end does not exist."]) {
    assert.equal(errorText(new Error(raw)), msg("toast.genericError"), `raw engine or Chrome text never reaches the English UI: ${raw}`);
  }
  assert.equal(errorText(new Error("下载记录读取失败")), msg("toast.genericError"), "no v1 catalogue: unclassified Chinese is the generic sentence");
  setUiLanguage("zh");
  assert.equal(errorText(new Error("某个未知的中文错误")), msg("toast.genericError"), "raw text never reaches the Chinese UI either");
  assert.equal(errorText(classified), describeJobFailure(failure, "zh"), "classified text in the Chinese UI");
  assert.equal(errorText(new Error("Some English failure")), msg("toast.genericError"), "Latin text never reaches the Chinese UI");
  assert.equal(errorText(coded), describeJobFailure({ code: "disk_full", params: {} }, "zh"));
});

test("downloads.js uses errors.js and runtime.js instead of its own copies", () => {
  const source = stripComments(read("extension/downloads/downloads.js"));
  assert.match(source, /from "\.\.\/ui\/v2\/errors\.js"/);
  assert.match(source, /from "\.\.\/ui\/v2\/runtime\.js"/);
  assert.match(source, /from "\.\.\/ui\/v2\/rows\.js"/);
  assert.doesNotMatch(source, /function (errorText|userError|call|historyRow|buildLive|leadFor|line)\(/, "no private copies left");
  assert.doesNotMatch(source, /translateMessage|classifyJobFailure/, "error wording lives in errors.js");
  assert.doesNotMatch(read("extension/ui/v2/errors.js"), /translateMessage|i18n\.js/, "errors.js has no v1 catalogue fallback");
});

test("callWorker keeps code, params and jobId from a failed worker answer", async () => {
  const error = workerError({ ok: false, error: "raw", code: "disk_full", params: { free: 1 }, jobId: "j1" });
  assert.equal(error.message, "raw");
  assert.equal(error.code, "disk_full");
  assert.deepEqual(error.params, { free: 1 });
  assert.equal(error.jobId, "j1");
  assert.equal(workerError(undefined).message, "");
  const sent = [];
  globalThis.chrome = { runtime: { sendMessage: async (message) => { sent.push(message); return message.type === "OK" ? { ok: true, value: 2 } : { ok: false, error: "nope", code: "engine_missing" }; } } };
  assert.deepEqual(await callWorker({ type: "OK" }), { ok: true, value: 2 });
  await assert.rejects(callWorker({ type: "BAD" }), (thrown) => thrown.code === "engine_missing" && thrown.message === "nope");
  assert.deepEqual(sent.map((m) => m.type), ["OK", "BAD"]);
  delete globalThis.chrome;
});

test("connectWorkerPort reconnects with backoff, resyncs, keeps one live port, and reports a loss once", async () => {
  const ports = [];
  const makePort = () => {
    const port = { closed: false, message: [], drop: [], onMessage: { addListener: (fn) => port.message.push(fn) }, onDisconnect: { addListener: (fn) => port.drop.push(fn) }, disconnect() { port.closed = true; } };
    ports.push(port);
    return port;
  };
  let fail = false;
  globalThis.chrome = { runtime: { connect: ({ name }) => { if (fail) throw new Error("Extension context invalidated."); assert.equal(name, "fluxcatch-downloads"); return makePort(); } } };
  mock.timers.enable({ apis: ["setTimeout"] });
  const flush = async () => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };
  try {
    const received = [];
    const answers = [true];
    let resyncs = 0;
    let lost = 0;
    connectWorkerPort({
      name: "fluxcatch-downloads",
      onMessage: (message) => received.push(message.type),
      onReconnect: async () => { resyncs += 1; return answers.shift() ?? false; },
      onLost: () => { lost += 1; },
      delays: [300, 1000, 3000]
    });
    assert.equal(ports.length, 1, "connects at once");
    ports[0].message.forEach((fn) => fn({ type: "JOB_UPDATED" }));
    // The idle worker drops the port: nothing happens until the first delay.
    ports[0].drop.forEach((fn) => fn());
    mock.timers.tick(299);
    await flush();
    assert.equal(ports.length, 1);
    mock.timers.tick(1);
    await flush();
    assert.equal(ports.length, 2, "reconnects after 300 ms");
    assert.equal(resyncs, 1, "and resyncs");
    ports[0].message.forEach((fn) => fn({ type: "STALE" }));
    ports[1].message.forEach((fn) => fn({ type: "JOBS_UPDATED" }));
    assert.deepEqual(received, ["JOB_UPDATED", "JOBS_UPDATED"], "only the live port delivers");
    // A successful resync resets the backoff: the next drop waits 300 ms again.
    ports[1].drop.forEach((fn) => fn());
    mock.timers.tick(300);
    await flush();
    assert.equal(ports.length, 3);
    assert.ok(ports[1].closed, "one live port at a time");
    // This resync finds no worker: 1000 ms, then 3000 ms, then the loss.
    mock.timers.tick(1000);
    await flush();
    assert.equal(ports.length, 4);
    mock.timers.tick(3000);
    await flush();
    assert.equal(ports.length, 5);
    assert.equal(lost, 1, "every attempt failed: the loss is reported");
    mock.timers.tick(10_000);
    await flush();
    assert.equal(lost, 1, "once");

    fail = true;
    let lostAtOnce = 0;
    connectWorkerPort({ name: "fluxcatch-downloads", onMessage() {}, onLost: () => { lostAtOnce += 1; } });
    assert.equal(lostAtOnce, 1, "a page that cannot connect at all says so straight away");
  } finally {
    mock.timers.reset();
    delete globalThis.chrome;
  }
});

test("the Downloads page keeps its port through connectWorkerPort and resyncs the history", () => {
  const source = stripComments(read("extension/downloads/downloads.js"));
  assert.match(source, /connectWorkerPort\(\{\s*name: "fluxcatch-downloads"/);
  assert.match(source, /onReconnect: \(\) => \(initStarted \? refreshHistory\(\{ quiet: true, keepOnError: true \}\) : true\)/);
  assert.doesNotMatch(source, /chrome\.runtime\.connect\(/, "no one-shot port");
  assert.match(source, /options\/options\.html#local-engine/, "Set up opens Settings at the local engine");
  assert.doesNotMatch(source, /localCapabilities/, "not the legacy hash");
  for (const file of ["extension/popup/popup.js", "extension/sidepanel/sidepanel.js"]) {
    assert.match(stripComments(read(file)), /import \{[^}]*connectWorkerPort[^}]*\} from "\.\.\/ui\/v2\/runtime\.js"/, file);
  }
});

// ---------- rows.js ----------

const NOW = new Date(2026, 9, 21, 15, 0).getTime();
const RECORDS = {
  done: { jobId: "h1", status: "completed", filename: "Interstellar Trailer 4K.mp4", total: 2.35e9, media: { duration: 148, height: 2160, container: "mp4" }, sourceUrl: "https://www.youtube.com/watch?v=x", hasSource: true, hasFile: true, finishedAt: NOW - 3_600_000, thumbnail: "data:image/jpeg;base64,AAAA" },
  missing: { jobId: "h2", status: "completed", filename: "Keynote.m4a", size: 48_300_000, hasFile: true, fileMissing: true, finishedAt: NOW - 90_000_000 },
  failed: { jobId: "h3", status: "failed", filename: "Lecture 12 · Pharmacokinetics.mp4", error: "分片 12 请求失败：HTTP 403", retryable: true, kind: "hls", createdAt: NOW - 3 * 86_400_000 },
  cancelled: { jobId: "h4", status: "cancelled", filename: "clip", kind: "dash", createdAt: NOW - 20 * 86_400_000 }
};

test("history rows show a status only for exceptions, and hand actions to the caller", () => {
  setUiLanguage("en");
  const calls = [];
  const onAction = (action, record) => calls.push(`${action}:${record.jobId}`);
  const done = rows.historyRow(RECORDS.done, { now: NOW, onAction });
  assert.equal(done.localName, "li");
  assert.equal(done.className, "row");
  assert.deepEqual(done.children.map((c) => c.className), ["row-lead", "row-main", "row-trail"]);
  assert.equal(done.querySelector(".row-trail > .status"), null, "completed rows carry no status");
  assert.equal(done.querySelector(".row-meta").textContent, "MP4 · 2160p · 2.4 GB · 2:28");
  assert.match(done.querySelector(".row-source").textContent, /^youtube\.com · 1 hr\.? ago$/);
  assert.ok(done.querySelector(".row-lead > .lead-frame[data-indicator] > img"), "full pages frame the media's own thumbnail (v3 §3.5)");
  const plain = rows.historyRow({ ...RECORDS.done, thumbnail: null }, { now: NOW });
  assert.ok(plain.querySelector(".row-lead > .lead-frame[data-indicator] > svg") && !plain.querySelector("img"), "without a thumbnail the frame holds the type glyph");
  assert.ok(rows.historyRow(RECORDS.done, { now: NOW, poster: false }).querySelector(".row-lead > svg"), "poster: false shows the type glyph");
  click(done.querySelector('[data-action="open"]'));
  click(done.querySelector('[data-action="more"]'));
  const failed = rows.historyRow(RECORDS.failed, { now: NOW, onAction });
  assert.equal(failed.querySelector(".row-trail > .status").dataset.tone, "failed");
  assert.ok(!CJK.test(failed.querySelector(".row-meta").textContent), "the reason line is localised");
  click(failed.querySelector('[data-action="retry"]'));
  assert.deepEqual(calls, ["open:h1", "more:h1", "retry:h3"]);
  assert.equal(rows.historyRow(RECORDS.missing, { now: NOW }).querySelector(".status").dataset.tone, "warning");
  assert.equal(rows.historyRow(RECORDS.cancelled, { now: NOW }).querySelector(".status").dataset.tone, "cancelled");
  assert.equal(rows.historyRow(RECORDS.missing, { now: NOW }).querySelector('[data-action="open"]'), null, "no Open for a missing file");
  assert.equal(rows.mediaKindOf({ kind: "hls" }), "stream");
  assert.equal(rows.mediaKindOf({ filename: "a.flac" }), "audio");
  assert.equal(rows.mediaKindOf({}), "video");
});

test("live rows update in place; the focus panel adds the 6px bar and Details", () => {
  setUiLanguage("en");
  const job = { jobId: "j1", status: "downloading", filename: "Keynote 2026.mp4", progress: 0.31, bytes: 372e6, total: 1.2e9, speed: 56.3e6, pausable: true, message: "" };
  const controlsSeen = [];
  const row = rows.liveRow(job);
  rows.updateLiveRow(row, job, { onControl: (action) => controlsSeen.push(action) });
  assert.equal(row.root.localName, "li");
  assert.ok(row.root.hasAttribute("data-live"));
  assert.equal(row.root.querySelector(".progress").dataset.size, "row");
  assert.equal(row.root.querySelector(".progress").getAttribute("role"), "progressbar");
  assert.equal(row.root.querySelector(".progress").getAttribute("aria-valuenow"), "31");
  // Most useful first, so a narrow row ellipses the size, never the time left.
  assert.match(row.meta.textContent, /^Downloading31% · 0:15 left · 56.3 MB\/s · 372 MB of 1.2 GB$/);
  assert.equal(row.meta.children[0].className, "status t-meta", "the meta line starts with the dot and word");
  assert.equal(row.meta.parentElement.className, "row-main", "the meta stays in row-main (live rows lay it out under the controls in CSS)");
  const compact = rows.liveRow(job, { compact: true });
  rows.updateLiveRow(compact, job);
  assert.equal(compact.meta.textContent, "Downloading31% · 0:15 left · 56.3 MB/s", "compact (popup, side panel) leaves the size out");
  const pause = row.actions.querySelector('[data-action="pause"]');
  const latest = [];
  rows.updateLiveRow(row, { ...job, progress: 0.5 }, { onControl: (action, current) => { controlsSeen.push(action); latest.push(current.progress); } });
  assert.equal(row.actions.querySelector('[data-action="pause"]'), pause, "controls are not rebuilt while the state is unchanged");
  click(pause);
  click(row.actions.querySelector('[data-action="cancel"]'));
  assert.deepEqual(controlsSeen, ["pause", "cancel"]);
  assert.deepEqual(latest, [0.5, 0.5], "kept controls call the latest onControl with the latest job");
  rows.updateLiveRow(row, job, { finishing: { phase: "complete" } });
  assert.equal(row.actions.children.length, 0, "a finishing row drops its controls");
  assert.equal(row.root.querySelector(".progress").dataset.state, "complete");
  assert.equal(row.meta.querySelector(".status").dataset.tone, "complete");
  // v3 §3.2: the bar is the state's colour, so the state names it; no percentage hue.
  assert.deepEqual(["queued", "starting", "downloading", "paused", "pausing", "remuxing", "failed"].map((status) => rows.barState({ status })), ["queued", "queued", "active", "paused", "paused", "finishing", "failed"]);
  assert.equal(rows.barState({ status: "downloading" }, { phase: "settled" }), "settled");
  const remuxing = rows.liveRow({ ...job, status: "remuxing", progress: 1 });
  rows.updateLiveRow(remuxing, { ...job, status: "remuxing", progress: 1 });
  assert.equal(remuxing.root.querySelector(".progress").dataset.state, "finishing");

  const stream = { ...job, jobId: "j2", total: 0, message: "分片 74/120", kind: "hls" };
  const panel = rows.liveRow(stream, { focus: true });
  rows.updateLiveRow(panel, stream, { samples: [1e6, 4e6, 6e6] });
  assert.equal(panel.root.localName, "article");
  assert.equal(panel.root.className, "focus-panel");
  assert.equal(panel.root.querySelector(".progress").dataset.size, "panel");
  assert.ok(panel.root.querySelector("details.focus-details > summary > svg.icon"), "Details carries an open/closed chevron");
  assert.equal(panel.root.querySelector("details.focus-details > summary").textContent, "Details");
  // A stream counted in parts: size so far and an estimated time left in the row, the count only in Details.
  assert.equal(panel.meta.textContent, "Downloading31% · 0:15 left · 56.3 MB/s · 372 MB");
  assert.doesNotMatch(panel.meta.textContent, /parts/, "parts never appear in the row (rename table: only inside Details)");
  assert.equal(panel.root.querySelector(".segment-map"), null, "an aggregate count draws no map: it would repeat the bar");
  assert.ok(panel.root.querySelector(".details-body > .speed-block > svg.speed-chart"), "speed line with two or more samples");
  assert.equal(panel.root.querySelector(".speed-chart").getAttribute("viewBox"), "0 0 640 24");
  assert.equal(panel.root.querySelector(".details-body > .speed-block > p.t-meta").textContent, "74 of 120 parts · Now 6.0 MB/s · Peak 6.0 MB/s", "one precision for both rates");
  const levels = rows.segmentMap([1, 1, 1, 0.5, 0, 1], 60);
  assert.ok(levels.hasAttribute("data-indicator") && levels.getAttribute("role") === "img");
  assert.deepEqual([...levels.children].map((cell) => [cell.style.getPropertyValue("--level"), cell.style.flexGrow]), [["1.000", "3"], ["0.500", "1"], ["0.000", "1"], ["1.000", "1"]], "finished neighbours merge into one run");
  assert.equal(levels.getAttribute("aria-label"), "4 of 6 parts");
  const mapped = rows.liveRow({ ...stream, segments: [1, 1, 0.4, 0] }, { focus: true });
  rows.updateLiveRow(mapped, { ...stream, segments: [1, 1, 0.4, 0] });
  assert.ok(mapped.root.querySelector(".details-body > .segment-map"), "real per-part levels draw the map");
  const finishingJob = { ...job, status: "remuxing", progress: 1, message: "正在无损封装" };
  const remux = rows.liveRow(finishingJob);
  rows.updateLiveRow(remux, finishingJob);
  assert.equal(remux.meta.textContent, "Finishing", "no echo of the status word, no 100%");
  rows.updateLiveRow(remux, { ...finishingJob, message: "正在合并音视频" });
  assert.equal(remux.meta.textContent, "FinishingJoining picture and sound", "a distinct engine step still shows");
  const quiet = rows.liveRow(job, { focus: true });
  rows.updateLiveRow(quiet, job, { samples: [] });
  assert.ok(quiet.details.element.hidden, "Details hides when it has nothing to show");
});

test("updateLiveRow keeps keyboard focus in place when a state change rebuilds the controls", () => {
  setUiLanguage("en");
  const job = { jobId: "f1", status: "downloading", filename: "Talk.mp4", progress: 0.2, pausable: true, resumable: true, message: "" };
  const view = rows.liveRow(job);
  rows.updateLiveRow(view, job);
  view.actions.querySelector('[data-action="pause"]').focus();
  rows.updateLiveRow(view, { ...job, status: "paused" });
  assert.equal(document.activeElement, view.actions.querySelector('[data-action="resume"]'), "Pause becomes Resume and keeps focus");
  view.actions.querySelector('[data-action="cancel"]').focus();
  rows.updateLiveRow(view, { ...job, status: "pausing", pausable: false });
  assert.equal(document.activeElement, view.actions.querySelector('[data-action="cancel"]'), "focus stays on the control in the same place");
  const other = document.createElement("button");
  other.focus();
  rows.updateLiveRow(view, { ...job, status: "downloading" });
  assert.equal(document.activeElement, other, "focus elsewhere is never taken");
});

test("downloadRow serves detected media: glyph lead, meta, source and a visible core verb", () => {
  setUiLanguage("en");
  const download = components.button({ kind: "secondary", label: msg("action.download"), action: "download" });
  const row = rows.downloadRow({ lead: rows.rowLead({ kind: "hls", thumbnail: "data:image/png;base64,AA" }, { poster: false }), title: "Talk.mp4", meta: "MP4 · 1080p", source: "example.com", actions: [download], actionsVisible: true, id: "m1" });
  assert.equal(row.dataset.actions, "visible");
  assert.equal(row.dataset.itemId, "m1");
  assert.ok(row.querySelector(".row-lead > svg") && !row.querySelector("img"), "no poster frames in the popup and side panel");
  assert.equal(row.querySelector(".row-meta").textContent, "MP4 · 1080p");
  assert.equal(row.querySelector(".row-source").textContent, "example.com");
  assert.equal(row.querySelector(".row-actions > button"), download);
  assert.equal(rows.downloadRow({ title: "x" }).querySelector(".row-meta"), null, "empty lines are left out");
});

// ---------- shared components and controls ----------

test("statusLine: dot in the lead column, text and tertiary actions on the text column, role=status", () => {
  setUiLanguage("en");
  let ran = 0;
  const line = components.statusLine({ text: msg("status.engineNotSetUp"), actions: [{ label: msg("action.setUp"), run: () => { ran += 1; } }] });
  assert.equal(line.localName, "p");
  assert.equal(line.className, "status-line lead-grid");
  assert.equal(line.getAttribute("role"), "status");
  assert.equal(line.querySelector(".line-dot").getAttribute("aria-hidden"), "true");
  assert.ok(line.querySelector(".line-dot").hasAttribute("data-indicator"), "the dot is an indicator, not a container");
  assert.equal(line.querySelector(".line-text").textContent, "Local engine isn’t set up" + "Set up");
  click(line.querySelector(".line-actions > button.btn-tertiary"));
  assert.equal(ran, 1);
  components.setStatusLine(line, { text: "" });
  assert.equal(line.children.length, 0, "an empty text clears the line");
});

test("setStatusLine is idempotent: the same line keeps its nodes and focus, and swaps in new handlers", () => {
  setUiLanguage("en");
  const container = document.createElement("p");
  const calls = [];
  const spec = (tag) => ({ text: msg("downloads.notificationsOff"), actions: [{ label: msg("action.turnOn"), run: () => calls.push(`on:${tag}`) }, { label: msg("action.dontNotify"), run: () => calls.push(`off:${tag}`) }] });
  components.setStatusLine(container, spec("a"));
  const [turnOn, dontNotify] = container.querySelectorAll(".line-actions > button");
  dontNotify.focus();
  components.setStatusLine(container, spec("b"));
  assert.equal(container.querySelectorAll(".line-actions > button")[1], dontNotify, "unchanged copy keeps the same buttons");
  assert.equal(document.activeElement, dontNotify);
  click(turnOn);
  assert.deepEqual(calls, ["on:b"], "the latest handler runs");
  components.setStatusLine(container, { text: msg("status.engineNotSetUp"), actions: [{ label: msg("action.setUp"), run() {} }] });
  assert.equal(document.activeElement, container.querySelector(".line-actions > button"), "a changed line keeps focus on its action");
  container.replaceChildren();
  components.setStatusLine(container, { text: msg("status.engineNotSetUp"), actions: [{ label: msg("action.setUp"), run() {} }] });
  assert.equal(container.children.length, 2, "a line cleared by the caller is rebuilt");
});

test("listHeader: title role heading, count hidden at 0, trailing tertiary actions", () => {
  const header = components.listHeader({ title: "Media on this page", count: 0, actions: [{ label: "Rescan", run() {} }, { label: "Clear results", run() {} }] });
  assert.equal(header.element.className, "list-header");
  assert.equal(header.heading.localName, "h2");
  assert.ok(header.heading.className.includes("t-title"));
  assert.ok(header.count.hidden && header.count.textContent === "");
  header.setCount(3);
  // The leading space separates the count in the heading's accessible name.
  assert.ok(!header.count.hidden && header.count.textContent === " 3" && header.count.className.includes("t-meta"));
  assert.equal(header.actions.children.length, 2);
  assert.ok(header.actions.children.every((b) => b.className === "btn btn-tertiary"));
  assert.ok(header.meta.hidden && !header.meta.hasAttribute("data-user-content"), "no meta by default");

  const hosted = components.listHeader({ title: "Media on this page", meta: "www.example.com", metaUserContent: true });
  assert.equal(hosted.meta.className, "list-meta t-meta");
  assert.ok(hosted.meta.hasAttribute("data-user-content"), "user content is marked");
  assert.equal(hosted.heading.lastElementChild, hosted.meta, "the meta follows the title");
  assert.equal(hosted.meta.textContent, "www.example.com");
  hosted.setMeta("");
  assert.ok(hosted.meta.hidden, "hidden while empty");
  const system = read("extension/ui/v2/system.css");
  assert.match(system, /\.list-title \.list-meta \{[^}]*text-overflow: ellipsis;/s);
  assert.doesNotMatch(read("extension/ui/v2/media.css"), /list-meta/, "no local copy");
});

test("runAction is single-flight per key, busy while it runs, and restores or keeps the disabled state", async () => {
  const button = components.button({ label: "Clear finished" });
  let release;
  let runs = 0;
  const first = components.runAction(button, "clear", () => { runs += 1; return new Promise((resolve) => { release = resolve; }); });
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.textContent, "Clear finished", "labels never change");
  assert.equal(await components.runAction(button, "clear", () => { runs += 1; }), undefined, "a second run of the same key is ignored");
  release("done");
  assert.equal(await first, "done");
  assert.equal(runs, 1);
  assert.equal(button.disabled, false, "re-enabled after the task");
  assert.equal(button.hasAttribute("aria-busy"), false);

  let left = 0;
  await components.runAction(button, "clear", async () => { left = 0; }, { keepDisabled: () => left === 0 });
  assert.equal(button.disabled, true, "keepDisabled wins over the restore");
  button.disabled = false;
  const errors = [];
  await components.runAction(button, "clear", async () => { throw new Error("nope"); }, { onError: (error) => errors.push(error.message), keepDisabled: () => false });
  assert.deepEqual(errors, ["nope"]);
  assert.equal(button.disabled, false, "a failed task restores the button too");
  button.disabled = true;
  await components.runAction(button, "other", async () => {}, { keepDisabled: () => false });
  assert.equal(button.disabled, true, "an element that was disabled before stays disabled");
});

test("emptyState: one sentence, one body line, at most one action, on the text column", () => {
  let ran = false;
  const empty = components.emptyState({ sentence: "Nothing here yet.", body: "Play the video, then rescan.", action: { label: "Rescan", kind: "primary", run: () => { ran = true; } } });
  assert.equal(empty.element.className, "empty-state text-column");
  assert.deepEqual(empty.element.children.map((c) => c.className), ["t-empty", "t-body", "btn btn-primary"]);
  click(empty.action);
  assert.ok(ran);
  empty.update({ sentence: "No match." });
  assert.ok(empty.action.hidden && empty.body.hidden);
});

test("switchControl is the one boolean control: role=switch, aria-checked, change event, disabled", () => {
  const changes = [];
  const toggle = controls.switchControl({ id: "notify", checked: false, onChange: (on) => changes.push(on) });
  assert.equal(toggle.localName, "button");
  assert.equal(toggle.type, "button");
  assert.equal(toggle.getAttribute("role"), "switch");
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.ok(toggle.querySelector(".switch-thumb[aria-hidden]"));
  let bubbled = 0;
  toggle.addEventListener("change", () => { bubbled += 1; });
  click(toggle);
  assert.equal(toggle.getAttribute("aria-checked"), "true");
  assert.ok(controls.isSwitchOn(toggle));
  controls.setSwitch(toggle, false);
  assert.equal(toggle.getAttribute("aria-checked"), "false");
  assert.deepEqual(changes, [true]);
  assert.equal(bubbled, 1);
  const off = controls.switchControl({ disabled: true });
  click(off);
  assert.equal(off.getAttribute("aria-checked"), "false", "a disabled switch does not toggle");
  assert.ok(off.disabled);
});

test("select, textField and numberField build on .field with tonal fill, sizes and units", () => {
  const picked = [];
  const choice = controls.select({ id: "format", options: [{ value: "mp4", label: "MP4" }, { value: "mkv", label: "MKV" }], value: "mkv", size: "compact", onChange: (value) => picked.push(value) });
  assert.equal(choice.className, "field select-field");
  assert.equal(choice.dataset.size, "compact");
  assert.ok(choice.hasAttribute("data-field"));
  const native = controls.controlOf(choice);
  assert.equal(native.localName, "select");
  assert.equal(native.value, "mkv");
  assert.equal(native.children.length, 2);
  assert.ok(choice.querySelector(".field-glyph.field-chevron > svg"), "chevron glyph");
  native.value = "mp4";
  native.dispatchEvent(new Event("change"));
  assert.deepEqual(picked, ["mp4"]);
  controls.setOptions(choice, [{ value: "webm", label: "WebM" }], "webm");
  assert.equal(native.value, "webm");

  const size = controls.numberField({ id: "minimum", value: 500, unit: "KB", min: 0, max: 102400 });
  const input = controls.controlOf(size);
  assert.equal(input.type, "number");
  assert.equal(input.inputMode, "numeric");
  assert.equal(input.min, "0");
  assert.equal(input.max, "102400");
  assert.equal(size.dataset.width, "short");
  const unit = size.querySelector(".field-unit.t-meta");
  assert.equal(unit.textContent, "KB");
  assert.match(input.getAttribute("aria-describedby"), /minimum-unit/);
  const area = controls.textField({ multiline: true, rows: 6, label: "Blocked sites" });
  assert.equal(controls.controlOf(area).localName, "textarea");
  assert.ok(area.hasAttribute("data-multiline"));
  assert.equal(controls.controlOf(area).getAttribute("aria-label"), "Blocked sites");
});

test("settingRow labels its control, describes it, and confirms saves inline for about 2 s", () => {
  setUiLanguage("en");
  const toggle = controls.switchControl({});
  const row = controls.settingRow({ id: "notifications", name: "Notify me", description: "When a download finishes.", control: toggle });
  assert.equal(row.className, "setting-row");
  const name = row.querySelector(".setting-name");
  assert.equal(name.localName, "label");
  assert.ok(name.className.includes("t-row"));
  assert.equal(name.htmlFor, toggle.id);
  assert.ok(row.querySelector(".setting-description").className.includes("t-body"));
  assert.match(toggle.getAttribute("aria-describedby"), /notifications-description/);
  assert.equal(row.querySelector(".setting-trail").lastElementChild, toggle, "the control sits on the trailing edge");
  const note = row.querySelector(".saved-note");
  assert.equal(note.getAttribute("role"), "status");
  assert.equal(note.dataset.tone, "complete");
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    controls.markSaved(row);
    assert.equal(note.textContent, "Saved");
    assert.equal(note.dataset.visible, "true");
    mock.timers.tick(1500);
    controls.markSaved(row);
    mock.timers.tick(1500);
    assert.equal(note.dataset.visible, "true", "a second save re-arms the timer");
    mock.timers.tick(600);
    assert.equal(note.dataset.visible, "false");
  } finally {
    mock.timers.reset();
  }
  controls.setSettingError(row, "Enter 1 to 24");
  assert.ok(!row.querySelector(".setting-error").hidden);
  assert.equal(toggle.getAttribute("aria-invalid"), "true");
  controls.setSettingError(row, "");
  assert.ok(row.querySelector(".setting-error").hidden && !toggle.hasAttribute("aria-invalid"));
  const group = controls.segmented({ items: [{ value: "stable", label: "Stable" }, { value: "fast", label: "Fast" }] }).element;
  const grouped = controls.settingRow({ id: "presets", name: "Speed", control: group });
  assert.equal(grouped.querySelector(".setting-name").localName, "span", "groups are named by aria-labelledby, not through their first button");
  assert.equal(group.getAttribute("aria-labelledby"), "presets-name");
  assert.equal(group.children[0].getAttribute("aria-describedby"), null);
  const picker = controls.select({ options: [{ value: "a", label: "A" }] });
  const pickerRow = controls.settingRow({ id: "format", name: "Format", control: picker });
  assert.equal(pickerRow.querySelector("label.setting-name").htmlFor, controls.controlOf(picker).id, "a field wrapper labels its native control");
  assert.ok(grouped.querySelector(".setting-description").hidden, "no description, no line");
});

test("settingRow: buttons and links keep their own names; the row name describes each action", () => {
  setUiLanguage("en");
  const open = components.button({ label: "All downloads" });
  const single = controls.settingRow({ id: "history", name: "Download history", control: open });
  assert.equal(single.querySelector(".setting-name").localName, "span", "a <label> would rename the button");
  assert.equal(open.getAttribute("aria-labelledby"), null);
  assert.equal(open.getAttribute("aria-describedby"), "history-name history-error");

  const word = components.status("queued", "Checking…");
  const setUp = components.button({ label: "Set up" });
  const retry = document.createElement("a");
  retry.href = "#retry";
  const engine = controls.settingRow({ id: "engine", name: "Local engine", description: "Not set up yet.", control: [word, setUp, retry] });
  const group = engine.querySelector(".setting-trail > .trail-group");
  assert.ok(group, "an array is laid out in one span.trail-group");
  assert.deepEqual(group.children, [word, setUp, retry]);
  for (const action of [setUp, retry]) assert.equal(action.getAttribute("aria-describedby"), "engine-name engine-description engine-error");
  assert.equal(group.getAttribute("aria-labelledby"), null, "the wrapper has no role, so it carries no name");
  assert.equal(group.getAttribute("aria-describedby"), null);
  assert.equal(word.getAttribute("aria-describedby"), null);
  controls.setSettingError(engine, "Couldn't connect");
  assert.ok(![setUp, retry, group].some((element) => element.hasAttribute("aria-invalid")), "an action is never marked invalid");
  assert.equal(engine.querySelector(".setting-error").textContent, "Couldn't connect");

  const fieldWrapper = controls.textField({ id: "template" });
  const filename = controls.settingRow({ id: "filename", name: "File names", control: fieldWrapper, layout: "stack" });
  const chips = document.createElement("div");
  chips.setAttribute("role", "group");
  chips.append(components.button({ label: "Title" }));
  const preview = document.createElement("p");
  filename.querySelector(".setting-trail").append(chips, preview);
  assert.equal(filename.querySelector("label.setting-name").htmlFor, "template");
  controls.setSettingError(filename, "Use at least one field");
  assert.equal(controls.controlOf(fieldWrapper).getAttribute("aria-invalid"), "true", "the first field in the trail, not the last node");
  assert.ok(!preview.hasAttribute("aria-invalid") && !chips.hasAttribute("aria-invalid"));
  controls.setSettingError(filename, "");
  assert.ok(!controls.controlOf(fieldWrapper).hasAttribute("aria-invalid"));
});

test("nav marks one current item with aria-current and moves it on setCurrent", () => {
  const menu = controls.nav({ label: "Settings sections", items: [{ id: "saving", label: "Saving" }, { id: "engine", label: "Local engine" }], current: "engine" });
  assert.equal(menu.element.localName, "nav");
  assert.equal(menu.element.getAttribute("aria-label"), "Settings sections");
  const links = menu.element.querySelectorAll("a.nav-item");
  assert.deepEqual(links.map((a) => a.href), ["#saving", "#engine"]);
  assert.deepEqual(links.map((a) => a.getAttribute("aria-current")), [null, "true"]);
  menu.setCurrent("saving");
  assert.deepEqual(links.map((a) => a.getAttribute("aria-current")), ["true", null]);
});

test("dialogShell: dialog > form, titled, closable, scrolling body, action row with one primary", () => {
  setUiLanguage("en");
  const submit = components.button({ kind: "primary", label: msg("action.download"), type: "submit" });
  const cancel = components.button({ kind: "tertiary", label: msg("action.cancel") });
  const shell = controls.dialogShell({ title: "Download", body: [controls.fieldStack({ label: "File name", control: controls.textField({ id: "name" }) })], actions: [cancel, submit] });
  assert.equal(shell.dialog.localName, "dialog");
  assert.equal(shell.dialog.className, "dialog-shell");
  assert.equal(shell.form.parentNode, shell.dialog, "dialog > form (the audit's exempt container)");
  assert.equal(shell.form.method, "dialog");
  assert.equal(shell.dialog.getAttribute("aria-labelledby"), shell.heading.id);
  assert.ok(shell.heading.className.includes("t-title"));
  const close = shell.dialog.querySelector(".dialog-close");
  assert.equal(close.getAttribute("aria-label"), "Close");
  assert.equal(close.type, "button");
  assert.equal(shell.body.className, "dialog-body");
  assert.equal(shell.actions.className, "dialog-actions");
  assert.equal(shell.actions.querySelectorAll(".btn-primary").length, 1);
  const label = shell.body.querySelector("label.t-label");
  assert.equal(label.htmlFor, "name");
  let closed = "";
  shell.dialog.close = (value) => { closed = value; };
  click(close);
  assert.equal(closed, "cancel");
  const results = [];
  const keyed = controls.dialogShell({ title: "Download", onClose: (value) => results.push(value) });
  keyed.dialog.showModal = () => { keyed.dialog.open = true; };
  keyed.dialog.returnValue = "submit";
  keyed.open();
  assert.equal(keyed.dialog.returnValue, "", "opening clears the last result");
  keyed.dialog.dispatchEvent(new Event("cancel"));
  keyed.dialog.dispatchEvent(new Event("close"));
  assert.deepEqual(results, ["cancel"], "Escape reports cancel, never a stale result");
  // Chrome skips the cancel event for a close request without user activation
  // (a dialog opened from script, then Escape): the close alone still reports cancel.
  keyed.dialog.open = false;
  keyed.open();
  keyed.dialog.dispatchEvent(new Event("close"));
  assert.deepEqual(results, ["cancel", "cancel"], "a close with no result is a cancel");
  assert.equal(keyed.dialog.returnValue, "cancel");
});

test("segmented: role=tablist, roving tabindex, arrows and Home/End, counts hidden at 0", () => {
  const picks = [];
  const control = controls.segmented({ label: "View", items: [{ value: "media", label: "Media", count: 3 }, { value: "jobs", label: "Downloads", count: 0 }], current: "media", onSelect: (value) => picks.push(value) });
  const [media, jobs] = control.element.children;
  assert.equal(control.element.getAttribute("role"), "tablist");
  assert.deepEqual([media.getAttribute("aria-selected"), jobs.getAttribute("aria-selected")], ["true", "false"]);
  assert.deepEqual([media.tabIndex, jobs.tabIndex], [0, -1]);
  assert.equal(media.querySelector(".count").textContent, "3");
  assert.ok(jobs.querySelector(".count").hidden);
  key(media, "ArrowRight");
  assert.equal(jobs.getAttribute("aria-selected"), "true");
  key(jobs, "Home");
  assert.equal(media.getAttribute("aria-selected"), "true");
  assert.deepEqual(picks, ["jobs", "media"]);
  const loose = controls.segmented({ items: [{ value: "a", label: "A" }, { value: "b", label: "B" }], current: "zzz" });
  assert.deepEqual(loose.element.children.map((tab) => tab.tabIndex), [0, -1], "an unknown current value still leaves one tab stop");
  loose.select("a");
  loose.setDisabled("a", true);
  assert.deepEqual(loose.element.children.map((tab) => tab.tabIndex), [-1, 0], "a disabled selection hands the tab stop on");
});

test("segmented role radiogroup: role=radio options with aria-checked, the same keyboard model", () => {
  const picks = [];
  const control = controls.segmented({ role: "radiogroup", label: "Speed", items: [{ value: "stable", label: "Steady", controls: "x" }, { value: "balanced", label: "Balanced" }, { value: "fast", label: "Fast" }], current: "", onSelect: (value) => picks.push(value) });
  const options = control.element.children;
  assert.equal(control.element.getAttribute("role"), "radiogroup");
  assert.deepEqual(options.map((option) => option.getAttribute("role")), ["radio", "radio", "radio"]);
  assert.deepEqual(options.map((option) => option.getAttribute("aria-checked")), ["false", "false", "false"], "no preset matches: none checked");
  assert.ok(options.every((option) => !option.hasAttribute("aria-selected") && !option.hasAttribute("aria-controls")), "no tab attributes on radios");
  assert.deepEqual(options.map((option) => option.tabIndex), [0, -1, -1], "one tab stop even with nothing checked");
  key(options[0], "ArrowRight");
  assert.deepEqual(options.map((option) => option.getAttribute("aria-checked")), ["false", "true", "false"]);
  key(options[1], "End");
  assert.equal(options[2].getAttribute("aria-checked"), "true");
  key(options[2], "Home");
  click(options[2]);
  assert.deepEqual(picks, ["balanced", "fast", "stable", "fast"]);
  assert.deepEqual(options.map((option) => option.tabIndex), [-1, -1, 0]);
  const system = read("extension/ui/v2/system.css");
  assert.match(system, /\.segmented button:is\(\[aria-selected="true"\], \[aria-checked="true"\]\) \{/, "a checked radio wears the raised selection");
});

test("setOptions never leaves a select blank for a value it no longer offers", () => {
  const choice = controls.select({ options: [{ value: "mp4", label: "MP4" }, { value: "mkv", label: "MKV" }], value: "mkv" });
  const native = controls.controlOf(choice);
  native.value = "";
  controls.setOptions(choice, [{ value: "webm", label: "WebM" }], "mkv");
  assert.equal(native.value, "", "the absent value is not forced (a browser would then show a blank select)");
  controls.setOptions(choice, [{ value: "webm", label: "WebM" }, { value: 1080, label: "1080p" }], 1080);
  assert.equal(native.value, "1080");
});

test("menus: a menu opened after a confirm is not labelled with the old question", async () => {
  const layer = document.createElement("div");
  layer.hidden = true;
  const menuNode = document.createElement("div");
  menuNode.className = "menu";
  layer.append(menuNode);
  const savedWindow = globalThis.window;
  globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {} };
  try {
    const menus = components.createMenus(layer);
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ top: 10, bottom: 42, left: 10, right: 42 });
    const answer = menus.confirm(anchor, { question: "Stop this download?", confirmLabel: "Stop download" });
    assert.equal(menuNode.getAttribute("aria-label"), "Stop this download?");
    menus.openItems(anchor, [{ label: "Copy link", run() {} }]);
    assert.equal(await answer, false, "opening a menu answers the pending confirm with false");
    assert.equal(menuNode.getAttribute("role"), "menu");
    assert.equal(menuNode.getAttribute("aria-label"), null);

    const stop = menus.confirm(anchor, { question: "Stop this download?", confirmLabel: "Stop download" });
    assert.deepEqual(menuNode.querySelectorAll(".confirm-actions button").map((b) => b.className), ["btn btn-tertiary", "btn btn-destructive"], "destructive by default");
    menus.close({ restore: false });
    assert.equal(await stop, false);
    const allow = menus.confirm(anchor, { question: "Allow downloads from my home network?", confirmLabel: "Allow", confirmKind: "tertiary" });
    assert.deepEqual(menuNode.querySelectorAll(".confirm-actions button").map((b) => b.className), ["btn btn-tertiary", "btn btn-tertiary"], "an opt-in confirms with a tertiary button");
    menuNode.querySelectorAll(".confirm-actions button")[1].click();
    assert.equal(await allow, true);
  } finally {
    globalThis.window = savedWindow;
  }
});

// Ported from the v1 interactions tests (ui/interactions.js is retired):
// toasts, the menu keyboard and focus restoration now live in components.js.
test("toasts: status or alert by tone, at most three, each gone after 4 s", () => {
  const region = document.createElement("div");
  const toast = components.createToaster(region);
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    toast("Saved");
    toast("Check the link", "warning");
    toast("Couldn't start", "error");
    const [first, second, third] = region.children;
    assert.deepEqual([first, second, third].map((element) => [element.getAttribute("role"), element.dataset.tone]), [["status", "success"], ["status", "warning"], ["alert", "error"]]);
    assert.equal(first.querySelector(".status.t-body").textContent, "Saved");
    toast("Fourth");
    assert.equal(region.children.length, 3, "the oldest leaves when a fourth arrives");
    assert.equal(region.children[0], second);
    mock.timers.tick(3999);
    assert.equal(region.children.length, 3);
    mock.timers.tick(1);
    assert.equal(region.children.length, 0, "they leave after 4 s");
    toast("One");
    mock.timers.tick(2000);
    toast("Two");
    mock.timers.tick(2000);
    assert.deepEqual(region.children.map((element) => element.textContent), ["Two"], "each leaves 4 s after it came");
    mock.timers.tick(2000);
    assert.equal(region.children.length, 0);
    assert.doesNotThrow(() => components.createToaster(null)("nowhere"), "no region: a no-op");
  } finally {
    mock.timers.reset();
  }
});

test("menus: arrow keys wrap, Escape closes, and focus returns only to an anchor still on the page", () => {
  const layer = document.createElement("div");
  layer.hidden = true;
  const menuNode = document.createElement("div");
  menuNode.className = "menu";
  layer.append(menuNode);
  const savedWindow = globalThis.window;
  const savedListen = document.addEventListener;
  let onKey = null;
  globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {} };
  document.addEventListener = (type, fn) => { if (type === "keydown") onKey = fn; };
  const press = (key) => { const event = { key, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; onKey(event); return event; };
  try {
    const menus = components.createMenus(layer);
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ top: 10, bottom: 42, left: 10, right: 42 });
    const row = document.createElement("li");
    row.className = "row";
    row.append(anchor);
    document.append(row);
    let ran = "";
    menus.openItems(anchor, [{ label: "Show in Finder", run: () => { ran = "reveal"; } }, { label: "Open source page", run() {} }, { label: "Remove from history", tone: "destructive", run() {} }]);
    const items = menuNode.querySelectorAll("button");
    assert.equal(document.activeElement, items[0], "the first item takes focus");
    assert.ok(row.hasAttribute("data-selected"), "the row stays selected while its menu is open");
    assert.ok(press("ArrowUp").defaultPrevented);
    assert.equal(document.activeElement, items[2], "ArrowUp wraps to the last item");
    press("ArrowDown");
    assert.equal(document.activeElement, items[0], "ArrowDown wraps to the first");
    press("Escape");
    assert.equal(layer.hidden, true);
    assert.equal(document.activeElement, anchor, "Escape returns focus to the anchor");
    assert.ok(!row.hasAttribute("data-selected"));
    menus.openItems(anchor, [{ label: "Show in Finder", run: () => { ran = "reveal"; } }]);
    menuNode.querySelector("button").click();
    assert.equal(ran, "reveal");
    assert.equal(document.activeElement, anchor);
    menus.openItems(anchor, [{ label: "Copy link", run() {} }]);
    const item = menuNode.querySelector("button");
    row.remove();
    press("Escape");
    assert.equal(document.activeElement, item, "a removed anchor never takes focus back");
  } finally {
    globalThis.window = savedWindow;
    document.addEventListener = savedListen;
  }
});

// Settings' home-network switch: its click opens the confirm, Cancel closes it
// and returns focus to the switch. Chrome on macOS replays a keydown the page
// left unhandled through the system key path while the window is key (the
// e2e's DevTools-driven window is): the replay is another keydown plus a
// keypress that activates whatever is focused by then, so an Enter on Cancel
// that only the button's own keypress handled went Cancel -> switch -> Cancel
// without end. The layer now consumes Enter and Space on keydown.
test("menus: Enter on a confirm's Cancel runs it once and consumes the key, so a replayed key cannot reopen the popover", async () => {
  const layer = document.createElement("div");
  layer.hidden = true;
  const menuNode = document.createElement("div");
  menuNode.className = "menu";
  layer.append(menuNode);
  const savedWindow = globalThis.window;
  const savedListen = document.addEventListener;
  let onKey = null;
  globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {} };
  document.addEventListener = (type, fn) => { if (type === "keydown") onKey = fn; };
  // One key press as the engine delivers it: keydown, then (unless the page
  // consumed the keydown) the keypress that activates the focused button, and
  // then Chrome's replay of the unhandled key, which starts over.
  const press = (name) => {
    let hops = 0;
    let event;
    for (; hops < 50; hops++) {
      event = { key: hops ? "Unidentified" : name, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
      onKey(event);
      if (event.defaultPrevented) break;
      document.activeElement?.click?.();
    }
    return { consumed: event.defaultPrevented, replays: hops };
  };
  try {
    const menus = components.createMenus(layer);
    const anchor = document.createElement("button");
    anchor.getBoundingClientRect = () => ({ top: 10, bottom: 42, left: 10, right: 42 });
    document.append(anchor);
    const answers = [];
    let opened = 0;
    anchor.addEventListener("click", () => {
      opened += 1;
      menus.confirm(anchor, { question: "Allow downloads from my home network?", confirmLabel: "Allow", cancelLabel: "Cancel", confirmKind: "tertiary" }).then((answer) => answers.push(answer));
    });
    anchor.click();
    const [cancel] = menuNode.querySelectorAll(".confirm-actions button");
    assert.equal(document.activeElement, cancel, "Cancel takes focus");
    let cancelClicks = 0;
    cancel.addEventListener("click", () => { cancelClicks += 1; });
    const enter = press("Enter");
    assert.deepEqual(enter, { consumed: true, replays: 0 }, "the layer consumes the keydown, so nothing is replayed");
    assert.equal(cancelClicks, 1, "Cancel ran exactly once");
    assert.equal(layer.hidden, true, "the confirm closed");
    assert.equal(document.activeElement, anchor, "focus is back on the switch");
    assert.equal(opened, 1, "the switch was not activated again");
    await Promise.resolve();
    assert.deepEqual(answers, [false]);

    // Space confirms the same way; the answer is the focused button's.
    anchor.click();
    const [, allow] = menuNode.querySelectorAll(".confirm-actions button");
    allow.focus();
    assert.deepEqual(press(" "), { consumed: true, replays: 0 });
    await Promise.resolve();
    assert.deepEqual(answers, [false, true]);
    assert.equal(document.activeElement, anchor);

    // Enter runs a menu item once too, and only while an item is focused.
    let ran = 0;
    menus.openItems(anchor, [{ label: "Copy link", run: () => { ran += 1; } }]);
    assert.deepEqual(press("Enter"), { consumed: true, replays: 0 });
    assert.equal(ran, 1);
    assert.equal(layer.hidden, true);
    menus.openItems(anchor, [{ label: "Copy link", run: () => { ran += 1; } }]);
    document.activeElement = anchor;
    const outside = { key: "Enter", defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    onKey(outside);
    assert.equal(outside.defaultPrevented, false, "a key outside the popover is the page's own");
    assert.equal(ran, 1);
    menus.close({ restore: false });
  } finally {
    globalThis.window = savedWindow;
    document.addEventListener = savedListen;
  }
});

// ---------- static checks ----------

test("v2 sources: no colour literals, no CJK outside the zh tables, no innerHTML except fixed icon paths", () => {
  const literals = scanColourLiterals().filter((f) => f.file.startsWith("extension/ui/v2/") || f.file.startsWith("extension/downloads/"));
  assert.deepEqual(literals, [], "colour literals live only in tokens.css");
  for (const file of V2_JS) {
    const source = stripComments(read(file));
    assert.ok(!CJK.test(source), `${file} has no CJK characters`);
    if (file !== "extension/ui/v2/components.js") assert.doesNotMatch(source, /innerHTML/, `${file} builds DOM nodes, not HTML strings`);
  }
  for (const file of MESSAGE_FILES) {
    const source = stripComments(read(`extension/ui/v2/messages/${file}`));
    const enTable = source.slice(source.indexOf("const en"), source.indexOf("const zh"));
    assert.ok(!CJK.test(enTable), `messages/${file}: the en table has no CJK`);
  }
  assert.ok(!CJK.test(read("extension/downloads/downloads.html").replace(/<!--[\s\S]*?-->/g, "")));
});

test("system.css: rows and status lines moved here; no 1px rules, tracked caps, italics or monospace", () => {
  const system = read("extension/ui/v2/system.css");
  const page = read("extension/downloads/downloads.css");
  for (const selector of [".row {", ".row-lead {", ".row-main {", ".row-trail {", ".row-actions {", ".focus-panel {", ".focus-details summary {", ".segment-map {", ".speed-chart {", ".status-line {", ".status-line .line-dot {"]) {
    assert.ok(system.includes(selector), `system.css defines ${selector}`);
    assert.ok(!page.includes(`\n${selector}`), `downloads.css no longer defines ${selector}`);
  }
  for (const selector of [".switch {", ".switch-thumb {", ".field select {", ".field-chevron {", ".field-unit {", ".setting-row {", ".saved-note {", ".nav-item {", '.nav-item[aria-current="true"] {', ".dialog-shell {", ".dialog-body {", ".dialog-actions {", ".list-header {"]) {
    assert.ok(system.includes(selector), `system.css defines ${selector}`);
  }
  const css = (system + page).replace(/@media \(prefers-contrast: more\) \{[^{}]*\{[^{}]*\}\s*\}/g, "");
  assert.ok(!/border(-top|-bottom|-left|-right|-block|-inline)?(-width)?:\s*1px/.test(css), "no 1px rules");
  assert.ok(!/\b0 0 0 1px\b/.test(css), "no 1px rings outside prefers-contrast: more");
  assert.ok(!/text-transform:\s*uppercase|letter-spacing:\s*[1-9.]|font-style:\s*italic|monospace/.test(css), "no tracked caps, italics or monospace");
  assert.match(system, /\.dialog-actions \{[^}]*position: sticky;[^}]*padding: var\(--space-4\);/s, "the dialog's action row is sticky with 16px padding");
  assert.match(system, /\.dialog-body \{[^}]*overflow-y: auto;/s, "the dialog body scrolls");
  assert.match(system, /prefers-reduced-motion[\s\S]*\.switch-thumb/, "the switch does not slide under reduced motion");
  assert.match(system, /\.saved-note \{[^}]*transition: opacity/s, "Saved fades by opacity only");
});

// ---------- tokens: surface grids and control contrast ----------

const tokens = read("extension/ui/v2/tokens.css");
function blockOf(selector) {
  const start = tokens.indexOf(`${selector} {`);
  assert.ok(start >= 0, `tokens define ${selector}`);
  const body = tokens.slice(tokens.indexOf("{", start) + 1, tokens.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const px = (value) => Number.parseFloat(value);

test("surface grids put text at x = 60 in the popup and x = 64 in the side panel; Settings adds nav tokens", () => {
  const grid = tokens.slice(tokens.indexOf("/* §5 grid and spacing"), tokens.indexOf("/* Shape. */"));
  const full = Object.fromEntries([...grid.matchAll(/(--(?:gutter|lead|lead-gap|column-max|row-pad)):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(full, { "--column-max": "880px", "--gutter": "32px", "--lead": "56px", "--lead-gap": "16px", "--row-pad": "14px" }, "full-page rows pad 14px (v3 §3.5)");
  const popup = blockOf('[data-surface="popup"]');
  const side = blockOf('[data-surface="sidepanel"]');
  const settings = blockOf('[data-surface="settings"]');
  assert.equal(px(popup["--gutter"]) + px(popup["--lead"]) + px(popup["--lead-gap"]), 60);
  assert.equal(px(side["--gutter"]) + px(side["--lead"]) + px(side["--lead-gap"]), 64);
  assert.deepEqual([settings["--nav-width"], settings["--nav-gap"], settings["--content-max"]], ["200px", "48px", "680px"]);
  assert.deepEqual([popup["--row-pad"], side["--row-pad"]], ["12px", "12px"], "the popup and side panel keep 12px rows");
  assert.equal(blockOf('[data-density="compact"]')["--row-pad"], "10px", "compact full pages pad 10px");
  assert.match(tokens, /\[data-surface="popup"\]\[data-density="compact"\],\n\[data-surface="sidepanel"\]\[data-density="compact"\],\n\[data-surface="popup"\] \[data-density="compact"\],\n\[data-surface="sidepanel"\] \[data-density="compact"\] \{\n  --row-pad: 8px;/, "compact popup and side panel rows pad 8px");
});

function hexBlock(selector) {
  const start = tokens.indexOf(selector);
  const body = tokens.slice(tokens.indexOf("{", start) + 1, tokens.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9A-F]{6})/gi)].map((m) => [m[1], m[2]]));
}
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };

test("control boundaries reach 3:1 in Morning and Dusk (switch track and thumb, chevron, focus ring)", () => {
  const themes = { morning: hexBlock(':root,\n[data-theme="morning"]'), dusk: hexBlock('[data-theme="dusk"]') };
  for (const [theme, t] of Object.entries(themes)) {
    for (const surface of ["--sunken", "--canvas", "--surface", "--raised"]) {
      assert.ok(contrast(t["--text-muted"], t[surface]) >= 3, `${theme} switch knob (off) on ${surface}`);
      assert.ok(contrast(t["--primary-fill"], t[surface]) >= 3, `${theme} switch track (on) on ${surface}`);
      assert.ok(contrast(t["--pond-text"], t[surface]) >= 3, `${theme} focus ring on ${surface}`);
      assert.ok(contrast(t["--text-secondary"], t[surface]) >= 3, `${theme} select chevron on ${surface}`);
    }
    // Off is an empty sunken track with a muted knob: the knob carries the boundary.
    assert.ok(contrast(t["--text-muted"], t["--sunken"]) >= 4.5, `${theme} knob on the off track`);
    assert.ok(contrast(t["--text-secondary"], t["--sunken"]) >= 4.5, `${theme} hovered knob on the off track`);
    // On and off differ in value, not only in hue and knob side.
    assert.ok(contrast(t["--primary-fill"], t["--sunken"]) >= 3, `${theme} on track against the off track`);
    assert.ok(contrast(t["--text-on-accent"], t["--primary-fill"]) >= 3, `${theme} thumb on the on track`);
    assert.ok(contrast(t["--text-on-accent"], t["--primary-fill-hover"]) >= 3, `${theme} thumb on the hovered on track`);
    assert.ok(contrast(t["--celadon-text"], t["--canvas"]) >= 4.5, `${theme} Saved text`);
    assert.ok(contrast(t["--vermilion-text"], t["--canvas"]) >= 4.5, `${theme} setting error text`);
  }
  const system = read("extension/ui/v2/system.css");
  assert.match(system, /\.switch \{[^}]*background: var\(--sunken\);/s);
  assert.match(system, /\.switch-thumb \{[^}]*background: var\(--text-muted\);/s);
  assert.match(system, /\.switch:not\(\[aria-checked="true"\]\):hover:not\(:disabled\) \.switch-thumb \{ background: var\(--text-secondary\); \}/);
  assert.match(system, /\.switch\[aria-checked="true"\] \{ background: var\(--primary-fill\); \}/);
  assert.match(system, /\.field:focus-within \{\s*box-shadow: 0 0 0 2px var\(--pond-text\)/);
  assert.match(system, /\.field-chevron \{[^}]*color: var\(--text-secondary\);/s);
});

test("shared rules live once, in system.css: nav pill, stacked fields, dialog line and fields, reduced motion", () => {
  const system = read("extension/ui/v2/system.css");
  const ruleBody = (selector) => {
    const at = system.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return system.slice(at, system.indexOf("}", at));
  };
  // Nav: the pill is a pseudo-element; the link box has no fill, so its text sits on the column edge.
  assert.match(ruleBody(".nav-item::before"), /inset: 0 calc\(-1 \* var\(--space-3\)\)/);
  assert.match(ruleBody('.nav-item[aria-current="true"]::before'), /background: var\(--tint-pond\)/);
  assert.doesNotMatch(ruleBody(".nav-item"), /background|margin-inline|padding/);
  // A field's box starts on the content edge, as the link field does on Downloads
  // (the audit takes the field box as the edge); the typed text sits inside it.
  assert.ok(!system.includes('.setting-row[data-layout="stack"] .setting-trail > .field {'), "no 12px field bleed in stacked rows");
  // Trailing controls sit on the name's line, centred on the first line box.
  assert.match(ruleBody('.setting-row:not([data-layout="stack"]) > .setting-trail'), /margin-block: calc\(\(var\(--row-line\) - var\(--control-height\)\) \/ 2\)/);
  // Dialogs: one status line with a hanging dot; fields look as they do everywhere.
  assert.match(ruleBody(".dialog-shell .dialog-line .line-dot"), /top: 50%;[\s\S]*left: calc\(-8px - var\(--space-1\)\);[\s\S]*transform: translateY\(-50%\)/, "centred on its line, 4px from the text and from the dialog edge");
  assert.match(ruleBody(".dialog-shell .field"), /background: transparent/);
  assert.match(ruleBody(".dialog-shell .field > input,\n.dialog-shell .field > select"), /background: var\(--surface\)/);
  assert.ok(system.indexOf(":root:has(.dialog-shell[open]) .empty-state") > system.indexOf('[data-surface="popup"]:has(.dialog-shell[open])'), "next to the popup dialog rule");
  // Reduced motion on request, like prefers-reduced-motion.
  assert.match(system, /:root\[data-motion="reduced"\] \*,\s*:root\[data-motion="reduced"\] \*::before,\s*:root\[data-motion="reduced"\] \*::after \{\s*animation-duration: 0\.01ms !important;/);
  assert.match(system, /:root\[data-motion="reduced"\] \.switch-thumb \{\s*transition-duration: 0s !important;/);
  // No surface keeps a copy.
  const media = read("extension/ui/v2/media.css");
  const options = read("extension/options/options.css");
  const preview = read("extension/preview/preview.css");
  assert.doesNotMatch(media, /dialog-line|\.dialog-shell \.field|\.field > (input|select)/, "media.css: no dialog line, no transparent field override");
  assert.doesNotMatch(options, /nav-item|\.setting-trail > \.field|trail-group|location-actions/, "options.css: no nav pill, field offset or trail group copies");
  assert.doesNotMatch(preview, /data-motion|\.setting-trail > \.field/, "preview.css: no reduced-motion or field offset copies");
});

test("README documents every exported builder", async () => {
  const readme = read("extension/ui/v2/README.md");
  for (const file of ["components.js", "controls.js", "rows.js", "errors.js", "runtime.js", "locale.js", "messages.js", "pond.js", "jobs.js", "media.js", "tokens.js"]) {
    const module = await import(`../extension/ui/v2/${file}`);
    for (const name of Object.keys(module)) assert.ok(readme.includes(`${name}`), `README mentions ${file} → ${name}`);
  }
  for (const surface of ["popup", "sidepanel", "settings"]) assert.ok(readme.includes(`data-surface="${surface}"`));
  const { formatBytes, formatRate } = await import("../extension/lib/format.js");
  assert.ok(formatBytes && formatRate && readme.includes("lib/format.js") && readme.includes("formatBytes(bytes, locale)"), "README documents lib/format.js");
  for (const note of ["media.css", "workerText", "jobFailure(code, params)", "titleIsFallback", "engine_*", "createJobList", "announce(jobId)", "confirmKind", "keepDisabled", "metaUserContent", 'role: "radiogroup"', 'data-motion="reduced"']) {
    assert.ok(readme.includes(note), `README mentions ${note}`);
  }
  assert.doesNotMatch(readme, /\.\.\/i18n\.js|translateMessage|catalogue translation/, "no v1 translator in the reference");
});

// ---------- visual pass 2: the system decisions, by construction ----------

test("pass 2 system rules: hung status dot unclipped, live meta under the controls, lead on the title line, one bleed", () => {
  const system = read("extension/ui/v2/system.css");
  const ruleBody = (selector) => {
    const at = system.indexOf(`${selector} {`);
    assert.ok(at >= 0, selector);
    return system.slice(at, system.indexOf("}", at));
  };
  // The dot hangs 8px + 4px and the meta line gives it that room in its own padding box.
  assert.match(ruleBody(".row-meta > .status:first-child"), /gap: var\(--space-1\);\s*margin-inline-start: calc\(-8px - var\(--space-1\)\);/);
  assert.match(ruleBody(".row-main > .row-meta:has(> .status:first-child)"), /margin-inline-start: calc\(-8px - var\(--space-1\)\);\s*padding-inline-start: calc\(8px \+ var\(--space-1\)\);/);
  // Live rows: meta and bar span the text column and the trailing cell.
  assert.match(ruleBody(".row[data-live] > .row-main"), /display: contents/);
  assert.match(system, /\.row\[data-live\] \.row-meta \{ grid-column: 2 \/ -1; grid-row: 2; \}/);
  assert.match(ruleBody(".row[data-live] > .progress"), /grid-column: 2 \/ -1;\s*grid-row: 3;/);
  assert.match(ruleBody(".row[data-live] > .row-trail"), /margin-block-end: calc\(\(var\(--row-line\) - var\(--control-height-compact\)\) \/ 2\)/);
  assert.match(ruleBody(".row-lead:not(:has(.lead-frame))"), /align-self: start;\s*height: var\(--row-line\);/);
  assert.match(ruleBody(".lead-frame"), /width: var\(--lead\);\s*height: 32px;\s*border-radius: var\(--r-thumb\);\s*background: var\(--sunken\);/, "the full-page lead frame (v3 §3.5)");
  assert.match(ruleBody(".focus-panel"), /margin-inline: calc\(-1 \* var\(--space-3\)\);\s*padding: var\(--space-4\) var\(--space-3\);/);
  assert.match(ruleBody(".row::before"), /inset: 0 calc\(-1 \* var\(--space-3\)\)/, "the row tint bleeds the same 12px");
  // Top bar, status line, filename, empty sentence, Details, speed line, invalid halo, error rows.
  assert.match(ruleBody(".bar-actions,\n.topbar-inner > .icon-button"), /margin-inline-end: calc\(-1 \* var\(--space-2\)\)/);
  assert.match(ruleBody(".status-line .line-dot"), /margin-inline-end: calc\(\(20px - 8px\) \/ 2\)/);
  assert.match(ruleBody(".filename-head"), /white-space: pre/);
  assert.match(ruleBody(".filename-tail"), /white-space: pre/);
  assert.match(ruleBody(".t-empty"), /text-wrap: balance/);
  assert.match(ruleBody(".focus-details summary svg"), /transform: rotate\(-90deg\)/);
  assert.match(ruleBody(".focus-details[open] > summary svg"), /transform: none/);
  assert.match(ruleBody(".speed-chart"), /height: 24px/);
  assert.match(ruleBody(".speed-block"), /gap: var\(--space-1\)/);
  assert.match(system, /:has\(\[aria-invalid="true"\]\):not\(:focus-within\) \{\s*box-shadow: 0 0 0 2px var\(--ring-invalid\), 0 0 0 6px var\(--halo-invalid\);/, "the error state is the focus ring's construction in vermilion (v3 §3.9)");
  assert.match(ruleBody(".setting-text:has(> .setting-error:not([hidden])) > .setting-description"), /display: none/);
  // Tokens: the halo in every theme block; the pond's five hue families once, for both themes (v3 §3.1).
  assert.equal((tokens.match(/--halo-invalid:/g) || []).length, 3);
  assert.equal((tokens.match(/--ring-invalid: color-mix\(in srgb, var\(--vermilion(?:-text)?\) 60%, transparent\);/g) || []).length, 3, "the 60% vermilion ring in every theme block");
  assert.equal((tokens.match(/--halo-invalid: color-mix\(in srgb, var\(--vermilion(?:-text)?\) 18%, transparent\);/g) || []).length, 3, "the 18% soft halo in every theme block");
  // v3 §3.6: the top bar's band is nothing at scroll position 0 and fades in over the first 24 px, scroll-driven.
  assert.match(ruleBody(".topbar::before"), /opacity: 0;[\s\S]*animation-timeline: scroll\(root block\);\s*animation-range: 0 24px;/);
  assert.match(ruleBody(".topbar::before"), /background: color-mix\(in srgb, var\(--surface\) 75%, transparent\);\s*box-shadow: var\(--mist\);/);
  assert.doesNotMatch(system, /\.topbar\[data-scrolled="true"\] \{/, "no JS-driven band outside the fallbacks");
  assert.match(system, /prefers-reduced-motion: reduce\) \{[\s\S]*?\.topbar::before \{\s*animation: none !important;/, "reduced motion runs no scroll-driven band; the scroll state shows it whole");
  assert.equal((tokens.match(/--pond-families: 162\.5 241\.8 295\.6 12\.1 56\.6;/g) || []).length, 1);
  assert.doesNotMatch(tokens, /--touch-|--mask-on/, "the v2 touch and mask tokens are gone");
});

test("pass 2 system copy and formatters: just now, spaced Chinese numerals, one rate precision, one Cancel verb", async () => {
  const { formatRelativeTime, formatRate } = await import("../extension/ui/v2/locale.js");
  const { msg } = await import("../extension/ui/v2/messages.js");
  const now = new Date(2026, 9, 21, 15, 0).getTime();
  setUiLanguage("en");
  assert.equal(formatRelativeTime(now - 20_000, now), "just now");
  assert.equal(formatRate(58e6), "58.0 MB/s");
  assert.equal(formatRate(512e3), "512 kB/s");
  assert.deepEqual(["action.cancel", "job.cancelConfirm", "job.cancelAction", "toast.stopped", "status.completed"].map((key) => msg(key)), ["Cancel", "Cancel this download?", "Cancel download", "Download cancelled", "Completed"]);
  setUiLanguage("zh");
  assert.equal(formatRelativeTime(now - 20_000, now), "刚刚");
  assert.equal(formatRelativeTime(now - 5 * 60_000, now), "5 分钟前");
  assert.equal(formatRelativeTime(now - 3_600_000, now), "1 小时前");
  assert.equal(formatRelativeTime(now - 3 * 86_400_000, now), "3 天前");
  assert.equal(formatRelativeTime(new Date(2026, 9, 1, 9, 0).getTime(), now), "10月1日", "absolute dates keep Intl's form");
  assert.deepEqual(["job.cancelConfirm", "job.cancelAction", "toast.stopped", "status.remuxing"].map((key) => msg(key)), ["要取消这个下载吗？", "取消下载", "已取消下载", "正在收尾"]);
  setUiLanguage("en");
});

test("pass 2: engine line tones match Settings; the popup and side panel lists ask for compact live rows", async () => {
  const { engineLine } = await import("../extension/ui/v2/media.js");
  setUiLanguage("en");
  assert.deepEqual(["permission", "finishing", "missing", "noResponse", "update", "noConvert", "restart", "recover"].map((issue) => engineLine(issue).tone), ["", "progress", "failed", "failed", "warning", "warning", "warning", "warning"]);
  const source = read("extension/ui/v2/media.js");
  assert.equal((source.match(/liveRow\(shown\([^)]*\), \{ focus: (?:true|false), poster: false, compact: true \}\)/g) || []).length, 2);
});
