import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// The adult-site ladder adapters (Pornhub, MissAV, Jable): lib/site-extract.js
// parses what each page embeds in its own scripts, and content/content.js
// turns it into CONTENT_MEDIA messages with a ladder key. Fixture pages under
// tests/fixtures/sites/ keep the real page shapes with placeholder content;
// nothing here touches the network.

const siteExtractSource = fs.readFileSync(new URL("../extension/lib/site-extract.js", import.meta.url), "utf8");
const contentSource = fs.readFileSync(new URL("../extension/content/content.js", import.meta.url), "utf8");
const backgroundSource = fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/sites/${name}`, import.meta.url), "utf8");

function loadSiteExtract() {
  const context = vm.createContext({ URL });
  vm.runInContext(siteExtractSource, context, { filename: "site-extract.js" });
  return context.__fluxcatchSiteExtract;
}

/** The inline <script> bodies, metas, heading and title of a fixture page. */
function parseFixture(html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  const metas = [...html.matchAll(/<meta\s+([^>]*)>/gi)].map((match) => {
    const attributes = {};
    for (const attribute of match[1].matchAll(/([a-z:-]+)="([^"]*)"/gi)) attributes[attribute[1].toLowerCase()] = attribute[2];
    return attributes;
  });
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "";
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
  return { scripts, metas, title, heading };
}

/**
 * Runs site-extract.js and content.js against a fixture page in a minimal
 * DOM stand-in: enough querySelector for the adapters' title lookup and the
 * script walk, MutationObserver and listeners as stubs, chrome.runtime
 * capturing every message.
 */
function runContentScript(html, { hostname, href, topFrame = true } = {}) {
  const page = parseFixture(html);
  class FakeElement {
    matches() { return false; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    contains() { return false; }
  }
  class FakeMediaElement extends FakeElement {}
  class FakeVideoElement extends FakeMediaElement {}
  class FakeScriptElement extends FakeElement {
    constructor(text) { super(); this.textContent = text; }
  }
  const scriptNodes = page.scripts.map((text) => new FakeScriptElement(text));
  const metaNode = (predicate) => {
    const meta = page.metas.find(predicate);
    return meta ? { content: meta.content } : null;
  };
  const document = {
    baseURI: href,
    title: page.title,
    readyState: "complete",
    documentElement: {},
    addEventListener() {},
    querySelector(selector) {
      if (/twitter:title/i.test(selector)) return metaNode((meta) => /^twitter:title$/i.test(meta.name || meta.property || ""));
      if (/og:title/i.test(selector)) return metaNode((meta) => /^og:title$/i.test(meta.property || ""));
      if (selector === "h1") return page.heading ? { textContent: page.heading } : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "script") return scriptNodes;
      if (/og:image/i.test(selector)) {
        const meta = page.metas.find((item) => /^og:image$/i.test(item.property || ""));
        return meta ? [{ content: meta.content }] : [];
      }
      return [];
    }
  };
  const messages = [];
  let listener = null;
  const windowObject = { addEventListener() {} };
  windowObject.top = topFrame ? windowObject : {};
  const location = new URL(href);
  const context = vm.createContext({
    URL,
    window: windowObject,
    location: { hostname, href, pathname: location.pathname, search: location.search, origin: location.origin },
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
    String,
    queueMicrotask,
    MutationObserver: class { observe() {} },
    chrome: {
      runtime: {
        sendMessage(message) { messages.push(message); return Promise.resolve(); },
        onMessage: { addListener(fn) { listener = fn; } }
      }
    }
  });
  vm.runInContext(siteExtractSource, context, { filename: "site-extract.js" });
  vm.runInContext(contentSource, context, { filename: "content.js" });
  const ask = (message) => new Promise((resolve) => { listener(message, {}, resolve); });
  return { messages, ask };
}

const mediaMessages = (messages) => messages.filter((message) => message.type === "CONTENT_MEDIA").map((message) => message.data);
// Values built inside the vm belong to its realm (Array species included), so
// structural comparisons go through JSON first.
const plain = (value) => JSON.parse(JSON.stringify(value));
const deepEqual = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

// ---------------------------------------------------------------------------
// lib/site-extract.js
// ---------------------------------------------------------------------------

test("payload site gating covers the three ladder sites and stays top-frame only", () => {
  const extract = loadSiteExtract();
  assert.equal(extract.payloadSiteForPage("www.pornhub.com", true), "pornhub");
  assert.equal(extract.payloadSiteForPage("cn.pornhub.com", true), "pornhub");
  assert.equal(extract.payloadSiteForPage("www.pornhubpremium.com", true), "pornhub");
  assert.equal(extract.payloadSiteForPage("missav.ws", true), "missav");
  assert.equal(extract.payloadSiteForPage("missav.com", true), "missav");
  assert.equal(extract.payloadSiteForPage("missav123.com", true), "missav");
  assert.equal(extract.payloadSiteForPage("thisav.com", true), "missav");
  assert.equal(extract.payloadSiteForPage("jable.tv", true), "jable");
  assert.equal(extract.payloadSiteForPage("pornhub.com.evil.test", true), null);
  assert.equal(extract.payloadSiteForPage("jable.tv", false), null);
  deepEqual([...extract.LADDER_SITES], ["pornhub", "missav", "jable"]);
});

test("Pornhub flashvars yield one HLS master per quality, the title, duration and poster", () => {
  const extract = loadSiteExtract();
  const script = parseFixture(fixture("pornhub-watch.html")).scripts.find((text) => text.includes("flashvars_"));
  assert.equal(extract.scriptMayCarryLadder("pornhub", script), true);
  assert.equal(extract.scriptMayCarryLadder("pornhub", "window.unrelated = 1;"), false);
  const ladder = extract.extractPornhubLadder(script);
  assert.equal(ladder.key, "pornhub:431238401");
  assert.equal(ladder.title, "Fixture Clip: A Walk Through The Studio");
  assert.equal(ladder.duration, 4352);
  assert.equal(ladder.thumbnailUrl, "https://ei.fixture.test/videos/202305/10/431238401/original/poster.jpg");
  deepEqual(ladder.renditions.map((rendition) => [rendition.height, rendition.width]), [[1080, 1920], [720, 1280], [480, 854], [240, 426]]);
  assert.ok(ladder.renditions.every((rendition) => /^https:\/\/hv-h\.phncdn\.com\/hls\/videos\/.*\/master\.m3u8\?h=/.test(rendition.url)));
  assert.equal(ladder.renditions[0].url, "https://hv-h.phncdn.com/hls/videos/202305/10/431238401/1080P_4000K_431238401.mp4/master.m3u8?h=SIG1080%2Fx%3D&e=1792658400&f=1",
    "the escaped JSON string decodes to the exact signed address");
  assert.ok(!JSON.stringify(ladder).includes("get_media"), "the remote get_media JSON entry is never followed");
  assert.equal(extract.extractSiteLadder("pornhub", script).renditions.length, 4);
  // Shapes that must not produce a ladder.
  assert.equal(extract.extractPornhubLadder('var flashvars_1 = {"mediaDefinitions":[{"format":"mp4","videoUrl":"https://x.test/a.mp4","quality":"720"}]};'), null, "no HLS entry, no ladder");
  assert.equal(extract.extractPornhubLadder('var flashvars_2 = {"mediaDefinitions":[{"format":"hls","videoUrl":"http://user:pw@x.test/a.m3u8","quality":"720"}]};'), null, "credentials in the address are refused");
  assert.equal(extract.extractPornhubLadder('var flashvars_3 = {"mediaDefinitions":[{"format":"hls","videoUrl":"https://x.test/a.m3u8"}]};'), null, "a rendition without a height is not a ladder step");
  assert.equal(extract.extractPornhubLadder("var flashvars_4 = {\"a\": \"truncated"), null, "an unbalanced object parses to nothing");
  assert.equal(extract.extractPornhubLadder("x".repeat(8_000_001)), null, "oversized text is skipped");
});

test("the packer decoder recovers MissAV's playlist address without evaluating page code", () => {
  const extract = loadSiteExtract();
  const scripts = parseFixture(fixture("missav-watch.html")).scripts;
  const carrier = scripts.find((text) => text.includes("m3u8"));
  const decoy = scripts.find((text) => text.includes("debugger"));
  assert.equal(extract.scriptMayCarryLadder("missav", carrier), true);
  assert.equal(extract.scriptMayCarryLadder("missav", decoy), false, "a packed script without a playlist is never decoded");
  const unpacked = extract.unpackPackedScripts(carrier);
  assert.equal(unpacked.length, 1);
  assert.equal(unpacked[0], "source='https://surrit.com/2a0c794a-af0d-4834-80cc-efd9dc586df2/playlist.m3u8';source842='https://surrit.com/2a0c794a-af0d-4834-80cc-efd9dc586df2/720p/video.m3u8';source1280='https://surrit.com/2a0c794a-af0d-4834-80cc-efd9dc586df2/1080p/video.m3u8';");
  deepEqual(extract.extractMissavPlaylist(carrier), {
    key: "missav:/2a0c794a-af0d-4834-80cc-efd9dc586df2",
    url: "https://surrit.com/2a0c794a-af0d-4834-80cc-efd9dc586df2/playlist.m3u8"
  });
  // The general base-62 encoder variant and escaped quotes inside the payload.
  const packed62 = "x}('2=\\'1://0/a.m3u8\\';',62,3,'cdn.example.test|https|source'.split('|'),0,{}))";
  assert.equal(extract.unpackPackedScripts(packed62)[0], "source='https://cdn.example.test/a.m3u8';");
  assert.equal(extract.extractMissavPlaylist(packed62).url, "https://cdn.example.test/a.m3u8");
  deepEqual(extract.unpackPackedScripts("}('unterminated,62,3,'a'.split('|'),0,{}))"), [], "a broken payload decodes to nothing");
  deepEqual(extract.unpackPackedScripts("}('p',999,3,'a'.split('|'),0,{}))"), [], "an impossible radix is refused");
  assert.equal(extract.extractMissavPlaylist("source='https://cdn.example.test/plain/playlist.m3u8';").url, "https://cdn.example.test/plain/playlist.m3u8", "an unpacked assignment works too");
  assert.equal(extract.extractMissavPlaylist("source='https://cdn.example.test/plain/clip.mp4';"), null, "only playlists qualify");
});

test("Jable's hlsUrl assignment names the AES-128 playlist", () => {
  const extract = loadSiteExtract();
  const script = parseFixture(fixture("jable-watch.html")).scripts.find((text) => text.includes("hlsUrl"));
  assert.equal(extract.scriptMayCarryLadder("jable", script), true);
  deepEqual(extract.extractJablePlaylist(script), {
    key: "jable:/hls/0f3a2c1d/aa11bb22/fix-001/video.m3u8",
    url: "https://abc-cdn.mushroomtrack.test/hls/0f3a2c1d/aa11bb22/fix-001/video.m3u8"
  });
  assert.equal(extract.extractJablePlaylist('var hlsUrl = "https://cdn.example.test/v.m3u8?token=1";').url, "https://cdn.example.test/v.m3u8?token=1");
  assert.equal(extract.extractJablePlaylist("var hlsUrl = 'javascript:alert(1)';"), null);
  assert.equal(extract.extractJablePlaylist("var hlsUrl = 'https://cdn.example.test/v.mp4';"), null);
});

// ---------------------------------------------------------------------------
// content/content.js
// ---------------------------------------------------------------------------

test("a Pornhub watch page sends one ladder-keyed HLS candidate per quality with the readable title", async () => {
  const { messages, ask } = runContentScript(fixture("pornhub-watch.html"), {
    hostname: "www.pornhub.com",
    href: "https://www.pornhub.com/view_video.php?viewkey=645ab8c01b680"
  });
  const media = mediaMessages(messages);
  deepEqual(media.map((item) => item.height), [1080, 720, 480, 240]);
  for (const item of media) {
    assert.equal(item.source, "site-payload");
    assert.equal(item.mime, "application/vnd.apple.mpegurl");
    assert.equal(item.ladderKey, "pornhub:431238401");
    assert.equal(item.ladderRank, item.height);
    assert.equal(item.duration, 4352);
    assert.equal(item.title, "Fixture Clip: A Walk Through The Studio", "the social-card title, not flashvars' whitespace-mangled copy");
    assert.equal(item.tabUrl, "https://www.pornhub.com/view_video.php?viewkey=645ab8c01b680");
    assert.equal(item.thumbnailSource, "poster");
    assert.equal(item.thumbnailUrl, "https://ei.fixture.test/videos/202305/10/431238401/original/poster.jpg");
  }
  assert.ok(messages.some((message) => message.type === "PAGE_PREVIEW" && message.data.thumbnailUrl.endsWith("/poster.jpg")));
  // The still-open page re-supplies its ladder to a restarted worker.
  const cached = await ask({ type: "GET_CACHED_SITE_MEDIA" });
  deepEqual(cached.items.map((item) => item.height), [1080, 720, 480, 240]);
  assert.equal(cached.items[0].ladderKey, "pornhub:431238401");
  // A manual rescan re-reads the (same) scripts and re-sends every rendition.
  const before = mediaMessages(messages).length;
  await ask({ type: "REQUEST_SCAN" });
  assert.ok(mediaMessages(messages).length >= before + 4);
});

test("a MissAV page sends the decoded master playlist once, named after the page", async () => {
  const { messages, ask } = runContentScript(fixture("missav-watch.html"), {
    hostname: "missav.ws",
    href: "https://missav.ws/dm29/en/kawd-646"
  });
  const media = mediaMessages(messages);
  assert.equal(media.length, 1);
  assert.equal(media[0].url, "https://surrit.com/2a0c794a-af0d-4834-80cc-efd9dc586df2/playlist.m3u8");
  assert.equal(media[0].ladderKey, "missav:/2a0c794a-af0d-4834-80cc-efd9dc586df2");
  assert.equal(media[0].title, "KAWD-646 Fixture Club Manager Hinanocchi! Long Form Title (Fixture)");
  assert.equal(media[0].height, null, "the master carries the ladder; the engine reads it");
  assert.equal((await ask({ type: "GET_CACHED_SITE_MEDIA" })).items.length, 1);
});

test("a Jable page sends the AES-128 playlist with the site suffix stripped from the title", () => {
  const { messages } = runContentScript(fixture("jable-watch.html"), {
    hostname: "jable.tv",
    href: "https://jable.tv/videos/fix-001/"
  });
  const media = mediaMessages(messages);
  assert.equal(media.length, 1);
  assert.equal(media[0].url, "https://abc-cdn.mushroomtrack.test/hls/0f3a2c1d/aa11bb22/fix-001/video.m3u8");
  assert.equal(media[0].ladderKey, "jable:/hls/0f3a2c1d/aa11bb22/fix-001/video.m3u8");
  assert.equal(media[0].title, "FIX-001 Fixture Afternoon Scene");
});

test("listing pages, other sites and frames never read ladder scripts", () => {
  const pornhub = fixture("pornhub-watch.html");
  deepEqual(mediaMessages(runContentScript(pornhub, { hostname: "www.pornhub.com", href: "https://www.pornhub.com/video?o=tr" }).messages), [],
    "a listing page has no video of its own");
  deepEqual(mediaMessages(runContentScript(pornhub, { hostname: "www.pornhub.com", href: "https://www.pornhub.com/view_video.php?viewkey=645ab8c01b680", topFrame: false }).messages), [],
    "embedded frames do not scan page scripts");
  deepEqual(mediaMessages(runContentScript(pornhub, { hostname: "example.test", href: "https://example.test/view_video.php?viewkey=645ab8c01b680" }).messages), [],
    "the same markup on another host is not an adapter page");
  deepEqual(mediaMessages(runContentScript(fixture("missav-watch.html"), { hostname: "missav.ws", href: "https://missav.ws/dm265/en" }).messages), [],
    "the MissAV home page is not a video page");
});

test("the worker's adapter registry and ladder plumbing stay consistent with the content side", () => {
  const registry = backgroundSource.match(/const SITE_ADAPTERS = Object\.freeze\(\[([\s\S]*?)\n\]\);/)?.[1] || "";
  for (const id of ["pornhub", "missav", "jable"]) assert.match(registry, new RegExp(`id: "${id}",[\\s\\S]*?ladder: true`), `${id} is a ladder adapter`);
  assert.match(backgroundSource, /const ladderSite = ladderAdapter\?\.ladder === true \? ladderAdapter\.id : null;/, "ladder keys are accepted only from adapter pages");
  assert.match(backgroundSource, /data\.ladderKey\.startsWith\(`\$\{ladderSite\}:`\)/, "and only when the key names that adapter");
  assert.match(backgroundSource, /function adapterHeadersForPage\(tabUrl\)/);
  assert.doesNotMatch(backgroundSource.match(/function adapterHeadersForPage[\s\S]*?\n\}/)[0], /cookie/i, "adapter headers never carry cookies");
  assert.match(backgroundSource, /: capture && Date\.now\(\) - capture\.at <= HEADER_TTL_MS \? capture\.headers : adapterRequestHeaders\(candidate\);/,
    "observed headers win; the page-derived Referer/Origin/UA is the fallback");
});
