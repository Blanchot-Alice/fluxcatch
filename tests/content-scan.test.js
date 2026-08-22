import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const siteExtractSource = fs.readFileSync(new URL("../extension/lib/site-extract.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../extension/content/content.js", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

function loadSiteExtract() {
  const context = vm.createContext({ URL });
  vm.runInContext(siteExtractSource, context, { filename: "site-extract.js" });
  return context.__fluxcatchSiteExtract;
}

test("site payload extraction is top-frame and hostname gated", () => {
  const extract = loadSiteExtract();
  assert.equal(extract.payloadSiteForPage("www.instagram.com", true), "instagram");
  assert.equal(extract.payloadSiteForPage("sub.instagram.com.", true), "instagram");
  assert.equal(extract.payloadSiteForPage("x.com", true), "twitter");
  assert.equal(extract.payloadSiteForPage("mobile.twitter.com", true), "twitter");
  assert.equal(extract.payloadSiteForPage("example.com", true), null);
  assert.equal(extract.payloadSiteForPage("instagram.com.evil.test", true), null);
  assert.equal(extract.payloadSiteForPage("www.instagram.com", false), null);
});

test("content scanning batches mutation storms and never reads unrelated script payloads", () => {
  assert.match(contentSource, /const TOP_FRAME = window === window\.top/);
  assert.match(contentSource, /processedSiteScripts = new WeakSet\(\)/);
  assert.match(contentSource, /if \(!extract \|\| !SITE_PAYLOAD_KIND\) return/);
  assert.match(contentSource, /if \(processedSiteScripts\.has\(script\)\) continue/);
  assert.match(contentSource, /queueMicrotask\(flushMutationBatch\)/);
  assert.match(contentSource, /MAX_MUTATION_ROOTS = 256/);
  assert.match(contentSource, /elementNeedsScan\(element\)/);
  assert.doesNotMatch(contentSource, /for \(const node of record\.addedNodes\) if \(node instanceof Element\) scan\(node\)/);

  // The observer queues only relevant roots. Five thousand unrelated nodes
  // therefore never reach scan(), never inspect script text and never grow a
  // dedupe structure.
  const observerBody = contentSource.match(/const observer = new MutationObserver\(\(records\) => \{([\s\S]*?)\n  \}\);/)?.[1] || "";
  assert.match(observerBody, /queueMutationRoot\(node\)/);
  assert.doesNotMatch(observerBody, /textContent|querySelectorAll|scan\(/);

  let observerCallback = null;
  let selectorCalls = 0;
  const scheduled = [];
  const messages = [];
  class FakeElement {
    matches() { selectorCalls += 1; return false; }
    querySelector() { selectorCalls += 1; return null; }
    querySelectorAll() { throw new Error("unrelated mutation reached a subtree scan"); }
    contains() { return false; }
  }
  class FakeMediaElement extends FakeElement {}
  class FakeVideoElement extends FakeMediaElement {}
  class FakeScriptElement extends FakeElement {
    get textContent() { throw new Error("unrelated script text was inspected"); }
  }
  const windowObject = {};
  windowObject.top = windowObject;
  const document = {
    baseURI: "https://example.test/page",
    title: "Fixture",
    readyState: "complete",
    documentElement: {},
    addEventListener() {},
    querySelectorAll() { return []; }
  };
  const context = vm.createContext({
    URL,
    window: windowObject,
    location: { hostname: "example.test", href: "https://example.test/page" },
    document,
    Element: FakeElement,
    HTMLMediaElement: FakeMediaElement,
    HTMLVideoElement: FakeVideoElement,
    HTMLScriptElement: FakeScriptElement,
    WeakSet,
    Set,
    Map,
    Date,
    Number,
    queueMicrotask(callback) { scheduled.push(callback); },
    MutationObserver: class {
      constructor(callback) { observerCallback = callback; }
      observe() {}
    },
    chrome: {
      runtime: {
        sendMessage(message) { messages.push(message); return Promise.resolve(); },
        onMessage: { addListener() {} }
      }
    }
  });
  vm.runInContext(siteExtractSource, context, { filename: "site-extract.js" });
  vm.runInContext(contentSource, context, { filename: "content.js" });
  selectorCalls = 0;
  observerCallback(Array.from({ length: 5000 }, () => ({
    type: "childList",
    target: document,
    addedNodes: [new FakeElement()]
  })));
  assert.equal(scheduled.length, 0, "irrelevant nodes do not schedule a DOM scan");
  assert.equal(messages.length, 0, "irrelevant nodes do not create candidates");
  assert.ok(selectorCalls <= 20_000, `selector checks stay linearly bounded (got ${selectorCalls})`);
});

test("page metadata stays top-frame while media detection remains frame-capable", () => {
  assert.match(contentSource, /if \(TOP_FRAME\) inspectPreviews\(root\)/);
  assert.match(contentSource, /if \(!TOP_FRAME\) return null/);
  assert.match(contentSource, /for \(const element of root\.querySelectorAll\?\.\("video, audio"\)/);
  assert.doesNotMatch(contentSource, /if \(!TOP_FRAME\) return;\s*\n\s*function scan/);
});

test("adapter registry does not advertise unsupported Bilibili bangumi pages", () => {
  const registry = backgroundSource.match(/const SITE_ADAPTERS = Object\.freeze\(\[([\s\S]*?)\n\]\);/)?.[1] || "";
  assert.match(registry, /bilibili\\\.com\\\/video/);
  assert.doesNotMatch(registry, /bangumi/);
});
