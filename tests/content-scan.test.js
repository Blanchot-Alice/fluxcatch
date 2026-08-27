import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const siteExtractSource = fs.readFileSync(new URL("../extension/lib/site-extract.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../extension/content/content.js", import.meta.url), "utf8");
const instagramMainSource = fs.readFileSync(new URL("../extension/content/instagram-main.js", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

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

test("Instagram payload extraction keeps one best complete MP4 per video_versions array", () => {
  const extract = loadSiteExtract();
  const low = "https://scontent-lax3-2.cdninstagram.com/o1/v/t2/f2/low.mp4?efg=LOW&oe=70000000";
  const high = "https://video-lax3-2.xx.fbcdn.net/o1/v/t2/f2/high.mp4?efg=HIGH&oe=70000000";
  const fragment = `${high}&bytestart=1000&byteend=2999`;
  const second = "https://scontent-lax7-1.cdninstagram.com/o1/v/t2/f2/second.mp4?efg=SECOND&oe=70000000";
  const payload = JSON.stringify({
    current: {
      code: "Current123",
      video_versions: [
        { url: low, width: 540, height: 960, bandwidth: 900_000 },
        { url: high, width: 1080, height: 1920, bandwidth: 2_000_000 },
        { url: fragment, width: 2160, height: 3840, bandwidth: 8_000_000 },
        { url: "https://media.example.test/injected.mp4", width: 4000, height: 4000 }
      ]
    },
    anotherPost: { code: "Other456", video_versions: [{ url: second, width: 720, height: 1280 }] }
  });

  const videos = extract.extractInstagramVideos(payload);
  assert.equal(videos.length, 2);
  assert.equal(videos[0].url, high, "the best complete rendition wins over lower quality and ranged fragments");
  assert.equal(videos[0].width, 1080);
  assert.equal(videos[1].url, second, "separate media objects remain independently discoverable");
  assert.ok(videos.every((video) => !/[?&](?:bytestart|byteend)=/i.test(video.url)));
  const currentOnly = extract.extractInstagramVideos(payload, "Current123");
  assert.equal(currentOnly.length, 1, "a Reel page binds inline JSON to its current shortcode");
  assert.equal(currentOnly[0].url, high);
});

test("inline X fallback keeps one highest-bitrate progressive rendition per video", () => {
  const extract = loadSiteExtract();
  const low = "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/640x360/low?tag=12";
  const high = "https://video.twimg.com/ext_tw_video/1/pu/vid/avc1/1280x720/high?tag=12";
  const payload = JSON.stringify({
    video_info: {
      variants: [
        { content_type: "application/x-mpegURL", url: "https://video.twimg.com/ext_tw_video/1/pu/pl/master.m3u8" },
        { content_type: "video/mp4", bitrate: 256_000, url: low },
        { content_type: "video/mp4", bitrate: 2_000_000, url: high }
      ]
    }
  });
  const videos = extract.extractTwitterVideos(payload);
  assert.equal(videos.length, 1);
  assert.equal(videos[0].url, high);
});

test("inline X fallback can bind extraction to one status and exclude recommendations", () => {
  const extract = loadSiteExtract();
  const current = "https://video.twimg.com/ext_tw_video/2000000000000000000/pu/vid/current.mp4";
  const recommendation = "https://video.twimg.com/ext_tw_video/3000000000000000000/pu/vid/recommendation.mp4";
  const payload = JSON.stringify({
    current: {
      rest_id: "2000000000000000000",
      legacy: { media: [{ video_info: { variants: [{ content_type: "video/mp4", bitrate: 2_000_000, url: current }] } }] }
    },
    recommendation: {
      rest_id: "3000000000000000000",
      legacy: { media: [{ video_info: { variants: [{ content_type: "video/mp4", bitrate: 8_000_000, url: recommendation }] } }] }
    }
  });
  const videos = extract.extractTwitterVideos(payload, "2000000000000000000");
  assert.deepEqual(JSON.parse(JSON.stringify(videos)).map((item) => item.url), [current]);
});

test("Instagram MAIN-world response capture emits only the current reel's best complete MP4", async () => {
  const messages = [];
  const currentLow = "https://scontent-lax3-2.cdninstagram.com/o1/current-low.mp4?oe=70000000";
  const currentHigh = "https://video-lax3-2.xx.fbcdn.net/o1/current-high.mp4?oe=70000000";
  const currentFragment = `${currentHigh}&bytestart=1000&byteend=2999`;
  const recommendation = "https://scontent-lax7-1.cdninstagram.com/o1/recommendation.mp4?oe=70000000";
  const payload = JSON.stringify({
    current: {
      code: "DcT0kHENSNk",
      video_versions: [
        { url: currentLow, width: 540, height: 960, bandwidth: 800_000 },
        { url: currentHigh, width: 1080, height: 1920, bandwidth: 2_000_000 },
        { url: currentFragment, width: 2160, height: 3840, bandwidth: 9_000_000 }
      ]
    },
    suggestion: {
      code: "Unrelated123",
      video_versions: [{ url: recommendation, width: 2160, height: 3840 }]
    }
  });
  let response = {
    ok: true,
    headers: { get(name) { return name === "content-type" ? "application/json" : String(payload.length); } },
    clone() { return this; },
    async text() { return payload; }
  };
  const windowObject = {
    fetch() { return Promise.resolve(response); },
    postMessage(message, origin) { messages.push({ message, origin }); }
  };
  windowObject.top = windowObject;
  const pageLocation = {
    hostname: "www.instagram.com",
    pathname: "/reels/DcT0kHENSNk/",
    origin: "https://www.instagram.com"
  };
  const context = vm.createContext({
    window: windowObject,
    location: pageLocation,
    URL,
    Reflect,
    Promise,
    WeakSet,
    Map,
    Date,
    TextDecoder,
    Number
  });
  vm.runInContext(instagramMainSource, context, { filename: "instagram-main.js" });
  await context.window.fetch("/api/graphql");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(messages.length, 1);
  assert.equal(messages[0].origin, "https://www.instagram.com");
  assert.equal(messages[0].message.type, "FLUXCATCH_INSTAGRAM_MEDIA_V1");
  assert.equal(messages[0].message.video.url, currentHigh);
  assert.notEqual(messages[0].message.video.url, recommendation);
  assert.doesNotMatch(messages[0].message.video.url, /bytestart|byteend/);

  const nextUrl = "https://scontent-lax7-1.cdninstagram.com/o1/next.mp4?oe=70000000";
  const nextPayload = JSON.stringify({
    current: { code: "NextReel987", video_versions: [{ url: nextUrl, width: 720, height: 1280 }] },
    stale: { code: "DcT0kHENSNk", video_versions: [{ url: currentHigh, width: 1080, height: 1920 }] }
  });
  pageLocation.pathname = "/reel/NextReel987/";
  response = {
    ok: true,
    headers: { get(name) { return name === "content-type" ? "application/json" : String(nextPayload.length); } },
    clone() { return this; },
    async text() { return nextPayload; }
  };
  await context.window.fetch("/api/graphql?next");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(messages.length, 2, "SPA navigation reads the shortcode at response time rather than freezing the initial path");
  assert.equal(messages[1].message.video.url, nextUrl);
});

test("Instagram fetch observation handles its own rejected branch", async () => {
  const failure = new Error("fixture fetch failure");
  const windowObject = { fetch() { return Promise.reject(failure); }, postMessage() {} };
  windowObject.top = windowObject;
  const context = vm.createContext({
    window: windowObject,
    location: { hostname: "www.instagram.com", pathname: "/reel/Failure123/", origin: "https://www.instagram.com" },
    URL,
    Reflect,
    Promise,
    WeakSet,
    Map,
    Date,
    TextDecoder,
    Number
  });
  vm.runInContext(instagramMainSource, context, { filename: "instagram-main.js" });
  await assert.rejects(context.window.fetch("/api/graphql"), (error) => error === failure);
  await new Promise((resolve) => setTimeout(resolve, 0));
});

test("Instagram SPA observer is MAIN-world and crosses an origin-checked isolated listener", () => {
  const entry = manifest.content_scripts.find((script) => script.js?.includes("content/instagram-main.js"));
  assert.equal(entry?.world, "MAIN");
  assert.equal(entry?.all_frames, false);
  assert.deepEqual(entry?.matches, ["https://*.instagram.com/*"]);
  assert.match(contentSource, /event\.source !== window \|\| event\.origin !== location\.origin/);
  assert.match(contentSource, /FLUXCATCH_INSTAGRAM_MEDIA_V1/);
  assert.match(contentSource, /source: "instagram-api-response"/);
  assert.match(contentSource, /GET_CACHED_SITE_MEDIA/);
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
  const windowObject = { addEventListener() {} };
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
