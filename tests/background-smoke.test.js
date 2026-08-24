import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function event() {
  const listeners = [];
  return { listeners, addListener(fn, ...args) { listeners.push({ fn, args }); } };
}

test("MV3 worker registers network and message listeners during module load", async () => {
  const onBeforeSendHeaders = event();
  const onHeadersReceived = event();
  const onCompleted = event();
  const onErrorOccurred = event();
  const onMessage = event();
  const onConnect = event();
  const onDownloadChanged = event();
  const onTabRemoved = event();
  const onTabUpdated = event();
  const onTabActivated = event();
  const onPermissionsAdded = event();
  const onPermissionsRemoved = event();
  const nativeOnMessage = event();
  const nativeOnDisconnect = event();
  const extensionId = "gpnojfocoanelgibidlhholjobljefab";
  const opaqueIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  let nativePermission = false;
  const nativeOutgoing = [];
  let nativeConnectCalls = 0;
  let nativePortDisconnects = 0;
  let blockBrowserPersist = false;
  let browserPersistEntered = null;
  let releaseBrowserPersist = null;
  let blockBrowserSearch = false;
  let browserSearchEntered = null;
  let releaseBrowserSearch = null;
  let browserSearchState = "complete";
  let browserDownloadId = 42;
  const browserDownloadRequests = [];
  let blockSettingsRead = false;
  let settingsReadEntered = null;
  let releaseSettingsRead = null;
  let blockAutomaticTabRead = false;
  let automaticTabReadEntered = null;
  let releaseAutomaticTabRead = null;
  let revokeNativePermissionAfterRecoveryWrite = false;
  let cancelEmitsInterrupted = false;
  let cancelRejects = false;
  const cancelledDownloads = [];
  const manifestFixtures = new Map();
  const manifestFetches = [];
  let automaticBiliFetchDelayMs = 0;
  let automaticBiliPageListDelayMs = 0;
  const settingsState = {};
  const uiMessages = [];
  const badgeUpdates = [];
  const tabGetCalls = [];
  const legacyRootUrl = "https://legacy.example.test/media/master.m3u8";
  const legacyHighUrl = "https://legacy-cdn.example.test/delivery/high.m3u8";
  const legacyLowUrl = "https://legacy-cdn.example.test/delivery/low.m3u8";
  manifestFixtures.set(legacyRootUrl, {
    text: [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080",
      legacyHighUrl,
      "#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720",
      legacyLowUrl
    ].join("\n")
  });
  manifestFixtures.set(legacyHighUrl, {
    text: ["#EXTM3U", "#EXTINF:6,", "https://legacy-segments.example.test/high-1.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  manifestFixtures.set(legacyLowUrl, {
    text: ["#EXTM3U", "#EXTINF:6,", "https://legacy-segments.example.test/low-1.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  const biliPageUrl = "https://www.bilibili.com/video/BV14N8G6pEAf/";
  const biliAvPageUrl = "https://www.bilibili.com/video/av99999/";
  const biliOptInPageUrl = "https://www.bilibili.com/video/av424242/";
  const biliFailedDiscoveryPageUrl = "https://www.bilibili.com/video/av13579/";
  const biliAvVideo = "https://upos-sz-mirror08c.bilivideo.cn/upgcxcode/77/88/88001-1-30080.m4s?deadline=1999999999&upsig=AV_1080_SECRET";
  const biliAvAudio = "https://upos-sz-mirror08c.bilivideo.cn/upgcxcode/77/88/88001-1-30280.m4s?deadline=1999999999&upsig=AV_AUDIO_SECRET";
  const youtubeWatchUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const instagramCdnUrl = "https://scontent.cdninstagram.com/v/t66.28340-6/10000000_4242424242424242_7777777777777777777_n.mp4?efg=eyJ1IjoxfQ&oe=67FFFFFF";
  const twitterCdnUrl = "https://video.twimg.com/ext_tw_video/1899999999999999999/pu/vid/avc1/1280x720/abcdefghijklmnopqrstuv-rs=600?tag=12";
  const biliVideo480 = "https://upos-sz-mirrorcoso1.edge.mountaintoys.cn:4483/v1/resource/upgcxcode/12/34/41067939286-1-30032.m4s?deadline=1999999999&upsig=VIDEO_480_SECRET";
  const biliVideo480Hevc = "https://upos-sz-mirror08c.bilivideo.cn:8082/upgcxcode/12/34/41067939286-1-30132.m4s?deadline=1999999999&upsig=VIDEO_HEVC_SECRET";
  const biliVideo360 = "https://upos-sz-mirror08c.bilivideo.cn:8082/upgcxcode/12/34/41067939286-1-30016.m4s?deadline=1999999999&upsig=VIDEO_360_SECRET";
  const biliAudioAac = "https://upos-sz-mirror08c.bilivideo.cn:8082/upgcxcode/12/34/41067939286-1-30280.m4s?deadline=1999999999&upsig=AUDIO_AAC_SECRET";
  const biliAudioFlac = "https://upos-sz-mirror08c.bilivideo.cn:8082/upgcxcode/12/34/41067939286-1-30251.m4s?deadline=1999999999&upsig=AUDIO_FLAC_SECRET";
  manifestFixtures.set("https://api.bilibili.com/x/player/pagelist?bvid=BV14N8G6pEAf", {
    text: JSON.stringify({ code: 0, data: [{ cid: 41067939286, page: 1, part: "Fixture" }] })
  });
  manifestFixtures.set("https://api.bilibili.com/x/player/pagelist?avid=99999", {
    text: JSON.stringify({ code: 0, data: [{ cid: 88001, page: 1, part: "Auto Badge Fixture" }] })
  });
  manifestFixtures.set("https://api.bilibili.com/x/player/playurl?avid=99999&cid=88001&qn=127&fnval=16&fourk=1", {
    text: JSON.stringify({
      code: 0,
      data: {
        dash: {
          duration: 92,
          video: [
            { id: 80, baseUrl: biliAvVideo, width: 1920, height: 1080, bandwidth: 2_600_000, codecs: "avc1.640828", mimeType: "video/mp4" }
          ],
          audio: [
            { id: 30280, baseUrl: biliAvAudio, bandwidth: 128_000, codecs: "mp4a.40.2", mimeType: "audio/mp4" }
          ]
        }
      }
    })
  });
  manifestFixtures.set("https://api.bilibili.com/x/player/pagelist?avid=424242", {
    text: JSON.stringify({ code: 0, data: [{ cid: 88001, page: 1, part: "Opt-in Fixture" }] })
  });
  manifestFixtures.set("https://api.bilibili.com/x/player/playurl?avid=424242&cid=88001&qn=127&fnval=16&fourk=1", {
    text: JSON.stringify({
      code: 0,
      data: {
        dash: {
          duration: 92,
          video: [
            { id: 80, baseUrl: biliAvVideo, width: 1920, height: 1080, bandwidth: 2_600_000, codecs: "avc1.640828", mimeType: "video/mp4" }
          ],
          audio: [
            { id: 30280, baseUrl: biliAvAudio, bandwidth: 128_000, codecs: "mp4a.40.2", mimeType: "audio/mp4" }
          ]
        }
      }
    })
  });
  manifestFixtures.set("https://api.bilibili.com/x/player/playurl?bvid=BV14N8G6pEAf&cid=41067939286&qn=127&fnval=16&fourk=1", {
    text: JSON.stringify({
      code: 0,
      data: {
        dash: {
          duration: 185,
          video: [
            { id: 32, baseUrl: biliVideo480, width: 852, height: 480, bandwidth: 900000, codecs: "avc1.64001f", mimeType: "video/mp4" },
            { id: 32, baseUrl: biliVideo480Hevc, width: 852, height: 480, bandwidth: 700000, codecs: "hev1.1.6.L90", mimeType: "video/mp4" },
            { id: 16, baseUrl: biliVideo360, width: 640, height: 360, bandwidth: 500000, codecs: "avc1.64001e", mimeType: "video/mp4" }
          ],
          audio: [
            { id: 30280, baseUrl: biliAudioAac, bandwidth: 128000, codecs: "mp4a.40.2", mimeType: "audio/mp4" },
            { id: 30251, baseUrl: biliAudioFlac, bandwidth: 700000, codecs: "fLaC", mimeType: "audio/mp4" }
          ]
        }
      }
    })
  });
  const tabFixtures = new Map([
    [12, { id: 12, title: "Generative Motion Workshop", url: "https://course.example.test/generative-motion" }],
    [21, { id: 21, title: "Bilibili Fixture | 哔哩哔哩", url: `${biliPageUrl}?spm_id_from=333.1007&vd_source=PRIVATE_TRACKING` }],
    [22, { id: 22, title: "Observed Bilibili Fixture", url: "https://www.bilibili.com/video/av12345/" }],
    [23, { id: 23, title: "Unpaired Bilibili Fixture", url: "https://www.bilibili.com/video/av67890/" }],
    [24, { id: 24, title: "Mixed Bilibili Fixture", url: "https://www.bilibili.com/video/av24680/" }],
    [25, { id: 25, title: "SPA generation fixture", url: "https://www.bilibili.com/video/av11223/" }],
    [26, { id: 26, title: "Discovery generation fixture", url: biliPageUrl }],
    [27, { id: 27, title: "Strict TTL fixture", url: "https://www.bilibili.com/video/av77889/" }],
    [28, { id: 28, title: "YouTube Fixture - FluxCatch", url: `${youtubeWatchUrl}&t=42s` }],
    [29, { id: 29, title: "Auto Badge Fixture - 哔哩哔哩", url: biliAvPageUrl }],
    [30, { id: 30, title: "Instagram Fixture", url: "https://www.instagram.com/reel/Cxyz1234567/" }],
    [31, { id: 31, title: "X Fixture", url: "https://x.com/fluxcatch/status/1899999999999999999" }],
    [32, { id: 32, title: "Opt-in Bilibili Fixture", url: biliOptInPageUrl }],
    [33, { id: 33, title: "Generic page title", url: "https://page.example.test/direct" }],
    [34, { id: 34, title: "Unobserved redirect hint", url: "https://page.example.test/hint" }],
    [35, { id: 35, title: "Failed Bilibili discovery fixture", url: biliFailedDiscoveryPageUrl }],
    [36, { id: 36, title: "Automatic discovery generation fixture", url: biliAvPageUrl }],
    [37, { id: 37, title: "Automatic discovery fallback-budget fixture", url: biliAvPageUrl }],
    [38, { id: 38, title: "Disabled automatic discovery fixture", url: biliOptInPageUrl }]
  ]);
  const restoredJobs = Array.from({ length: 205 }, (_, index) => ({
    jobId: `old-${index}`,
    method: "native",
    filename: `old-${index}.mp4`,
    status: "completed",
    progress: 1,
    createdAt: index + 1,
    updatedAt: index + 1
  }));
  restoredJobs.push({
    jobId: "restore-native",
    method: "native",
    filename: "/Users/private/restored.mp4",
    status: "downloading",
    progress: 0.4,
    message: "读取 https://user:pass@media.example.test/file.m3u8?token=RESTORE_SECRET",
    headers: { cookie: "RESTORE_COOKIE" },
    manifestText: "#EXTM3U SECRET",
    createdAt: Date.now() - 2_000,
    updatedAt: Date.now() - 1_000
  });
  restoredJobs.push({
    jobId: "browser:77",
    method: "browser",
    downloadId: 77,
    filename: "restored-browser.mp4",
    status: "downloading",
    createdAt: Date.now() - 2_000,
    updatedAt: Date.now() - 1_000
  });
  const sessionState = {
    tabMedia: {
      9: [{
        id: "fixture-video",
        url: "https://media.example.test/movie.mp4",
        kind: "video",
        mime: "video/mp4",
        ext: "mp4",
        contentLength: 2_000_000,
        title: "Fixture video",
        source: "webRequest",
        sources: ["webRequest"],
        provenance: "observed_response",
        firstSeen: Date.now() - 1_000,
        lastSeen: Date.now()
      }],
      13: [
        {
          id: "legacy-root",
          url: legacyRootUrl,
          kind: "hls",
          mime: "application/vnd.apple.mpegurl",
          ext: "m3u8",
          contentLength: 2100,
          source: "webRequest",
          sources: ["webRequest"],
          provenance: "observed_response",
          pageTitle: "Legacy Workshop",
          firstSeen: Date.now() - 3_000,
          lastSeen: Date.now() - 1_000
        },
        {
          id: "legacy-high",
          url: legacyHighUrl,
          kind: "hls",
          mime: "application/vnd.apple.mpegurl",
          ext: "m3u8",
          contentLength: 1700,
          source: "webRequest",
          sources: ["webRequest"],
          provenance: "observed_response",
          pageTitle: "Legacy Workshop",
          firstSeen: Date.now() - 2_900,
          lastSeen: Date.now() - 900
        },
        {
          id: "legacy-low",
          url: legacyLowUrl,
          kind: "hls",
          mime: "application/vnd.apple.mpegurl",
          ext: "m3u8",
          contentLength: 1500,
          source: "webRequest",
          sources: ["webRequest"],
          provenance: "observed_response",
          pageTitle: "Legacy Workshop",
          firstSeen: Date.now() - 2_800,
          lastSeen: Date.now() - 800
        }
      ]
    },
    jobs: restoredJobs
  };
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    manifestFetches.push({ url, credentials: options.credentials });
    if (automaticBiliPageListDelayMs > 0 && url.includes("pagelist?avid=99999")) {
      const delay = automaticBiliPageListDelayMs;
      automaticBiliPageListDelayMs = 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    if (automaticBiliFetchDelayMs > 0 && url.includes("playurl?avid=99999&cid=88001")) {
      const delay = automaticBiliFetchDelayMs;
      automaticBiliFetchDelayMs = 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    const fixture = manifestFixtures.get(url);
    return {
      ok: Boolean(fixture),
      status: fixture ? 200 : 404,
      url: fixture?.finalUrl || url,
      headers: { get: (name) => String(name).toLowerCase() === "content-length" && fixture ? String(Buffer.byteLength(fixture.text)) : null },
      text: async () => fixture?.text || "not found"
    };
  };
  globalThis.chrome = {
    webRequest: { onBeforeSendHeaders, onHeadersReceived, onCompleted, onErrorOccurred },
    runtime: {
      id: extensionId,
      getURL: (path = "") => `chrome-extension://${extensionId}/${path}`,
      getManifest: () => ({ name: "FluxCatch", version: "0.2.4" }),
      onConnect,
      onMessage,
      lastError: null,
      connectNative: () => {
        nativeConnectCalls += 1;
        return ({
        onMessage: nativeOnMessage,
        onDisconnect: nativeOnDisconnect,
        disconnect: () => { nativePortDisconnects += 1; },
        postMessage: (message) => {
          nativeOutgoing.push(message);
          if (message.type === "ping") queueMicrotask(() => nativeOnMessage.listeners[0]?.fn({
            type: "pong",
            requestId: message.requestId,
            version: "0.2.4",
            protocolVersion: 1,
            capabilityProfileVersion: 1,
            ffmpeg: true,
            path: "/Users/private/HOST_TOP_PATH",
            capabilities: {
              ffmpeg: {
                available: true,
                path: "/Users/private/FFMPEG_PATH",
                version: "8.1",
                demuxers: { hls: true, dash: false },
                encoders: { libmp3lame: true },
                probeError: "FFMPEG_PROBE_SECRET",
                future: "FFMPEG_FUTURE_SECRET"
              },
              ytdlp: { available: true, networkDisabled: false, path: "/Users/private/YTDLP_PATH", version: "2026.08", probeError: "YTDLP_PROBE_SECRET" },
              dashPlanner: "static-v1",
              dashPair: "direct-v1",
              future: "HOST_CAPABILITY_FUTURE"
            },
            future: "HOST_PONG_FUTURE"
          }));
        }
      });
      }
    },
    tabs: {
      onRemoved: onTabRemoved,
      onUpdated: onTabUpdated,
      onActivated: onTabActivated,
      get: async (tabId) => {
        tabGetCalls.push(tabId);
        if (tabId === 36 && blockAutomaticTabRead) {
          blockAutomaticTabRead = false;
          automaticTabReadEntered?.();
          await new Promise((resolve) => { releaseAutomaticTabRead = resolve; });
        }
        return tabFixtures.get(tabId) || {};
      }
    },
    downloads: {
      onChanged: onDownloadChanged,
      download: async (options) => {
        browserDownloadRequests.push(structuredClone(options));
        return browserDownloadId;
      },
      cancel: async (id) => {
        cancelledDownloads.push(id);
        if (cancelRejects) throw new Error("fixture cancellation rejected");
        if (cancelEmitsInterrupted) {
          // Match Chrome's ordering: onChanged may announce interruption
          // synchronously, before downloads.cancel() settles.
          onDownloadChanged.listeners[0]?.fn({
            id,
            state: { current: "interrupted" },
            filename: { current: "/Users/private/FluxCatch/task.mp4" }
          });
        }
      },
      search: async ({ id }) => {
        if (id === 42 && blockBrowserSearch) {
          blockBrowserSearch = false;
          browserSearchEntered?.();
          await new Promise((resolve) => { releaseBrowserSearch = resolve; });
        }
        return [77, 42, 43, 44].includes(id) ? [{
          id,
          state: id === 42 ? browserSearchState : [43, 44].includes(id) ? "in_progress" : "complete",
          paused: false,
          bytesReceived: id === 42 ? 2_000_000 : [43, 44].includes(id) ? 256_000 : 1000,
          totalBytes: id === 42 ? 2_000_000 : [43, 44].includes(id) ? 2_000_000 : 1000,
          filename: id === 42 ? "/Users/private/FluxCatch/browser.mp4" : id === 43 ? "/Users/private/FluxCatch/cancel-race.mp4" : id === 44 ? "/Users/private/FluxCatch/cancel-rejected.mp4" : "/Users/private/restored-browser.mp4"
        }] : [];
      }
    },
    storage: {
      session: {
        get: async () => sessionState,
        set: async (value) => {
          if (blockBrowserPersist && value.jobs?.some((job) => job.jobId === "browser:42")) {
            blockBrowserPersist = false;
            browserPersistEntered?.();
            await new Promise((resolve) => { releaseBrowserPersist = resolve; });
          }
          Object.assign(sessionState, structuredClone(value));
        }
      },
      local: {
        get: async () => {
          if (blockSettingsRead) {
            blockSettingsRead = false;
            settingsReadEntered?.();
            await new Promise((resolve) => { releaseSettingsRead = resolve; });
          }
          return settingsState;
        },
        set: async (value) => {
          Object.assign(settingsState, structuredClone(value));
          if (revokeNativePermissionAfterRecoveryWrite && value?.nativeApiRecovery) {
            revokeNativePermissionAfterRecoveryWrite = false;
            nativePermission = false;
          }
        },
        remove: async (key) => { delete settingsState[key]; }
      }
    },
    permissions: { contains: async () => nativePermission, onAdded: onPermissionsAdded, onRemoved: onPermissionsRemoved },
    action: {
      setBadgeText: async (value) => badgeUpdates.push(value),
      setBadgeBackgroundColor: async () => {},
      setTitle: async () => {}
    }
  };
  const nativeConnectFixture = globalThis.chrome.runtime.connectNative;
  await import(`../extension/background.js?smoke=${Date.now()}`);
  assert.equal(onBeforeSendHeaders.listeners.length, 1);
  assert.equal(onHeadersReceived.listeners.length, 1);
  assert.equal(onCompleted.listeners.length, 1);
  assert.equal(onErrorOccurred.listeners.length, 1);
  assert.equal(onMessage.listeners.length, 1);
  assert.equal(onConnect.listeners.length, 1);
  assert.equal(onTabRemoved.listeners.length, 1);
  assert.equal(onTabUpdated.listeners.length, 1);
  assert.equal(onTabActivated.listeners.length, 1);
  assert.equal(onPermissionsRemoved.listeners.length, 1);
  assert.deepEqual(onHeadersReceived.listeners[0].args[0].types, ["media", "xmlhttprequest", "other"]);

  const extensionSender = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel/sidepanel.html` };
  const sendRuntimeMessage = (message, sender = extensionSender) => new Promise((resolve) => {
    onMessage.listeners[0].fn(message, sender, resolve);
  });
  const uiDisconnect = event();
  onConnect.listeners[0].fn({
    name: "fluxcatch-sidepanel",
    sender: extensionSender,
    onDisconnect: uiDisconnect,
    postMessage: (message) => uiMessages.push(structuredClone(message))
  });

  onTabActivated.listeners[0].fn({ tabId: 9 });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (badgeUpdates.filter((item) => item.tabId === 9).at(-1)?.text === "1") break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 9).at(-1)?.text,
    "1",
    "tab activation reapplies a badge from media restored after a service-worker restart"
  );

  const response = await new Promise((resolve) => {
    const keepAlive = onMessage.listeners[0].fn(
      { type: "GET_SETTINGS" },
      { id: extensionId, url: `chrome-extension://${extensionId}/popup/popup.html` },
      resolve
    );
    assert.equal(keepAlive, true);
  });
  assert.equal(response.ok, true);
  assert.equal(response.settings.concurrentFragments, 8);
  assert.equal(response.settings.minimumBytes, 500 * 1024);
  assert.equal(response.settings.autoEnrichSiteQuality, true, "automatic Bilibili enrichment defaults to enabled");
  assert.equal(response.settings.allowPrivateNetworkMedia, false);
  const unknownHostYoutube = await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: { youtubeEnabled: true } });
  assert.equal(unknownHostYoutube.settings.youtubeEnabled, false,
    "an unknown or unpermitted native capability cannot persist the YouTube switch");
  assert.equal(settingsState.settings.youtubeEnabled, false);

  onHeadersReceived.listeners[0].fn({
    requestId: "content-disposition-name",
    tabId: 33,
    url: "https://media.example.test/direct.mp4?token=PRIVATE_TOKEN",
    type: "media",
    responseHeaders: [
      { name: "content-type", value: "video/mp4" },
      { name: "content-length", value: String(900 * 1024) },
      { name: "content-disposition", value: "attachment; filename=server_course_title.mp4" }
    ]
  });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (badgeUpdates.filter((item) => item.tabId === 33).at(-1)?.text === "1") break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const directBadgeUpdatesBeforeRead = badgeUpdates.filter((item) => item.tabId === 33).length;
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 33).at(-1)?.text,
    "1",
    "a direct-media response publishes its badge before any UI reads tab media"
  );
  let namedDirect = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    namedDirect = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 33 })).items[0] || null;
    if (namedDirect) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(namedDirect?.suggestedFilename, "server_course_title.mp4",
    "a readable Content-Disposition filename takes precedence over a generic page title without rewriting its safe stem");
  assert.match(namedDirect?.id || "", opaqueIdPattern, "new candidates use collision-resistant random opaque IDs");
  assert.equal(namedDirect?.displayUrl, "https://media.example.test/direct.mp4",
    "the public candidate keeps the opaque id while hiding the signed query");
  assert.equal(namedDirect?.urlIsRedacted, true);
  assert.equal(namedDirect?.copyable, false);
  assert.equal(namedDirect?.requiresRefresh, true);
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 33).length,
    directBadgeUpdatesBeforeRead,
    "GET_TAB_MEDIA is a read-only operation for an already detected direct-media badge"
  );
  assert.equal(Object.hasOwn(namedDirect || {}, "url"), false, "PublicCandidate never publishes an executable URL field");
  assert.doesNotMatch(JSON.stringify({ namedDirect, sessionState }), /PRIVATE_TOKEN/);

  const biliFetchesBeforeRead = manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length;
  const biliBadgeUpdatesBeforeRead = badgeUpdates.filter((item) => item.tabId === 21).length;
  const biliBeforeScan = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 21 });
  assert.deepEqual(biliBeforeScan.items, [], "opening media UI is read-only before Bilibili playback or an explicit scan");
  assert.equal(
    manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length,
    biliFetchesBeforeRead,
    "GET_TAB_MEDIA does not start Bilibili metadata discovery"
  );
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 21).length,
    biliBadgeUpdatesBeforeRead,
    "opening media UI does not repaint or create a Bilibili badge"
  );
  const biliExplicitScan = await sendRuntimeMessage({ type: "SCAN_TAB", tabId: 21 });
  assert.equal(biliExplicitScan.ok, true);
  let biliApiMedia = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    biliApiMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 21 });
    if (biliApiMedia.items.length) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(biliApiMedia.ok, true);
  assert.equal(biliApiMedia.items.length, 1, "one Bilibili playback becomes one paired DASH candidate");
  const biliApiCandidate = biliApiMedia.items[0];
  assert.match(biliApiCandidate.id, opaqueIdPattern, "Bilibili candidates do not expose deterministic FNV identifiers");
  assert.equal(biliApiCandidate.kind, "dash_pair");
  assert.equal(biliApiCandidate.displayUrl, biliPageUrl, "public candidate key is a stable queryless page URL");
  assert.equal(biliApiCandidate.copyable, false);
  assert.equal(biliApiCandidate.requiresRefresh, true);
  assert.equal(biliApiCandidate.height, 480);
  assert.equal(biliApiCandidate.duration, 185);
  assert.equal(biliApiCandidate.videoTrackCount, 3);
  assert.equal(biliApiCandidate.audioTrackCount, 2);
  assert.equal(biliApiCandidate.available, true);
  assert.ok(biliApiCandidate.expiresAt > Date.now(), "public metadata carries only the pair expiry boundary");
  assert.ok(biliApiCandidate.tracks.every((track) => !Object.hasOwn(track, "url") && !Object.hasOwn(track, "headers")));
  assert.ok(biliApiCandidate.tracks.every((track) => /^bt-[a-z0-9]+-[a-z0-9]+$/.test(track.id)), "public track IDs are opaque and queryless");
  const biliSecrets = /VIDEO_(?:480|360|HEVC)_SECRET|AUDIO_(?:AAC|FLAC)_SECRET|upsig|deadline|vd_source|PRIVATE_TRACKING/;
  assert.doesNotMatch(JSON.stringify(biliApiCandidate), biliSecrets);
  assert.doesNotMatch(JSON.stringify(sessionState.tabMedia), biliSecrets, "signed tracks are never written to storage.session");
  assert.doesNotMatch(JSON.stringify(uiMessages), biliSecrets, "MEDIA_UPDATED broadcasts contain metadata only");
  assert.ok(manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).every((item) => item.credentials === "include"), "Bilibili playback APIs reuse the logged-in cookie jar so members get their full quality ladder");

  const biliApiProbe = await sendRuntimeMessage({
    type: "PROBE_MANIFEST",
    tabId: 21,
    candidate: biliApiCandidate
  });
  assert.equal(biliApiProbe.ok, true);
  assert.deepEqual(biliApiProbe.probe.variants.map((track) => track.height), [480, 360], "duplicate codec renditions collapse to one compatible choice per quality");
  assert.ok(biliApiProbe.probe.variants.every((track) => track.url.startsWith("https://fluxcatch.invalid/dash/")));
  assert.match(biliApiProbe.probe.variants[0].codecs, /avc1/i, "AVC wins the equal-quality compatibility tie");
  assert.doesNotMatch(JSON.stringify(biliApiProbe), biliSecrets);

  const forgedBiliVariant = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 21,
    candidate: biliApiCandidate,
    options: { filename: "forged.mp4", variantUrl: "https://fluxcatch.invalid/dash/forged/track" }
  });
  assert.equal(forgedBiliVariant.ok, false);
  assert.match(forgedBiliVariant.error, /清晰度/);

  const realDateNow = Date.now;
  Date.now = () => biliApiCandidate.expiresAt + 1;
  try {
    const expiredProbe = await sendRuntimeMessage({ type: "PROBE_MANIFEST", tabId: 21, candidate: biliApiCandidate });
    assert.equal(expiredProbe.ok, false, "an expired private candidate cannot mint selectors");
    assert.match(expiredProbe.error, /过期/);
    const expiredStart = await sendRuntimeMessage({
      type: "DOWNLOAD",
      tabId: 21,
      candidate: biliApiCandidate,
      options: { filename: "expired.mp4" }
    });
    assert.equal(expiredStart.ok, false, "download revalidates candidate and per-track TTL before native dispatch");
    assert.match(expiredStart.error, /过期/);
  } finally {
    Date.now = realDateNow;
  }

  const observedVideoA = "https://observed.edge.mountaintoys.cn/v1/resource/upgcxcode/55/66/998877-1-30032.m4s?deadline=111&upsig=OBSERVED_VIDEO_A";
  const observedVideoB = "https://observed.edge.mountaintoys.cn/v1/resource/upgcxcode/55/66/998877-1-30032.m4s?deadline=222&upsig=OBSERVED_VIDEO_B";
  const observedAudio = "https://observed.bilivideo.com/upgcxcode/55/66/998877-1-30280.m4s?deadline=111&upsig=OBSERVED_AUDIO";
  const beginBiliTrack = (requestId, tabId, url, documentId, initiator = "https://www.bilibili.com") => {
    onBeforeSendHeaders.listeners[0].fn({
      requestId, tabId, url, type: "xmlhttprequest", documentId, frameId: 0, initiator,
      requestHeaders: [
        { name: "Cookie", value: "SESSDATA=COOKIE_MUST_NOT_ESCAPE" },
        { name: "Authorization", value: "Bearer AUTH_MUST_NOT_ESCAPE" },
        { name: "Referer", value: "https://www.bilibili.com/video/av12345/?vd_source=PRIVATE" },
        { name: "User-Agent", value: "FluxCatch fixture UA" },
        { name: "Accept", value: "*/*" }
      ]
    });
  };
  const finishBiliTrack = (requestId, tabId, url, documentId, initiator = "https://www.bilibili.com") => {
    onHeadersReceived.listeners[0].fn({
      requestId, tabId, url, type: "xmlhttprequest", documentId, frameId: 0, initiator,
      responseHeaders: [
        { name: "content-type", value: "application/octet-stream" },
        { name: "content-range", value: "bytes 0-1023/5000000" },
        { name: "accept-ranges", value: "bytes" }
      ]
    });
  };
  const observeBiliTrack = (requestId, tabId, url, documentId, initiator = "https://www.bilibili.com") => {
    beginBiliTrack(requestId, tabId, url, documentId, initiator);
    finishBiliTrack(requestId, tabId, url, documentId, initiator);
  };
  observeBiliTrack("bili-audio-first", 22, observedAudio, "document-A");
  observeBiliTrack("bili-video-second", 22, observedVideoA, "document-A");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (badgeUpdates.filter((item) => item.tabId === 22).at(-1)?.text === "1") break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 22).at(-1)?.text,
    "1",
    "a passively observed Bilibili audio/video pair publishes its badge before any UI read"
  );
  let observedBiliMedia = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    observedBiliMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 22 });
    if (observedBiliMedia.items.length) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(observedBiliMedia.items.length, 1, "audio-first webRequest observations pair by document and asset family");
  assert.equal(observedBiliMedia.items[0].displayUrl, "https://www.bilibili.com/video/av12345/");
  observeBiliTrack("bili-video-range-repeat", 22, observedVideoB, "document-A");
  for (let attempt = 0; attempt < 20; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  observedBiliMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 22 });
  assert.equal(observedBiliMedia.items.length, 1, "Range repeats and rotating signatures update one private track instead of adding rows");
  assert.doesNotMatch(JSON.stringify(observedBiliMedia), /OBSERVED_|COOKIE_MUST_NOT_ESCAPE|AUTH_MUST_NOT_ESCAPE|deadline|upsig|vd_source/);
  assert.doesNotMatch(JSON.stringify(sessionState.tabMedia), /OBSERVED_|COOKIE_MUST_NOT_ESCAPE|AUTH_MUST_NOT_ESCAPE/);

  observeBiliTrack("bili-unpaired-video", 23, observedVideoA.replace("998877", "123456"), "document-one");
  observeBiliTrack("bili-unpaired-audio", 23, observedAudio.replace("998877", "123456"), "document-two");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 23 })).items, [], "tracks from different documents never pair");

  const mixedVideoA = observedVideoA.replace("998877", "777777");
  const mixedAudioA = observedAudio.replace("998877", "777777");
  observeBiliTrack("mixed-video-a", 24, mixedVideoA, "mixed-document");
  observeBiliTrack("mixed-audio-a", 24, mixedAudioA, "mixed-document");
  for (let attempt = 0; attempt < 10; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 24 })).items.length, 1);
  const mixedVideoB = "https://observed.bilivideo.com/upgcxcode/77/88/shared-tail-30032.m4s?upsig=MIXED_VIDEO_B";
  const mixedWrongAudio = "https://observed.bilivideo.com/upgcxcode/99/00/shared-tail-30280.m4s?upsig=MIXED_AUDIO_C";
  observeBiliTrack("mixed-video-b", 24, mixedVideoB, "mixed-document");
  observeBiliTrack("mixed-audio-c", 24, mixedWrongAudio, "mixed-document");
  for (let attempt = 0; attempt < 10; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 24 })).items,
    [],
    "a new incompatible asset removes the previously published pair and equal basenames in different directories do not cross-pair"
  );

  observeBiliTrack("ttl-video", 27, observedVideoA.replace("998877", "555555"), "ttl-document");
  observeBiliTrack("ttl-audio", 27, observedAudio.replace("998877", "555555"), "ttl-document");
  let ttlCandidate = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    [ttlCandidate] = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 27 })).items;
    if (ttlCandidate) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(ttlCandidate?.expiresAt > Date.now());
  const ttlRealDateNow = Date.now;
  Date.now = () => ttlCandidate.expiresAt + 1;
  try {
    assert.deepEqual(
      (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 27 })).items,
      [],
      "GET performs strict per-track expiry even when the service-worker timer has not fired"
    );
  } finally {
    Date.now = ttlRealDateNow;
  }

  const lateVideo = "https://observed.bilivideo.com/upgcxcode/11/22/late-route-30032.m4s?upsig=LATE_VIDEO";
  const lateAudio = "https://observed.bilivideo.com/upgcxcode/11/22/late-route-30280.m4s?upsig=LATE_AUDIO";
  beginBiliTrack("late-route-video", 25, lateVideo, "spa-document");
  beginBiliTrack("late-route-audio", 25, lateAudio, "spa-document");
  const nextSpaUrl = "https://www.bilibili.com/video/av44556/";
  tabFixtures.get(25).url = nextSpaUrl;
  onTabUpdated.listeners[0].fn(25, { url: nextSpaUrl });
  finishBiliTrack("late-route-video", 25, lateVideo, "spa-document");
  finishBiliTrack("late-route-audio", 25, lateAudio, "spa-document");
  for (let attempt = 0; attempt < 10; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 25 })).items,
    [],
    "responses started in the previous SPA generation cannot populate the new page"
  );

  const settingsGate = new Promise((resolve) => { settingsReadEntered = resolve; });
  blockSettingsRead = true;
  const staleDiscovery = sendRuntimeMessage({ type: "SCAN_TAB", tabId: 26 });
  await settingsGate;
  const discoveryNextUrl = "https://www.bilibili.com/video/BV1NewRoute999/";
  tabFixtures.get(26).url = discoveryNextUrl;
  onTabUpdated.listeners[0].fn(26, { url: discoveryNextUrl });
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseSettingsRead();
  assert.equal((await staleDiscovery).ok, true);
  for (let attempt = 0; attempt < 10; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 26 })).items,
    [],
    "a discovery that passed its network identity check cannot commit after its page generation changes"
  );

  const nextObservedUrl = "https://www.bilibili.com/video/av54321/";
  tabFixtures.get(22).url = nextObservedUrl;
  onTabUpdated.listeners[0].fn(22, { url: nextObservedUrl });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 22 })).items, [], "URL-only SPA navigation drops volatile Bilibili URLs and candidates");

  let legacyRestored = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    legacyRestored = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 13 });
    if (legacyRestored.items.length === 1 && legacyRestored.items[0].aliases?.length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(legacyRestored.items.length, 1, "legacy session candidates are re-inspected and regrouped after worker upgrade");
  assert.equal(legacyRestored.items[0].displayUrl, legacyRootUrl);
  assert.deepEqual(new Set(legacyRestored.items[0].aliases.map((item) => item.displayUrl)), new Set([legacyHighUrl, legacyLowUrl]));
  assert.equal(legacyRestored.items[0].contentLength, 0);
  assert.equal(legacyRestored.items[0].manifestSize, 2100);

  const getJobs = async (sender = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel/sidepanel.html` }) => new Promise((resolve) => {
    onMessage.listeners[0].fn({ type: "GET_JOBS" }, sender, resolve);
  });
  const restored = await getJobs();
  assert.equal(restored.ok, true);
  assert.equal(restored.jobs.length, 200, "restored jobs are capped");
  assert.equal(restored.jobs.find((job) => job.jobId === "restore-native")?.status, "failed", "orphaned native jobs fail closed after worker restart");
  assert.equal(restored.jobs.find((job) => job.jobId === "restore-native")?.filename, "restored.mp4");
  assert.equal(restored.jobs.find((job) => job.jobId === "browser:77")?.status, "completed", "restored browser jobs reconcile with downloads.search");
  const restoredSerialized = JSON.stringify(sessionState.jobs);
  assert.doesNotMatch(restoredSerialized, /RESTORE_SECRET|RESTORE_COOKIE|manifestText|headers|\/Users\/private/);

  const untrustedJobs = await getJobs({ id: extensionId, url: "https://example.test/not-extension.html" });
  assert.equal(untrustedJobs.ok, false);
  assert.match(untrustedJobs.error, /来源未通过校验/);

  const contentSender = {
    id: extensionId,
    url: "https://page.example.test/player-frame",
    frameId: 0,
    tab: { id: 9, url: "https://page.example.test/watch", title: "Preview fixture" }
  };
  const pagePreview = await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    tabId: 123,
    data: {
      thumbnailUrl: "https://page.example.test/cover.jpg?token=THUMBNAIL_TOKEN#private-fragment",
      source: "og:image",
      tabId: 123,
      cookie: "PAGE_PREVIEW_COOKIE"
    }
  }, contentSender);
  assert.equal(pagePreview.ok, true);
  assert.equal(pagePreview.accepted, true);
  let mediaWithPreview = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 9 });
  assert.equal(mediaWithPreview.items[0].thumbnailUrl, "https://page.example.test/cover.jpg");
  assert.equal(mediaWithPreview.items[0].thumbnailSource, "og:image");
  assert.equal(mediaWithPreview.items[0].thumbnailFrameId, 0);
  assert.equal(sessionState.tabPreviews[9], undefined, "a query-bearing preview remains memory-only across MV3 suspension");
  assert.deepEqual((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 123 })).items, [], "payload tabId cannot escape sender.tab");
  assert.doesNotMatch(JSON.stringify({ mediaWithPreview, uiMessages, sessionState }), /THUMBNAIL_TOKEN|preview-user|preview-pass|private-fragment|PAGE_PREVIEW_COOKIE/);

  const credentialPreview = await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: { thumbnailUrl: "https://preview-user:preview-pass@page.example.test/credential.jpg", source: "og:image" }
  }, contentSender);
  assert.equal(credentialPreview.ignored, true, "embedded thumbnail credentials fail closed instead of being rewritten");
  const crossOriginPreview = await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: { thumbnailUrl: "https://attacker.example/poster.jpg", source: "og:image" }
  }, contentSender);
  assert.equal(crossOriginPreview.ignored, true, "page metadata cannot make the extension fetch an arbitrary thumbnail origin");

  const posterPreview = await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: {
      thumbnailUrl: "https://page.example.test/poster.jpg#secret",
      source: "poster",
      thumbnailFrameId: 0
    }
  }, { ...contentSender, frameId: 7 });
  assert.equal(posterPreview.ok, true);
  mediaWithPreview = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 9 });
  assert.equal(mediaWithPreview.items[0].thumbnailUrl, "https://page.example.test/poster.jpg");
  assert.equal(mediaWithPreview.items[0].thumbnailSource, "poster", "video poster outranks page metadata");
  assert.equal(mediaWithPreview.items[0].thumbnailFrameId, 7, "frame identity comes from sender, not message data");

  const dashSender = {
    id: extensionId,
    url: "https://page.example.test/dash-frame",
    frameId: 0,
    tab: { id: 11, url: "https://page.example.test/dash", title: "DASH fixture" }
  };
  await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: { url: "https://media.example.test/existing.mpd", mime: "application/dash+xml", source: "dom" }
  }, dashSender);
  await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: { thumbnailUrl: "https://page.example.test/existing-dash.jpg", source: "og:image" }
  }, dashSender);
  const existingDash = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 11 })).items.find((item) => item.kind === "dash");
  assert.equal(existingDash?.thumbnailUrl, "https://page.example.test/existing-dash.jpg", "existing DASH candidates receive later page previews");

  await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: { thumbnailUrl: "https://page.example.test/twitter.jpg", source: "twitter:image" }
  }, contentSender);
  mediaWithPreview = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 9 });
  assert.equal(mediaWithPreview.items[0].thumbnailUrl, "https://page.example.test/poster.jpg", "lower-priority metadata cannot replace poster");

  for (const thumbnailUrl of [
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    `https://images.example.test/${"a".repeat(5000)}`
  ]) {
    const rejected = await sendRuntimeMessage({
      type: "PAGE_PREVIEW",
      data: { thumbnailUrl, source: "poster" }
    }, contentSender);
    assert.equal(rejected.ok, true);
    assert.equal(rejected.ignored, true);
  }
  const forgedPreview = await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: { thumbnailUrl: "https://images.example.test/forged.jpg", source: "poster" }
  }, extensionSender);
  assert.equal(forgedPreview.ok, false);
  assert.match(forgedPreview.error, /来源未通过校验/);

  onHeadersReceived.listeners[0].fn({
    requestId: "preview-hls",
    tabId: 9,
    url: "https://media.example.test/master.m3u8",
    type: "xmlhttprequest",
    responseHeaders: [{ name: "content-type", value: "application/vnd.apple.mpegurl" }]
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  mediaWithPreview = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 9 });
  const futureHls = mediaWithPreview.items.find((item) => item.kind === "hls");
  assert.equal(futureHls?.thumbnailUrl, "https://page.example.test/poster.jpg", "future HLS candidates inherit the tab poster");

  const groupedRootUrl = "https://manifest.example.test/embed/media/77994wpv0p.m3u8";
  const groupedHighUrl = "https://cdn-a.example.test/deliveries/d03df398cd8e29f29e3cc137a2385f72.m3u8";
  const groupedLowUrl = "https://cdn-a.example.test/deliveries/13b7e09a3c12f81326972af8f6cf259a.m3u8";
  const unrelatedUrl = "https://cdn-b.example.test/deliveries/other-video.m3u8";
  manifestFixtures.set(groupedRootUrl, {
    text: [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=5200000,RESOLUTION=1920x1080,CODECS=\"avc1.640028,mp4a.40.2\"",
      groupedHighUrl,
      "#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS=\"avc1.4d401f,mp4a.40.2\"",
      groupedLowUrl
    ].join("\n")
  });
  manifestFixtures.set(groupedHighUrl, {
    text: ["#EXTM3U", "#EXT-X-TARGETDURATION:6", "#EXTINF:6,", "https://segments.example.test/high-01.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  manifestFixtures.set(groupedLowUrl, {
    text: ["#EXTM3U", "#EXT-X-TARGETDURATION:6", "#EXTINF:6,", "https://segments.example.test/low-01.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  manifestFixtures.set(unrelatedUrl, {
    text: [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=854x480",
      "https://cdn-b.example.test/deliveries/other-video-480.m3u8"
    ].join("\n")
  });
  const observeManifest = (requestId, url, filename, contentLength) => onHeadersReceived.listeners[0].fn({
    requestId,
    tabId: 12,
    url,
    type: "xmlhttprequest",
    responseHeaders: [
      { name: "content-type", value: "application/vnd.apple.mpegurl" },
      { name: "content-length", value: String(contentLength) },
      { name: "content-disposition", value: `attachment; filename=\"${filename}\"` }
    ]
  });
  const internalAssetTitle = await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: {
      url: groupedRootUrl,
      mime: "application/vnd.apple.mpegurl",
      source: "dom",
      title: "an_PHRM_PK1_2CM_v04_comp_v01_wm_cr_cc03",
      pageTitle: "Generative Motion Workshop"
    }
  }, {
    id: extensionId,
    url: "https://page.example.test/workshop",
    frameId: 0,
    tab: { id: 12, url: "https://page.example.test/workshop", title: "Generative Motion Workshop" }
  });
  assert.equal(internalAssetTitle.ok, true);
  observeManifest("group-high", groupedHighUrl, "d03df398cd8e29f29e3cc137a2385f72.m3u8", 1700);
  observeManifest("group-low", groupedLowUrl, "13b7e09a3c12f81326972af8f6cf259a.m3u8", 1500);
  observeManifest("group-other", unrelatedUrl, "other-video.m3u8", 1200);
  observeManifest("group-root", groupedRootUrl, "77994wpv0p.m3u8", 2100);

  let groupedResponse = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    groupedResponse = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 12 });
    const root = groupedResponse.items.find((item) => item.displayUrl === groupedRootUrl);
    if (groupedResponse.items.length === 2 && root?.aliases?.length === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(groupedResponse.ok, true);
  assert.equal(groupedResponse.items.length, 2, "only graph-linked manifests merge; another video on the same page remains visible");
  const groupedRoot = groupedResponse.items.find((item) => item.displayUrl === groupedRootUrl);
  assert.ok(groupedRoot, "the parseable master is the group representative");
  assert.equal(groupedRoot.manifestType, "master");
  assert.equal(groupedRoot.manifestVariantCount, 2);
  assert.equal(groupedRoot.groupSize, 3);
  assert.deepEqual(new Set(groupedRoot.aliases.map((item) => item.displayUrl)), new Set([groupedHighUrl, groupedLowUrl]));
  assert.equal(groupedRoot.title, "Generative Motion Workshop", "readable page title replaces delivery hashes");
  assert.equal(groupedRoot.suggestedFilename, "Generative Motion Workshop.mp4", "card title and default download stem agree");
  assert.equal(groupedRoot.contentLength, 0, "playlist response bytes are not presented as media size");
  assert.equal(groupedRoot.manifestSize, 2100, "playlist bytes remain available as explicitly labelled metadata");
  assert.ok(groupedRoot.sourceFilenames.includes("77994wpv0p.m3u8"), "raw source names remain available as aliases");
  assert.equal(badgeUpdates.filter((item) => item.tabId === 12).at(-1)?.text, "2", "badge counts visible representatives only");
  assert.ok(manifestFetches.filter((item) => [groupedRootUrl, groupedHighUrl, groupedLowUrl, unrelatedUrl].includes(item.url)).every((item) => item.credentials === "omit"));

  const groupedProbe = await sendRuntimeMessage({
    type: "PROBE_MANIFEST",
    tabId: 12,
    candidate: { id: groupedRoot.id, kind: "hls", generation: groupedRoot.generation }
  });
  assert.deepEqual(groupedProbe.probe.variants.map((item) => item.height), [1080, 720], "one visible candidate retains the master quality list");
  assert.ok(groupedProbe.probe.variants.every((item) => /\/manifest\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(item.url)),
    "manifest selectors use random opaque candidate and URL tokens");
  const repeatedGroupedProbe = await sendRuntimeMessage({
    type: "PROBE_MANIFEST",
    tabId: 12,
    candidate: { id: groupedRoot.id, kind: "hls", generation: groupedRoot.generation }
  });
  assert.deepEqual(
    repeatedGroupedProbe.probe.variants.map((item) => item.url),
    groupedProbe.probe.variants.map((item) => item.url),
    "repeated probes reuse the selector token for the same private URL"
  );
  const hiddenHigh = groupedRoot.aliases.find((item) => item.displayUrl === groupedHighUrl);
  const staleAliasProbe = await sendRuntimeMessage({
    type: "PROBE_MANIFEST",
    tabId: 12,
    candidate: { id: hiddenHigh.id, kind: "hls", generation: groupedRoot.generation }
  });
  assert.deepEqual(staleAliasProbe.probe.variants.map((item) => item.height), [1080, 720], "stale alias references resolve to the representative safely");

  // Real Wistia request topology: the master references delivery playlists,
  // the browser observes tokenized equivalents (sometimes through a different
  // CDN hostname), and captions are themselves exposed as a tiny .m3u8.
  const wistiaMasterUrl = "https://fast.wistia.com/embed/medias/77994wpv0p.m3u8";
  const wistiaHighId = "d03d231954bffe231a18d61855081090b66d8da2";
  const wistiaLowId = "13b7ae81273bc61a0691de6bfa56425760148d79";
  const wistiaHighReference = `https://embed-cloudfront.wistia.com/deliveries/${wistiaHighId}.m3u8?token=MASTER_HIGH`;
  const wistiaLowReference = `https://embed-cloudfront.wistia.com/deliveries/${wistiaLowId}.m3u8?token=MASTER_LOW`;
  const wistiaHighObserved = `https://media-cloudfront.wistia.net/deliveries/${wistiaHighId}.m3u8?token=OBSERVED_HIGH`;
  const wistiaLowObserved = `https://embed-cloudfront.wistia.com/deliveries/${wistiaLowId}.m3u8?token=OBSERVED_LOW`;
  const wistiaCaptionsUrl = "https://fast.wistia.net/embed/captions/77994wpv0p.m3u8?language=eng";
  const secondMasterUrl = "https://fast.wistia.com/embed/medias/a-second-video.m3u8";
  manifestFixtures.set(wistiaMasterUrl, {
    text: [
      "#EXTM3U",
      `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="eng",URI="${wistiaCaptionsUrl}"`,
      "#EXT-X-STREAM-INF:BANDWIDTH=5200000,AVERAGE_BANDWIDTH=4800000,RESOLUTION=1920x1080,SUBTITLES=\"subs\"",
      wistiaHighReference,
      "#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE_BANDWIDTH=2500000,RESOLUTION=1280x720,SUBTITLES=\"subs\"",
      wistiaLowReference
    ].join("\n")
  });
  manifestFixtures.set(wistiaHighObserved, {
    text: ["#EXTM3U", "#EXTINF:6,", "https://segments.wistia.test/high-1.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  manifestFixtures.set(wistiaLowObserved, {
    text: ["#EXTM3U", "#EXTINF:6,", "https://segments.wistia.test/low-1.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  manifestFixtures.set(wistiaCaptionsUrl, {
    text: ["#EXTM3U", "#EXTINF:185.3,", "https://fast.wistia.net/embed/captions/77994wpv0p.vtt", "#EXT-X-ENDLIST"].join("\n")
  });
  manifestFixtures.set(secondMasterUrl, {
    text: [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360",
      "https://other-cdn.example.test/deliveries/second-video-360.m3u8"
    ].join("\n")
  });
  const wistiaSender = {
    id: extensionId,
    url: "https://onlinelearning.hms.harvard.edu/course-frame",
    frameId: 0,
    tab: {
      id: 14,
      url: "https://onlinelearning.hms.harvard.edu/pharmacokinetics",
      title: "Volume of Distribution Interactive | Pharmacokinetics - Part 1"
    }
  };
  await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: {
      url: wistiaMasterUrl,
      mime: "application/vnd.apple.mpegurl",
      source: "dom",
      title: "an_PHRM_PK1_2CM_v04_comp_v01_wm_cr_cc",
      pageTitle: "Volume of Distribution Interactive | Pharmacokinetics - Part 1"
    }
  }, wistiaSender);
  const observeWistia = (requestId, url) => onHeadersReceived.listeners[0].fn({
    requestId,
    tabId: 14,
    url,
    type: "xmlhttprequest",
    responseHeaders: [
      { name: "content-type", value: "application/vnd.apple.mpegurl" },
      { name: "content-length", value: "1500" }
    ]
  });
  observeWistia("wistia-high", wistiaHighObserved);
  observeWistia("wistia-low", wistiaLowObserved);
  observeWistia("wistia-captions", wistiaCaptionsUrl);
  await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: {
      url: secondMasterUrl,
      mime: "application/vnd.apple.mpegurl",
      source: "dom",
      title: "A genuinely different lesson",
      pageTitle: "Volume of Distribution Interactive | Pharmacokinetics - Part 1"
    }
  }, wistiaSender);

  const preProbeWistia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 14 });
  assert.equal(preProbeWistia.items.some((item) => item.displayUrl === wistiaCaptionsUrl), false, "caption playlists never appear as video candidates");
  const wistiaCandidate = preProbeWistia.items.find((item) => item.displayUrl === wistiaMasterUrl);
  assert.ok(wistiaCandidate, "the master remains the user-facing candidate");
  assert.equal(
    manifestFetches.some((item) => item.url === wistiaMasterUrl),
    false,
    "a DOM hint is displayed but never fetched until the user requests a probe"
  );
  const wistiaProbe = await sendRuntimeMessage({
    type: "PROBE_MANIFEST",
    tabId: 14,
    candidate: { id: wistiaCandidate.id, kind: "hls", generation: wistiaCandidate.generation }
  });
  assert.deepEqual(wistiaProbe.probe.variants.map((item) => item.height), [1080, 720]);
  const afterWistiaProbe = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 14 });
  assert.equal(afterWistiaProbe.items.length, 2, "an explicit master probe folds token/CDN aliases immediately while preserving another video");
  const finalWistia = afterWistiaProbe.items.find((item) => item.displayUrl === wistiaMasterUrl);
  assert.equal(finalWistia.manifestType, "master");
  assert.equal(finalWistia.manifestVariantCount, 2);
  assert.equal(finalWistia.manifestSubtitleTrackCount, 1);
  assert.equal(finalWistia.groupSize, 3);
  assert.deepEqual(
    new Set(finalWistia.aliases.map((item) => item.displayUrl)),
    new Set([wistiaHighObserved, wistiaLowObserved].map((value) => { const url = new URL(value); url.search = ""; return url.href; })),
    "public alias metadata omits signed query parameters"
  );
  assert.equal(finalWistia.title, "Volume of Distribution Interactive | Pharmacokinetics - Part 1");
  assert.equal(finalWistia.suggestedFilename, "Volume of Distribution Interactive _ Pharmacokinetics - Part 1.mp4");
  assert.ok(afterWistiaProbe.items.some((item) => item.displayUrl === secondMasterUrl), "an unrelated video is never merged by page title");

  // Manifest children and redirect destinations cross the same NetworkPolicy
  // boundary as the root URL. A public manifest cannot smuggle a private
  // alternate audio URL or redirect target into the extension/native path.
  const privateChildManifest = "https://security.example.test/private-child.m3u8";
  manifestFixtures.set(privateChildManifest, {
    text: [
      "#EXTM3U",
      "#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID=\"audio\",NAME=\"Local\",URI=\"http://127.0.0.1/private-audio.m3u8?token=CHILD_SECRET\"",
      "#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720,AUDIO=\"audio\"",
      "https://security-cdn.example.test/public-720.m3u8"
    ].join("\n")
  });
  observeWistia("private-child-root", privateChildManifest);
  let privateChildCandidate = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    privateChildCandidate = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 14 })).items.find((item) => item.displayUrl === privateChildManifest);
    if (privateChildCandidate) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const privateChildProbe = await sendRuntimeMessage({ type: "PROBE_MANIFEST", tabId: 14, candidate: privateChildCandidate });
  assert.equal(privateChildProbe.ok, false);
  assert.match(privateChildProbe.error, /blocked_private/);
  assert.doesNotMatch(privateChildProbe.error, /CHILD_SECRET|token/);
  const privateChildDownload = await sendRuntimeMessage({ type: "DOWNLOAD", tabId: 14, candidate: privateChildCandidate, options: {} });
  assert.equal(privateChildDownload.ok, false);
  assert.match(privateChildDownload.error, /blocked_private/);

  const aesManifest = "https://security.example.test/encrypted-vod.m3u8";
  manifestFixtures.set(aesManifest, {
    text: [
      "#EXTM3U",
      "#EXT-X-KEY:METHOD=AES-128,URI=\"https://security-cdn.example.test/key.bin\"",
      "#EXTINF:6,",
      "https://security-cdn.example.test/encrypted-segment.ts",
      "#EXT-X-ENDLIST"
    ].join("\n")
  });
  observeWistia("encrypted-vod-root", aesManifest);
  let aesCandidate = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    aesCandidate = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 14 })).items.find((item) => item.displayUrl === aesManifest);
    if (aesCandidate) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const aesProbe = await sendRuntimeMessage({ type: "PROBE_MANIFEST", tabId: 14, candidate: aesCandidate });
  assert.equal(aesProbe.probe.protection, "aes128");
  const aesDownload = await sendRuntimeMessage({ type: "DOWNLOAD", tabId: 14, candidate: aesCandidate, options: {} });
  assert.equal(aesDownload.ok, false, "AES-128 HLS is metadata-only in 0.2.4");
  assert.match(aesDownload.error, /0\.2\.4.*AES-128/);

  const redirectManifest = "https://security.example.test/private-redirect.m3u8";
  manifestFixtures.set(redirectManifest, {
    finalUrl: "http://127.0.0.1/final.m3u8?token=REDIRECT_SECRET",
    text: ["#EXTM3U", "#EXTINF:6,", "https://security-cdn.example.test/segment.ts", "#EXT-X-ENDLIST"].join("\n")
  });
  observeWistia("private-redirect-root", redirectManifest);
  let redirectCandidate = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    redirectCandidate = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 14 })).items.find((item) => item.displayUrl === redirectManifest);
    if (redirectCandidate) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const redirectProbe = await sendRuntimeMessage({ type: "PROBE_MANIFEST", tabId: 14, candidate: redirectCandidate });
  assert.equal(redirectProbe.ok, false);
  assert.match(redirectProbe.error, /blocked_private/);
  assert.doesNotMatch(redirectProbe.error, /REDIRECT_SECRET|token/);

  const permissionGate = await new Promise((resolve) => {
    onMessage.listeners[0].fn(
      { type: "PING_HOST" },
      { id: extensionId, url: `chrome-extension://${extensionId}/popup/popup.html` },
      resolve
    );
  });
  assert.equal(permissionGate.ok, true);
  assert.equal(permissionGate.hostStatus.needsPermission, true);

  onHeadersReceived.listeners[0].fn({
    requestId: "blocked",
    tabId: 7,
    url: "https://rr1---sn.example.googlevideo.com/videoplayback.mp4",
    type: "media",
    responseHeaders: [
      { name: "content-type", value: "video/mp4" },
      { name: "content-length", value: "2000000" }
    ]
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const blocked = await new Promise((resolve) => {
    onMessage.listeners[0].fn(
      { type: "GET_TAB_MEDIA", tabId: 7 },
      { id: extensionId, url: `chrome-extension://${extensionId}/popup/popup.html` },
      resolve
    );
  });
  assert.equal(blocked.ok, true);
  assert.deepEqual(blocked.items, []);

  const unobservedAccepted = await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: {
      url: "https://redirect.example.test/public-video.mp4",
      mime: "video/mp4",
      contentLength: 2_000_000,
      source: "dom"
    }
  }, {
    id: extensionId,
    url: "https://page.example.test/hint",
    frameId: 0,
    tab: tabFixtures.get(34)
  });
  assert.equal(unobservedAccepted.accepted, true);
  const [unobservedCandidate] = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 34 })).items;
  assert.equal(unobservedCandidate.provenance, "dom_media_element");
  const browserRequestsBeforeHint = browserDownloadRequests.length;
  const unobservedStart = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 34,
    candidate: unobservedCandidate,
    options: { filename: "unobserved.mp4" }
  });
  assert.equal(unobservedStart.ok, false, "an unobserved public URL is routed to the controlled native path");
  assert.match(unobservedStart.error, /授权连接本地引擎/);
  assert.equal(browserDownloadRequests.length, browserRequestsBeforeHint,
    "an unobserved public URL that may redirect never enters chrome.downloads");

  const restoredDirect = (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 9 })).items
    .find((item) => item.displayUrl === "https://media.example.test/movie.mp4");
  assert.match(restoredDirect?.id || "", opaqueIdPattern, "legacy persisted candidate IDs rotate at the trust-boundary upgrade");
  assert.equal(restoredDirect.copyable, true, "an exact queryless direct URL may be copied");
  assert.equal(restoredDirect.urlIsRedacted, false);
  const candidate = { id: restoredDirect.id, kind: restoredDirect.kind, generation: restoredDirect.generation };
  const browserPersistReached = new Promise((resolve) => { browserPersistEntered = resolve; });
  const browserSearchReached = new Promise((resolve) => { browserSearchEntered = resolve; });
  blockBrowserPersist = true;
  blockBrowserSearch = true;
  const browserStartPromise = new Promise((resolve) => {
    onMessage.listeners[0].fn(
      {
        type: "DOWNLOAD",
        tabId: 9,
        candidate: {
          ...candidate,
          displayUrl: "https://attacker.example/forged.mp4",
          url: "https://attacker.example/forged.mp4?token=FORGED_TARGET_SECRET",
          headers: { authorization: "Bearer FORGED_HEADER_SECRET" }
        },
        options: { filename: "browser.mp4" }
      },
      { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel/sidepanel.html` },
      resolve
    );
  });
  await browserPersistReached;
  // Reproduce a tiny-file completion while the initial job snapshot is still
  // being persisted. Tracking must not begin until that job is established.
  onDownloadChanged.listeners[0].fn({
    id: 42,
    state: { current: "complete" },
    bytesReceived: { current: 2_000_000 },
    totalBytes: { current: 2_000_000 },
    filename: { current: "/Users/private/FluxCatch/browser.mp4" }
  });
  releaseBrowserPersist();
  await browserSearchReached;
  assert.equal(
    (await getJobs()).jobs.find((job) => job.jobId === "browser:42")?.status,
    "downloading",
    "terminal events cannot race ahead of browser job registration"
  );
  // The reconciliation request has already started. Let it return an older
  // in_progress snapshot, then synchronously deliver the newer completion
  // event before the search continuation can apply that stale result.
  browserSearchState = "in_progress";
  releaseBrowserSearch();
  onDownloadChanged.listeners[0].fn({
    id: 42,
    state: { current: "complete" },
    bytesReceived: { current: 2_000_000 },
    totalBytes: { current: 2_000_000 },
    filename: { current: "/Users/private/FluxCatch/browser.mp4" }
  });
  const browserStart = await browserStartPromise;
  assert.equal(browserStart.ok, true);
  assert.deepEqual({ method: browserStart.method, downloadId: browserStart.downloadId, jobId: browserStart.jobId }, {
    method: "browser", downloadId: 42, jobId: "browser:42"
  });
  assert.equal(browserDownloadRequests.at(-1)?.url, "https://media.example.test/movie.mp4",
    "UI candidate tampering cannot replace the worker-private download target");
  assert.doesNotMatch(JSON.stringify(browserDownloadRequests), /FORGED_TARGET_SECRET|FORGED_HEADER_SECRET/);
  assert.equal(
    (await getJobs()).jobs.find((job) => job.jobId === "browser:42")?.status,
    "completed",
    "a stale in_progress reconciliation cannot downgrade a completed browser job"
  );

  // Reproduce the real Chrome cancellation ordering: the interrupted event can
  // run before downloads.cancel() resolves. It must become cancelled directly,
  // rather than committing failed and blocking the caller's cancelled update.
  browserDownloadId = 43;
  cancelEmitsInterrupted = true;
  const cancellableStart = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 9,
    candidate,
    options: { filename: "cancel-race.mp4" }
  });
  assert.equal(cancellableStart.ok, true);
  assert.equal(cancellableStart.jobId, "browser:43");
  assert.equal((await getJobs()).jobs.find((job) => job.jobId === "browser:43")?.status, "downloading");
  const cancelledBrowser = await sendRuntimeMessage({ type: "CANCEL_JOB", jobId: cancellableStart.jobId });
  assert.equal(cancelledBrowser.ok, true);
  assert.deepEqual(cancelledDownloads, [43]);
  assert.equal(
    (await getJobs()).jobs.find((job) => job.jobId === "browser:43")?.status,
    "cancelled",
    "an interrupted event emitted inside downloads.cancel() is a cancellation, not a failure"
  );
  assert.equal(
    (await getJobs()).jobs.find((job) => job.jobId === "browser:43")?.filename,
    "cancel-race.mp4",
    "a transient URL-derived browser basename cannot replace the requested task filename"
  );
  cancelEmitsInterrupted = false;

  browserDownloadId = 44;
  cancelRejects = true;
  const rejectedCancelStart = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 9,
    candidate,
    options: { filename: "cancel-rejected.mp4" }
  });
  const rejectedCancel = await sendRuntimeMessage({ type: "CANCEL_JOB", jobId: rejectedCancelStart.jobId });
  assert.equal(rejectedCancel.ok, false);
  assert.match(rejectedCancel.error, /cancellation rejected/);
  assert.equal((await getJobs()).jobs.find((job) => job.jobId === "browser:44")?.status, "downloading");
  cancelRejects = false;
  onDownloadChanged.listeners[0].fn({ id: 44, state: { current: "interrupted" } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    (await getJobs()).jobs.find((job) => job.jobId === "browser:44")?.status,
    "failed",
    "a rejected cancellation clears its intent marker before a later interruption"
  );

  const trustedSender = { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel/sidepanel.html` };
  nativePermission = true;
  globalThis.chrome.runtime.connectNative = undefined;
  const unavailableNativeApi = await sendRuntimeMessage({ type: "PING_HOST" }, trustedSender);
  assert.equal(unavailableNativeApi.ok, true, "PING_HOST reports an unavailable Chrome API as status instead of a raw exception");
  assert.equal(unavailableNativeApi.hostStatus.connected, false);
  assert.equal(unavailableNativeApi.hostStatus.needsPermission, false);
  assert.equal(unavailableNativeApi.hostStatus.failureReason, "api_unavailable");
  assert.match(unavailableNativeApi.hostStatus.lastError, /自动重试/);
  assert.match(unavailableNativeApi.hostStatus.lastError, /重新加载 FluxCatch/);
  assert.doesNotMatch(JSON.stringify(unavailableNativeApi), /TypeError|connectNative is not a function/i);
  assert.equal(nativeConnectCalls, 0, "an absent nativeMessaging API never attempts a native connection");

  const recovery = await sendRuntimeMessage({ type: "RECOVER_NATIVE_API" }, trustedSender);
  assert.equal(recovery.ok, true);
  assert.equal(recovery.retryAfterMs, 35_000, "the UI receives the measured idle wait without reloading the extension");
  assert.equal(recovery.recoveryBlocked, false);
  assert.equal(settingsState.nativeApiRecovery?.phase, "waiting");
  assert.equal(settingsState.nativeApiRecovery.retryAt - settingsState.nativeApiRecovery.requestedAt, 35_000);

  globalThis.chrome.runtime.connectNative = undefined;
  const restoreNativeBinding = setTimeout(() => {
    globalThis.chrome.runtime.connectNative = nativeConnectFixture;
  }, 75);
  const pingResponses = await Promise.all([1, 2].map(() => new Promise((resolve) => {
    onMessage.listeners[0].fn({ type: "PING_HOST" }, trustedSender, resolve);
  })));
  clearTimeout(restoreNativeBinding);
  assert.equal(nativeConnectCalls, 1, "concurrent PING_HOST requests share one native connection");
  assert.equal(globalThis.chrome.runtime.connectNative, nativeConnectFixture, "a delayed native API binding becomes usable without a second user action");
  assert.ok(pingResponses.every((response) => response.ok && response.hostStatus.connected), "PING_HOST waits for pong before reporting status");
  assert.ok(pingResponses.every((response) => response.hostStatus.capabilities?.ffmpeg?.available));
  assert.ok(pingResponses.every((response) => response.hostStatus.capabilities?.ytdlp?.networkDisabled === false),
    "only an explicit networkDisabled=false capability opens the future adapter gate");
  assert.ok(pingResponses.every((response) => response.hostStatus.compatible === true));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settingsState.nativeApiRecovery, undefined, "a successful native pong clears recovery state");
  const diagnosticsResponse = await sendRuntimeMessage({ type: "GET_DIAGNOSTICS" });
  assert.equal(diagnosticsResponse.diagnostics.extension.version, "0.2.4");
  assert.equal(diagnosticsResponse.diagnostics.extension.id, extensionId);
  assert.equal(diagnosticsResponse.diagnostics.native.compatible, true);
  assert.doesNotMatch(JSON.stringify(diagnosticsResponse),
    /HOST_TOP_PATH|FFMPEG_PATH|FFMPEG_PROBE_SECRET|YTDLP_PATH|YTDLP_PROBE_SECRET|https?:\/\//,
    "copied diagnostics expose no paths, probe details or URLs");
  assert.doesNotMatch(JSON.stringify({ pingResponses, uiMessages }),
    /HOST_TOP_PATH|FFMPEG_PATH|FFMPEG_PROBE_SECRET|FFMPEG_FUTURE_SECRET|YTDLP_PATH|YTDLP_PROBE_SECRET|HOST_CAPABILITY_FUTURE|HOST_PONG_FUTURE/,
    "native status and pong broadcasts pass through an explicit public allowlist");
  assert.ok(uiMessages.filter((message) => message.type === "HOST_EVENT")
    .every((message) => JSON.stringify(Object.keys(message.event || {}).sort()) === JSON.stringify(["type"])),
  "native task payloads never ride the HOST_EVENT compatibility channel");

  nativeOnMessage.listeners[0].fn({
    type: "pong",
    requestId: "mismatch-audit",
    version: "0.2.3",
    protocolVersion: 1,
    capabilityProfileVersion: 1,
    ffmpeg: true,
    capabilities: { ffmpeg: { available: true } }
  });
  const mismatchStatus = await sendRuntimeMessage({ type: "GET_JOBS" });
  assert.equal(mismatchStatus.hostStatus.connected, true);
  assert.equal(mismatchStatus.hostStatus.compatible, false);
  const mismatchDownload = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 9,
    candidate,
    options: { filename: "mismatch.mp4", useNativeForDirect: true }
  });
  assert.equal(mismatchDownload.ok, false);
  assert.match(mismatchDownload.error, /版本不匹配/);
  nativeOnMessage.listeners[0].fn({
    type: "pong",
    requestId: "compatible-reset",
    version: "0.2.4",
    protocolVersion: 1,
    capabilityProfileVersion: 1,
    ffmpeg: true,
    capabilities: {
      ffmpeg: { available: true, version: "8.1", demuxers: { hls: true, dash: false }, encoders: { libmp3lame: true } },
      ytdlp: { available: true, networkDisabled: false },
      dashPlanner: "static-v1",
      dashPair: "direct-v1"
    }
  });

  const biliStart = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 21,
    candidate: biliApiCandidate,
    options: {
      filename: "Bilibili Fixture.mp4",
      variantUrl: biliApiProbe.probe.variants.find((track) => track.height === 360).url
    }
  });
  assert.equal(biliStart.ok, true);
  assert.equal(biliStart.method, "native");
  const biliNativeMessage = nativeOutgoing.find((message) => message.type === "download" && message.jobId === biliStart.jobId);
  assert.equal(biliNativeMessage.mediaKind, "dash_pair");
  assert.equal(biliNativeMessage.url, biliVideo360, "opaque selector resolves to the chosen private video track");
  assert.equal(biliNativeMessage.options.audioUrl, biliAudioAac, "AAC is preferred over higher-bandwidth FLAC for MP4 compatibility");
  assert.equal(biliNativeMessage.options.expectedDuration, 185);
  assert.equal(biliNativeMessage.options.expiresAt, biliApiCandidate.expiresAt, "native queue receives the private pair deadline for final validation");
  assert.equal(biliNativeMessage.headers.referer, "https://www.bilibili.com/");
  assert.equal(biliNativeMessage.options.audioHeaders.referer, "https://www.bilibili.com/");
  assert.doesNotMatch(JSON.stringify({ headers: biliNativeMessage.headers, audioHeaders: biliNativeMessage.options.audioHeaders }), /cookie|authorization|SESSDATA|Bearer|vd_source/i);
  assert.doesNotMatch(JSON.stringify(sessionState.tabMedia), biliSecrets, "starting a native pair does not persist signed URLs");
  assert.equal((await getJobs()).jobs.find((job) => job.jobId === biliStart.jobId)?.kind, "dash_pair");
  nativeOnMessage.listeners[0].fn({
    type: "complete",
    jobId: biliStart.jobId,
    filename: "/Users/private/Bilibili Fixture.mp4",
    path: "/Users/private/COMPLETE_PATH_SECRET",
    status: "completed",
    progress: 1,
    size: 5_800_000,
    future: "COMPLETE_FUTURE_SECRET"
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.doesNotMatch(JSON.stringify(uiMessages), /COMPLETE_PATH_SECRET|COMPLETE_FUTURE_SECRET|\/Users\/private/,
    "native completion paths and future fields never reach popup or side panel ports");

  // ===== Default-on enrichment still requires a trusted Bilibili media
  // request. Page completion stays passive; playback/preload starts one
  // cooldown-limited fixed-site attempt and completes the badge. =====
  const badgeCountFor = (tabId) => badgeUpdates.filter((item) => item.tabId === tabId).length;
  const badgeBefore = badgeCountFor(29);
  const metadataFetchesBefore = manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length;
  onTabUpdated.listeners[0].fn(29, { status: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(badgeCountFor(29), badgeBefore, "page completion alone does not synthesize an enriched candidate");
  assert.equal(
    manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length,
    metadataFetchesBefore,
    "default-on enrichment waits for a trusted media request"
  );
  automaticBiliFetchDelayMs = 1_500;
  const automaticBadgeStartedAt = Date.now();
  observeBiliTrack("auto-badge-playback", 29, biliAvVideo, "auto-badge-document");
  for (let attempt = 0; attempt < 650; attempt += 1) {
    const badge = badgeUpdates.filter((item) => item.tabId === 29).at(-1);
    const fetchedPlayback = manifestFetches.some((item) => item.url.includes("playurl?avid=99999"));
    if (badge?.text === "1" && fetchedPlayback) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(Date.now() - automaticBadgeStartedAt <= 3_000, "the delayed Bilibili metadata fixture still paints its badge within three seconds");
  assert.ok(
    !manifestFetches.some((item) => item.url.includes("pagelist?avid=99999"))
      && manifestFetches.some((item) => item.url.includes("playurl?avid=99999&cid=88001")),
    "a trusted Bilibili media request derives its cid locally and uses one fixed playback metadata request"
  );
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 29).at(-1)?.text,
    "1",
    "an observed Bilibili media request publishes the badge without opening popup or reading tab media"
  );
  const playbackBadgeUpdatesBeforeRead = badgeCountFor(29);
  const autoBadgeMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 29 });
  assert.equal(autoBadgeMedia.items.length, 1);
  assert.equal(autoBadgeMedia.items[0].kind, "dash_pair");
  assert.equal(autoBadgeMedia.items[0].height, 1080, "logged-in av discovery carries the full quality ladder fixture");
  assert.equal(
    badgeCountFor(29),
    playbackBadgeUpdatesBeforeRead,
    "GET_TAB_MEDIA does not drive or repaint an already published Bilibili badge"
  );

  const opaqueBiliVideo = "https://upos-sz-mirror08c.bilivideo.cn/upgcxcode/77/88/shared-tail-30080.m4s?deadline=1999999999&upsig=OPAQUE_VIDEO_SECRET";
  automaticBiliPageListDelayMs = 800;
  automaticBiliFetchDelayMs = 800;
  const fallbackBadgeStartedAt = Date.now();
  observeBiliTrack("auto-badge-fallback-budget", 37, opaqueBiliVideo, "auto-badge-fallback-document");
  for (let attempt = 0; attempt < 650; attempt += 1) {
    if (badgeUpdates.filter((item) => item.tabId === 37).at(-1)?.text === "1") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(badgeUpdates.filter((item) => item.tabId === 37).at(-1)?.text, "1");
  assert.ok(Date.now() - fallbackBadgeStartedAt <= 3_000,
    "the accepted Bilibili URL without an embedded cid shares one metadata deadline and paints within three seconds");
  assert.ok(manifestFetches.some((item) => item.url.includes("pagelist?avid=99999")),
    "the fallback-budget fixture exercised pagelist instead of the direct-cid fast path");

  const staleAutomaticFetchesBefore = manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length;
  const automaticTabGate = new Promise((resolve) => { automaticTabReadEntered = resolve; });
  blockAutomaticTabRead = true;
  beginBiliTrack("stale-automatic-request", 36, biliAvVideo, "stale-automatic-document");
  await automaticTabGate;
  const automaticNextUrl = "https://www.bilibili.com/video/av24681/";
  tabFixtures.get(36).url = automaticNextUrl;
  onTabUpdated.listeners[0].fn(36, { url: automaticNextUrl });
  releaseAutomaticTabRead();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length,
    staleAutomaticFetchesBefore,
    "a trusted request from the prior SPA generation cannot trigger metadata discovery for the next page"
  );

  const failedPlaybackUrl = "https://api.bilibili.com/x/player/playurl?avid=13579&cid=88001&qn=127&fnval=16&fourk=1";
  const failedFetchCount = () => manifestFetches.filter((item) => item.url === failedPlaybackUrl).length;
  const failedFetchesBefore = failedFetchCount();
  beginBiliTrack("failed-auto-discovery-1", 35, biliAvVideo, "failed-auto-document");
  for (let attempt = 0; attempt < 50 && failedFetchCount() === failedFetchesBefore; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(failedFetchCount(), failedFetchesBefore + 1, "the first trusted media request attempts fixed-endpoint discovery");
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 2; index <= 5; index += 1) {
    beginBiliTrack(`failed-auto-discovery-${index}`, 35, biliAvVideo, "failed-auto-document");
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(
    failedFetchCount(),
    failedFetchesBefore + 1,
    "failed automatic discovery is cooldown-limited instead of retrying for every media Range request"
  );

  const automaticRetryRealDateNow = Date.now;
  const retryAt = automaticRetryRealDateNow() + 5_001;
  Date.now = () => retryAt;
  try {
    beginBiliTrack("failed-auto-after-short-backoff", 35, biliAvVideo, "failed-auto-document");
    for (let attempt = 0; attempt < 50 && failedFetchCount() < failedFetchesBefore + 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  } finally {
    Date.now = automaticRetryRealDateNow;
  }
  assert.equal(failedFetchCount(), failedFetchesBefore + 2, "failed automatic discovery retries after its short backoff");

  const failedPageListUrl = "https://api.bilibili.com/x/player/pagelist?avid=13579";
  const failedPageListFetchesBefore = manifestFetches.filter((item) => item.url === failedPageListUrl).length;
  const forcedRetry = await sendRuntimeMessage({ type: "SCAN_TAB", tabId: 35 });
  assert.equal(forcedRetry.ok, true);
  assert.equal(
    manifestFetches.filter((item) => item.url === failedPageListUrl).length,
    failedPageListFetchesBefore + 1,
    "an explicit rescan bypasses automatic backoff and runs its complete fixed-endpoint path"
  );

  onTabUpdated.listeners[0].fn(35, { status: "loading" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  beginBiliTrack("failed-auto-after-navigation", 35, biliAvVideo, "failed-auto-document-next");
  for (let attempt = 0; attempt < 50 && failedFetchCount() < failedFetchesBefore + 3; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.equal(
    failedFetchCount(),
    failedFetchesBefore + 3,
    "navigation clears the per-page automatic attempt cooldown"
  );

  assert.equal((await sendRuntimeMessage({ type: "GET_SETTINGS" })).settings.autoEnrichSiteQuality, true);

  const disabledEnrichment = await sendRuntimeMessage({
    type: "SAVE_SETTINGS",
    settings: { autoEnrichSiteQuality: false }
  });
  assert.equal(disabledEnrichment.settings.autoEnrichSiteQuality, false);
  const disabledFetchesBefore = manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length;
  onTabUpdated.listeners[0].fn(38, { status: "complete" });
  observeBiliTrack("disabled-auto-enrichment", 38, biliAvVideo, "disabled-auto-document");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(
    manifestFetches.filter((item) => item.url.startsWith("https://api.bilibili.com/")).length,
    disabledFetchesBefore,
    "turning automatic enrichment off blocks both page-completion and trusted-playback API requests"
  );
  assert.deepEqual(
    (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 38 })).items,
    [],
    "one observed track cannot synthesize a quality candidate while automatic enrichment is off"
  );

  const manualFetchesBefore = manifestFetches.filter((item) => item.url.includes("pagelist?avid=424242")).length;
  const manualWhileDisabled = await sendRuntimeMessage({ type: "SCAN_TAB", tabId: 38 });
  assert.equal(manualWhileDisabled.ok, true);
  assert.equal(
    manifestFetches.filter((item) => item.url.includes("pagelist?avid=424242")).length,
    manualFetchesBefore + 1,
    "an explicit rescan remains available while automatic enrichment is off"
  );

  const enrichSave = await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: { autoEnrichSiteQuality: true } });
  assert.equal(enrichSave.settings.autoEnrichSiteQuality, true);
  const enabledFetchesBefore = manifestFetches.filter((item) => item.url.includes("playurl?avid=424242")).length;
  observeBiliTrack("enabled-auto-enrichment", 32, biliAvVideo, "enabled-auto-document");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const enabledFetches = manifestFetches.filter((item) => item.url.includes("playurl?avid=424242")).length;
    if (enabledFetches > enabledFetchesBefore) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(
    manifestFetches.filter((item) => item.url.includes("playurl?avid=424242")).length,
    enabledFetchesBefore + 1,
    "turning automatic enrichment on lets a trusted playback/preload signal use the fixed endpoint"
  );
  const optedInMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 32 });
  assert.equal(optedInMedia.items[0]?.kind, "dash_pair");
  await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: {} });
  const activatedBefore = badgeCountFor(29);
  onTabActivated.listeners[0].fn({ tabId: 29 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(badgeCountFor(29) > activatedBefore, "tab activation re-applies the badge from current media state");
  onTabActivated.listeners[0].fn({ tabId: 28 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 28).at(-1)?.text,
    "",
    "activating a tab without media explicitly clears its per-tab badge"
  );

  // ===== YouTube experimental adapter source remains present, but every
  // setting/candidate/download gate is hard-closed in the 0.2.4 build. =====
  const youtubeDefaultOff = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 28 });
  assert.deepEqual(youtubeDefaultOff.items, [], "YouTube stays invisible while the experimental toggle is off");
  assert.equal((await sendRuntimeMessage({ type: "GET_SETTINGS" })).settings.youtubeEnabled, false);
  const youtubeSave = await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: { youtubeEnabled: true } });
  assert.equal(youtubeSave.settings.youtubeEnabled, false,
    "even an explicitly network-enabled host cannot open the 0.2.4 build gate");
  onTabUpdated.listeners[0].fn(28, { status: "complete" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 28 })).items, [],
    "the build gate publishes no YouTube candidate");
  assert.notEqual(badgeUpdates.filter((item) => item.tabId === 28).at(-1)?.text, "1",
    "the closed adapter never increments the badge");
  nativeOnMessage.listeners[0].fn({
    type: "pong",
    requestId: "network-disabled-audit",
    version: "0.2.4",
    protocolVersion: 1,
    capabilityProfileVersion: 1,
    ffmpeg: true,
    capabilities: {
      ffmpeg: { available: true, networkInput: false, version: "8.1" },
      ytdlp: { available: false, networkDisabled: true }
    }
  });
  const networkDisabledYoutube = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 28 });
  assert.deepEqual(networkDisabledYoutube.items, [], "network-disabled external engines withdraw stale YouTube candidates");
  assert.equal(networkDisabledYoutube.hostStatus.capabilities.ytdlp.networkDisabled, true);
  nativeOnMessage.listeners[0].fn({
    type: "pong",
    requestId: "network-enabled-fixture-reset",
    version: "0.2.4",
    protocolVersion: 1,
    capabilityProfileVersion: 1,
    ffmpeg: true,
    capabilities: { ytdlp: { available: true, networkDisabled: false, version: "2026.08" } }
  });
  const stillClosed = await sendRuntimeMessage({ type: "SAVE_SETTINGS", settings: { youtubeEnabled: true } });
  assert.equal(stillClosed.settings.youtubeEnabled, false,
    "an explicit false networkDisabled capability still cannot bypass the version gate");
  assert.deepEqual(
    (await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 28 })).items,
    [],
    "the candidate gate remains closed after a forged open capability"
  );
  assert.notEqual(badgeUpdates.filter((item) => item.tabId === 28).at(-1)?.text, "1", "the closed adapter never leaves a media badge");

  // ===== Instagram / X adapters reuse the generic pipeline; private media
  // downloads replay the cookie the page itself sent to the same CDN URL. =====
  const beginInstagramMedia = (requestId, url) => {
    onBeforeSendHeaders.listeners[0].fn({
      requestId, tabId: 30, url, type: "media", documentId: "ig-document", frameId: 0,
      initiator: "https://www.instagram.com",
      requestHeaders: [
        { name: "Cookie", value: "sessionid=IG_PRIVATE_COOKIE" },
        { name: "Referer", value: "https://www.instagram.com/reel/Cxyz1234567/" },
        { name: "User-Agent", value: "FluxCatch fixture UA" }
      ]
    });
  };
  const finishInstagramMedia = (requestId, url) => {
    onHeadersReceived.listeners[0].fn({
      requestId, tabId: 30, url, type: "media", documentId: "ig-document", frameId: 0,
      responseHeaders: [
        { name: "content-type", value: "video/mp4" },
        { name: "content-length", value: "4200000" },
        { name: "accept-ranges", value: "bytes" }
      ]
    });
  };
  beginInstagramMedia("ig-media-1", instagramCdnUrl);
  finishInstagramMedia("ig-media-1", instagramCdnUrl);
  let instagramMedia = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    instagramMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 30 });
    if (instagramMedia.items.length) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(instagramMedia.items.length, 1, "Instagram CDN media becomes a candidate through the generic webRequest path");
  assert.equal(instagramMedia.items[0].site, "instagram", "the site adapter registry labels the candidate");
  const instagramStart = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 30,
    candidate: instagramMedia.items[0],
    options: { filename: "Instagram Reel.mp4", useNativeForDirect: true }
  });
  assert.equal(instagramStart.ok, true);
  const instagramNativeMessage = nativeOutgoing.find((message) => message.type === "download" && message.jobId === instagramStart.jobId);
  assert.equal(instagramNativeMessage.headers.cookie, "sessionid=IG_PRIVATE_COOKIE", "the page cookie is replayed to the exact CDN URL that received it");

  const xPayload = await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: { url: twitterCdnUrl, mime: "video/mp4", source: "site-payload", width: 1280, height: 720, title: "X Fixture" }
  }, {
    id: extensionId,
    url: "https://x.com/fluxcatch/status/1899999999999999999",
    frameId: 0,
    tab: { id: 31, url: "https://x.com/fluxcatch/status/1899999999999999999", title: "X Fixture" }
  });
  assert.equal(xPayload.accepted, true);
  let xMedia = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    xMedia = await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 31 });
    if (xMedia.items.length) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(xMedia.items.length, 1, "extracted X payload media flows through the content-script pipeline");
  assert.equal(xMedia.items[0].site, "twitter");
  assert.equal(xMedia.items[0].height, 720);

  const nativeStart = await new Promise((resolve) => {
    onMessage.listeners[0].fn(
      { type: "DOWNLOAD", tabId: 9, candidate, options: { filename: "native.mp4", useNativeForDirect: true } },
      trustedSender,
      resolve
    );
  });
  assert.equal(nativeStart.ok, true);
  assert.equal(nativeStart.method, "native");
  assert.ok(nativeOutgoing.some((message) => message.type === "download" && message.jobId === nativeStart.jobId));
  nativeOnMessage.listeners[0].fn({
    type: "progress",
    jobId: nativeStart.jobId,
    filename: "native.mp4",
    status: "downloading",
    progress: 0.5,
    speed: 1024,
    bytes: 1000,
    total: 2000,
    message: "读取 https://user:pass@media.example.test/video?token=TOP_SECRET Cookie=SESSION_SECRET；FFmpeg /Users/Alice Smith/Secret Folder/ffmpeg；临时文件 /private/var/folders/secret/input.ts",
    headers: { authorization: "Bearer TOP_SECRET" },
    manifestText: "#EXTM3U TOP_SECRET"
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const nativeRunning = (await getJobs()).jobs.find((job) => job.jobId === nativeStart.jobId);
  assert.equal(nativeRunning.status, "downloading");
  assert.equal(nativeRunning.progress, 0.5);
  assert.equal(nativeRunning.speed, 1024);
  assert.doesNotMatch(JSON.stringify(nativeRunning), /TOP_SECRET|SESSION_SECRET|headers|manifestText|Alice|Secret Folder|\/private\/var/);
  assert.doesNotMatch(JSON.stringify(sessionState.jobs), /TOP_SECRET|SESSION_SECRET|headers|manifestText|\/Users\/private|Alice|Secret Folder|\/private\/var/);

  nativeOnMessage.listeners[0].fn({
    type: "complete",
    jobId: nativeStart.jobId,
    filename: "native.mp4",
    status: "completed",
    progress: 1,
    size: 2000
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await getJobs()).jobs.find((job) => job.jobId === nativeStart.jobId)?.status, "completed");

  const cleared = await new Promise((resolve) => {
    onMessage.listeners[0].fn(
      { type: "CLEAR_COMPLETED_JOBS" },
      { id: extensionId, url: `chrome-extension://${extensionId}/sidepanel/sidepanel.html` },
      resolve
    );
  });
  assert.equal(cleared.ok, true);
  assert.ok(cleared.removed > 0);
  assert.equal(cleared.jobs.some((job) => ["completed", "failed", "cancelled"].includes(job.status)), false);
  assert.equal(cleared.jobs.some((job) => job.jobId === "restore-native"), false, "ended failures are cleared with saved and cancelled jobs");

  const activeDuringClear = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 9,
    candidate,
    options: { filename: "still-running.mp4", useNativeForDirect: true }
  });
  const failedBeforeClear = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 9,
    candidate,
    options: { filename: "already-failed.mp4", useNativeForDirect: true }
  });
  nativeOnMessage.listeners[0].fn({
    type: "failed",
    jobId: failedBeforeClear.jobId,
    filename: "already-failed.mp4",
    status: "failed",
    error: "fixture failure"
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const clearTabAndHistory = await sendRuntimeMessage({ type: "CLEAR_TAB", tabId: 9 });
  assert.equal(clearTabAndHistory.ok, true);
  assert.equal(clearTabAndHistory.removedJobs, 1, "clearing detections also removes ended task rows");
  assert.equal(clearTabAndHistory.jobs.some((job) => job.jobId === failedBeforeClear.jobId), false);
  assert.equal(clearTabAndHistory.jobs.some((job) => job.jobId === activeDuringClear.jobId), true, "clearing detections never cancels an active download");
  const staleGeneration = await sendRuntimeMessage({
    type: "DOWNLOAD",
    tabId: 9,
    candidate,
    options: { filename: "stale.mp4" }
  });
  assert.equal(staleGeneration.ok, false, "a reference from the previous tab generation is rejected");
  assert.match(staleGeneration.error, /已失效/);

  nativeOnMessage.listeners[0].fn({
    type: "complete",
    jobId: activeDuringClear.jobId,
    filename: "still-running.mp4",
    status: "completed",
    progress: 1,
    size: 2000
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal((await getJobs()).jobs.find((job) => job.jobId === activeDuringClear.jobId)?.status, "completed");

  const popupDisconnect = event();
  const badgeEventsBeforePopupLifecycle = badgeCountFor(29);
  onConnect.listeners[0].fn({
    name: "fluxcatch-popup",
    sender: { id: extensionId, url: `chrome-extension://${extensionId}/popup/popup.html` },
    onDisconnect: popupDisconnect,
    postMessage() {}
  });
  assert.equal(popupDisconnect.listeners.length, 1);
  popupDisconnect.listeners[0].fn();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await getJobs()).jobs.some((job) => job.jobId === activeDuringClear.jobId)) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal((await getJobs()).jobs.some((job) => job.jobId === activeDuringClear.jobId), false, "closing the last popup clears ended task history");
  assert.equal(
    badgeCountFor(29),
    badgeEventsBeforePopupLifecycle,
    "opening and closing the popup does not drive or repaint media badges"
  );

  const closingSender = {
    id: extensionId,
    url: "https://page.example.test/closing-frame",
    frameId: 0,
    tab: { id: 10, url: "https://page.example.test/closing", title: "Closing fixture" }
  };
  await sendRuntimeMessage({
    type: "PAGE_PREVIEW",
    data: { thumbnailUrl: "https://page.example.test/closing.jpg", source: "poster" }
  }, closingSender);
  await sendRuntimeMessage({
    type: "CONTENT_MEDIA",
    data: { url: "https://media.example.test/closing.mpd", mime: "application/dash+xml", source: "dom" }
  }, closingSender);
  assert.equal((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 10 })).items[0]?.thumbnailUrl, "https://page.example.test/closing.jpg");
  onTabRemoved.listeners[0].fn(10);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 10 })).items, [], "closing a tab clears media and preview state");

  onTabUpdated.listeners[0].fn(9, { status: "loading" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual((await sendRuntimeMessage({ type: "GET_TAB_MEDIA", tabId: 9 })).items, [], "navigation clears media and preview state");
  assert.equal(
    badgeUpdates.filter((item) => item.tabId === 9).at(-1)?.text,
    "",
    "refresh/navigation clears the prior page badge"
  );

  settingsState.nativeApiRecovery = {
    phase: "resumed",
    requestedAt: Date.now(),
    retryAt: Date.now(),
    expiresAt: Date.now() + 60_000
  };
  nativePermission = false;
  onPermissionsRemoved.listeners[0].fn({ permissions: ["nativeMessaging"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(nativePortDisconnects >= 1, "removing nativeMessaging immediately closes the live native port");
  assert.equal(settingsState.nativeApiRecovery, undefined, "permission removal clears recovery state");
  const permissionRemovedStatus = await sendRuntimeMessage({ type: "PING_HOST" }, trustedSender);
  assert.equal(permissionRemovedStatus.hostStatus.needsPermission, true);
  nativePermission = true;

  globalThis.chrome.runtime.connectNative = () => {
    nativeConnectCalls += 1;
    const missingOnMessage = event();
    const missingOnDisconnect = event();
    return {
      onMessage: missingOnMessage,
      onDisconnect: missingOnDisconnect,
      disconnect() {},
      postMessage() {
        queueMicrotask(() => {
          globalThis.chrome.runtime.lastError = { message: "Specified native messaging host not found." };
          missingOnDisconnect.listeners[0]?.fn();
          globalThis.chrome.runtime.lastError = null;
        });
      }
    };
  };
  const missingNativeHost = await sendRuntimeMessage({ type: "PING_HOST" }, trustedSender);
  assert.equal(missingNativeHost.ok, true, "a missing native host is returned as a stable status result");
  assert.equal(missingNativeHost.hostStatus.connected, false);
  assert.equal(missingNativeHost.hostStatus.needsPermission, false);
  assert.equal(missingNativeHost.hostStatus.failureReason, "host_missing",
    "the async disconnect path preserves host_missing through both error handlers");
  assert.match(missingNativeHost.hostStatus.lastError, /native-host\/install-macos\.sh/);
  assert.doesNotMatch(JSON.stringify(missingNativeHost), /Specified native messaging host not found|TypeError/i);

  const requestedAt = Date.now() - 40_000;
  settingsState.nativeApiRecovery = {
    phase: "waiting",
    requestedAt,
    retryAt: requestedAt + 35_000,
    expiresAt: requestedAt + 120_000
  };
  globalThis.chrome.runtime.connectNative = undefined;
  const listenersBeforeRestart = onMessage.listeners.length;
  await import(`../extension/background.js?native-recovery=${Date.now()}`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(settingsState.nativeApiRecovery?.phase, "resumed", "a fresh worker consumes an overdue wait marker");
  const biliBadgeUpdatesBeforeRestartActivation = badgeCountFor(29);
  onTabActivated.listeners[1].fn({ tabId: 29 });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (badgeCountFor(29) > biliBadgeUpdatesBeforeRestartActivation) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.ok(badgeCountFor(29) > biliBadgeUpdatesBeforeRestartActivation,
    "the restarted worker reapplies the badge from its restored media state");
  assert.equal(badgeUpdates.filter((item) => item.tabId === 29).at(-1)?.text, "",
    "a volatile Bilibili pair is cleared after restart instead of leaving a badge with no downloadable candidate");
  const restartedListener = onMessage.listeners[listenersBeforeRestart].fn;
  const restartedResponse = await new Promise((resolve) => {
    restartedListener({ type: "RECOVER_NATIVE_API" }, trustedSender, resolve);
  });
  assert.equal(restartedResponse.recoveryBlocked, true, "a fresh worker with no API binding blocks another automatic retry");
  assert.equal(restartedResponse.retryAfterMs, 0);

  delete settingsState.nativeApiRecovery;
  nativePermission = true;
  revokeNativePermissionAfterRecoveryWrite = true;
  const racedPermissionRemoval = await sendRuntimeMessage({ type: "RECOVER_NATIVE_API" }, trustedSender);
  assert.equal(racedPermissionRemoval.hostStatus.needsPermission, true, "a permission removal interleaved with marker storage wins the race");
  assert.equal(racedPermissionRemoval.retryAfterMs, 0);
  assert.equal(settingsState.nativeApiRecovery, undefined, "the interleaved recovery marker is cleared instead of blocking the next grant");
  nativePermission = true;
  globalThis.chrome.runtime.connectNative = nativeConnectFixture;
});

test("content script discovers page preview metadata while rejecting credentials and fragments", async () => {
  const source = await readFile(new URL("../extension/content/content.js", import.meta.url), "utf8");
  for (const marker of [
    "video[poster]",
    "og:image:secure_url",
    "og:image",
    "twitter:image",
    "thumbnailUrl",
    "image_src"
  ]) assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(source, /type:\s*"PAGE_PREVIEW"/);
  assert.match(source, /if \(url\.username \|\| url\.password\) return null/);
  assert.doesNotMatch(source, /url\.(?:username|password)\s*=\s*""/);
  assert.match(source, /url\.hash\s*=\s*""/);
  assert.match(source, /MAX_PREVIEW_URL_LENGTH\s*=\s*4096/);
  assert.doesNotMatch(source, /\bcookie\b/i);
});

test("native recovery and shared connections retain fail-closed guards", async () => {
  const source = await readFile(new URL("../extension/background.js", import.meta.url), "utf8");
  const sharedStart = source.indexOf("if (nativeConnectPromise) {");
  assert.ok(sharedStart >= 0, "shared native connection branch is present");
  const sharedBranch = source.slice(sharedStart, source.indexOf("nativeConnectPromise = openNativePort()", sharedStart));
  assert.match(sharedBranch, /const port = await nativeConnectPromise/);
  assert.match(sharedBranch, /if \(requireCompatibility\) requireCompatibleNativeHost\(\)/);

  const startupStart = source.indexOf("async function prepareNativeApiRecoveryAtStartup()");
  const startupEnd = source.indexOf("async function readNativeApiRecoveryMarker()", startupStart);
  const startup = source.slice(startupStart, startupEnd);
  assert.match(startup, /if \(!await hasNativePermission\(\)\)[\s\S]*clearNativeApiRecoveryMarker/);
  assert.match(startup, /phase: "resumed"[\s\S]*if \(!await hasNativePermission\(\)\) await clearNativeApiRecoveryMarker\(\)/);

  const markerWriteStart = source.indexOf("async function writeNativeApiRecoveryMarker(");
  const markerWriteEnd = source.indexOf("async function prepareNativeApiRecoveryAtStartup()", markerWriteStart);
  const markerWrite = source.slice(markerWriteStart, markerWriteEnd);
  assert.match(markerWrite, /chrome\.storage\.local\.set/);
  assert.match(markerWrite, /if \(await hasNativePermission\(\)\) return true/);
  assert.match(markerWrite, /clearNativeApiRecoveryMarker\(\)/);

  const failureStart = source.indexOf("function nativeConnectionFailure(");
  const failureEnd = source.indexOf("function pingNativePort(", failureStart);
  const failure = source.slice(failureStart, failureEnd);
  assert.match(failure, /specified native messaging host not found/);
  assert.doesNotMatch(failure, /failed to start|access to the specified|host manifest/i);
});
