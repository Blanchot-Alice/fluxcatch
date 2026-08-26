(() => {
  "use strict";
  if (globalThis.__fluxCatchContentInstalled) return;
  globalThis.__fluxCatchContentInstalled = true;

  const sent = new Map();
  const MAX_SENT = 800;
  const previewSent = new Map();
  const MAX_MUTATION_ROOTS = 256;
  const MUTATION_RESCAN_COOLDOWN_MS = 5000;
  const MAX_PREVIEW_URL_LENGTH = 4096;
  const TOP_FRAME = window === window.top;
  const SITE_PAYLOAD_KIND = globalThis.__fluxcatchSiteExtract?.payloadSiteForPage?.(location.hostname, TOP_FRAME) || null;
  const X_PROGRESSIVE_CHANNEL = "fluxcatch-x-progressive-v1";
  const SITE_MEDIA_CACHE_MAX = 256;
  const SITE_MEDIA_CACHE_TTL_MS = 15 * 60 * 1000;
  const cachedSiteMedia = new Map();
  let processedSiteScripts = new WeakSet();
  const pendingMutationRoots = new Set();
  const pendingAttributeTargets = new Set();
  let mutationFlushQueued = false;
  let mutationOverflowed = false;
  let lastOverflowRescanAt = 0;
  const PREVIEW_RULES = [
    { selector: "video[poster]", source: "poster", value: (element) => element.poster || element.getAttribute("poster") },
    { selector: 'meta[property="og:image:secure_url" i]', source: "og:image:secure_url", value: (element) => element.content },
    { selector: 'meta[property="og:image" i]', source: "og:image", value: (element) => element.content },
    { selector: 'meta[name="twitter:image" i], meta[property="twitter:image" i]', source: "twitter:image", value: (element) => element.content },
    { selector: '[itemprop~="thumbnailUrl" i]', source: "thumbnailUrl", value: previewElementUrl },
    { selector: 'link[rel~="image_src" i]', source: "image_src", value: (element) => element.href || element.getAttribute("href") }
  ];

  function normalizePreviewUrl(value) {
    try {
      if (typeof value !== "string" || !value.trim() || value.length > MAX_PREVIEW_URL_LENGTH) return null;
      const url = new URL(value, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) return null;
      if (url.username || url.password) return null;
      url.hash = "";
      return url.href.length <= MAX_PREVIEW_URL_LENGTH ? url.href : null;
    } catch {
      return null;
    }
  }

  function previewElementUrl(element) {
    return element.content || element.href || element.src
      || element.getAttribute?.("content") || element.getAttribute?.("href") || element.getAttribute?.("src");
  }

  function sendPreview(value, source) {
    if (!TOP_FRAME) return null;
    const thumbnailUrl = normalizePreviewUrl(value);
    if (!thumbnailUrl) return null;
    const key = `${source}|${thumbnailUrl}`;
    const now = Date.now();
    if (previewSent.has(key) && now - previewSent.get(key) < 4000) return thumbnailUrl;
    previewSent.set(key, now);
    if (previewSent.size > 80) {
      const oldest = [...previewSent.entries()].sort((a, b) => a[1] - b[1]).slice(0, 20);
      for (const [item] of oldest) previewSent.delete(item);
    }
    chrome.runtime.sendMessage({
      type: "PAGE_PREVIEW",
      data: { thumbnailUrl, source }
    }).catch(() => {});
    return thumbnailUrl;
  }

  function inspectPreviews(root = document) {
    for (const rule of PREVIEW_RULES) {
      if (root instanceof Element && root.matches?.(rule.selector)) sendPreview(rule.value(root), rule.source);
      for (const element of root.querySelectorAll?.(rule.selector) || []) sendPreview(rule.value(element), rule.source);
    }
  }

  function send(data, { force = false } = {}) {
    try {
      const url = new URL(data.url, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) return;
      url.hash = "";
      const key = `${url.href}|${data.mime || ""}|${data.width || 0}x${data.height || 0}`;
      const now = Date.now();
      if (!force && sent.has(key) && now - sent.get(key) < 4000) return;
      sent.set(key, now);
      if (sent.size > MAX_SENT) {
        const oldest = [...sent.entries()].sort((a, b) => a[1] - b[1]).slice(0, 200);
        for (const [item] of oldest) sent.delete(item);
      }
      chrome.runtime.sendMessage({
        type: "CONTENT_MEDIA",
        data: {
          ...data,
          url: url.href,
          pageTitle: document.title,
          tabUrl: location.href
        }
      }).catch(() => {});
    } catch {
      // Invalid URLs and extension teardown are ignored.
    }
  }

  function currentSitePageKey() {
    if (!SITE_PAYLOAD_KIND) return "";
    try {
      const page = new URL(location.href);
      page.hash = "";
      return `${SITE_PAYLOAD_KIND}|${page.origin}${page.pathname}${page.search}`;
    } catch {
      return "";
    }
  }

  function currentInstagramCode() {
    return String(location.pathname || "").match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)?.[1] || "";
  }

  function currentXStatusId() {
    return String(location.pathname || "").match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/i)?.[1] || "";
  }

  function hasSupportedSitePayloadRoute() {
    return SITE_PAYLOAD_KIND === "instagram" ? Boolean(currentInstagramCode())
      : SITE_PAYLOAD_KIND === "twitter" ? Boolean(currentXStatusId())
        : false;
  }

  function pruneSiteMediaCache(now = Date.now()) {
    for (const [key, entry] of cachedSiteMedia) {
      if (!entry || now - entry.at > SITE_MEDIA_CACHE_TTL_MS) cachedSiteMedia.delete(key);
    }
    while (cachedSiteMedia.size > SITE_MEDIA_CACHE_MAX) cachedSiteMedia.delete(cachedSiteMedia.keys().next().value);
  }

  function cacheSiteCandidate(data) {
    const pageKey = currentSitePageKey();
    if (!pageKey || !data?.url) return;
    const now = Date.now();
    pruneSiteMediaCache(now);
    const key = `${pageKey}|${data.source || ""}|${data.url}`;
    cachedSiteMedia.delete(key);
    cachedSiteMedia.set(key, { pageKey, at: now, data: { ...data } });
    pruneSiteMediaCache(now);
  }

  function currentCachedSiteMedia() {
    const pageKey = currentSitePageKey();
    const now = Date.now();
    pruneSiteMediaCache(now);
    if (!pageKey) return [];
    return [...cachedSiteMedia.values()]
      .filter((entry) => entry.pageKey === pageKey)
      .map((entry) => ({ ...entry.data }))
      .slice(0, 64);
  }

  function clearCurrentSiteMediaCache() {
    const pageKey = currentSitePageKey();
    if (!pageKey) return;
    for (const [key, entry] of cachedSiteMedia) if (entry?.pageKey === pageKey) cachedSiteMedia.delete(key);
  }

  function trustedXProgressiveItem(item) {
    if (!TOP_FRAME || SITE_PAYLOAD_KIND !== "twitter" || !item || typeof item !== "object") return null;
    try {
      const url = new URL(item.url);
      if (url.protocol !== "https:" || url.username || url.password || url.hostname.toLowerCase() !== "video.twimg.com") return null;
      if (String(item.contentType || "").toLowerCase() !== "video/mp4") return null;
      url.hash = "";
      return {
        url: url.href,
        mime: "video/mp4",
        source: "x-api-response",
        width: Number.isFinite(Number(item.width)) && Number(item.width) > 0 ? Number(item.width) : null,
        height: Number.isFinite(Number(item.height)) && Number(item.height) > 0 ? Number(item.height) : null,
        bandwidth: Number.isFinite(Number(item.bandwidth)) && Number(item.bandwidth) > 0 ? Number(item.bandwidth) : null,
        title: document.title
      };
    } catch {
      return null;
    }
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== X_PROGRESSIVE_CHANNEL) return;
    const statusId = currentXStatusId();
    if (!statusId || event.data?.statusId !== statusId) return;
    const items = Array.isArray(event.data?.items) ? event.data.items.slice(0, 32) : [];
    for (const item of items) {
      const candidate = trustedXProgressiveItem(item);
      if (candidate) {
        cacheSiteCandidate(candidate);
        send(candidate);
      }
    }
  });

  function trustedInstagramProgressiveItem(video) {
    if (!TOP_FRAME || SITE_PAYLOAD_KIND !== "instagram" || !video || typeof video !== "object") return null;
    try {
      const url = new URL(video.url);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      if (!/(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i.test(url.hostname) || !/\.mp4$/i.test(url.pathname)) return null;
      if (url.searchParams.has("bytestart") || url.searchParams.has("byteend")) return null;
      url.hash = "";
      return {
        url: url.href,
        mime: "video/mp4",
        source: "instagram-api-response",
        width: Number.isFinite(Number(video.width)) && Number(video.width) > 0 ? Number(video.width) : null,
        height: Number.isFinite(Number(video.height)) && Number(video.height) > 0 ? Number(video.height) : null,
        title: document.title
      };
    } catch {
      return null;
    }
  }

  window.addEventListener("message", (event) => {
    if (!TOP_FRAME || SITE_PAYLOAD_KIND !== "instagram") return;
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.type !== "FLUXCATCH_INSTAGRAM_MEDIA_V1" || !event.data.video || typeof event.data.video !== "object") return;
    const candidate = trustedInstagramProgressiveItem(event.data.video);
    if (!candidate) return;
    cacheSiteCandidate(candidate);
    send(candidate);
  });

  function inspectMedia(element, source = "dom") {
    const candidates = new Set();
    const poster = element instanceof HTMLVideoElement
      ? sendPreview(element.poster || element.getAttribute?.("poster"), "poster")
      : null;
    for (const value of [element.currentSrc, element.src, element.getAttribute?.("src")]) if (value) candidates.add(value);
    for (const child of element.querySelectorAll?.("source[src]") || []) if (child.src) candidates.add(child.src);
    for (const url of candidates) {
      send({
        url,
        mime: element.currentType || element.getAttribute?.("type") || "",
        source,
        title: element.getAttribute?.("title") || element.getAttribute?.("aria-label") || "",
        width: element.videoWidth || element.width || null,
        height: element.videoHeight || element.height || null,
        duration: Number.isFinite(element.duration) ? element.duration : null,
        thumbnailUrl: poster,
        thumbnailSource: poster ? "poster" : null
      });
    }
  }

  function scan(root = document) {
    if (TOP_FRAME) inspectPreviews(root);
    scanSitePayloads(root);
    if (root instanceof HTMLMediaElement) inspectMedia(root);
    for (const element of root.querySelectorAll?.("video, audio") || []) inspectMedia(element);
    if (root instanceof Element && root.matches?.("source[src]")) {
      send({ url: root.src, mime: root.type || "", source: "source-element" });
    }
    for (const source of root.querySelectorAll?.("source[src]") || []) {
      send({ url: source.src, mime: source.type || "", source: "source-element" });
    }
    if (TOP_FRAME) {
      if (root instanceof Element && root.matches?.('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[property="og:audio"], link[rel="preload"][as="video"], link[rel="preload"][as="audio"]')) {
        const url = root.content || root.href;
        if (url) send({ url, mime: root.type || "", source: "metadata" });
      }
      for (const link of root.querySelectorAll?.('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[property="og:audio"], link[rel="preload"][as="video"], link[rel="preload"][as="audio"]') || []) {
        const url = link.content || link.href;
        if (url) send({ url, mime: link.type || "", source: "metadata" });
      }
    }
  }

  // Instagram / X keep their direct media URLs inside JSON blobs in <script>
  // tags; pull them out through the shared site-extract helper (loaded just
  // before this file). Sent through the same CONTENT_MEDIA pipeline as every
  // other observation, so background-side validation still applies.
  function scanSitePayloads(root = document) {
    const extract = globalThis.__fluxcatchSiteExtract;
    if (!extract || !SITE_PAYLOAD_KIND) return;
    const requestedMediaId = SITE_PAYLOAD_KIND === "instagram" ? currentInstagramCode() : currentXStatusId();
    if (!requestedMediaId) return;
    const scripts = [];
    if (root instanceof HTMLScriptElement) scripts.push(root);
    if (root.querySelectorAll) scripts.push(...root.querySelectorAll("script"));
    for (const script of scripts) {
      if (processedSiteScripts.has(script)) continue;
      const text = script.textContent || "";
      if (!text) continue;
      processedSiteScripts.add(script);
      if (text.length > 8_000_000 || !/video_versions|video_info/.test(text)) continue;
      const videos = SITE_PAYLOAD_KIND === "instagram"
        ? extract.extractInstagramVideos(text, requestedMediaId)
        : extract.extractTwitterVideos(text, requestedMediaId);
      for (const video of videos) {
        send({
          url: video.url,
          mime: video.contentType || "video/mp4",
          source: "site-payload",
          width: video.width,
          height: video.height,
          title: document.title
        });
      }
    }
  }

  const MEDIA_TARGET_SELECTOR = "video, audio, source[src]";
  const TOP_FRAME_TARGET_SELECTOR = [
    ...PREVIEW_RULES.map((rule) => rule.selector),
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[property="og:audio"]',
    'link[rel="preload"][as="video"]',
    'link[rel="preload"][as="audio"]'
  ].join(", ");

  function elementNeedsScan(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches?.(MEDIA_TARGET_SELECTOR) || element.querySelector?.(MEDIA_TARGET_SELECTOR)) return true;
    if (TOP_FRAME && (element.matches?.(TOP_FRAME_TARGET_SELECTOR) || element.querySelector?.(TOP_FRAME_TARGET_SELECTOR))) return true;
    if (hasSupportedSitePayloadRoute() && (element instanceof HTMLScriptElement || element.querySelector?.("script"))) return true;
    return false;
  }

  function attributeTargetNeedsScan(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches?.(MEDIA_TARGET_SELECTOR)) return true;
    return TOP_FRAME && element.matches?.(TOP_FRAME_TARGET_SELECTOR);
  }

  function queueMutationRoot(element) {
    if (!elementNeedsScan(element)) return;
    if (pendingMutationRoots.size >= MAX_MUTATION_ROOTS) {
      mutationOverflowed = true;
    } else {
      pendingMutationRoots.add(element);
    }
    scheduleMutationFlush();
  }

  function queueAttributeTarget(element) {
    if (!attributeTargetNeedsScan(element)) return;
    if (pendingAttributeTargets.size >= MAX_MUTATION_ROOTS) {
      mutationOverflowed = true;
    } else {
      pendingAttributeTargets.add(element);
    }
    scheduleMutationFlush();
  }

  function scheduleMutationFlush() {
    if (mutationFlushQueued) return;
    mutationFlushQueued = true;
    queueMicrotask(flushMutationBatch);
  }

  function flushMutationBatch() {
    mutationFlushQueued = false;
    const overflowed = mutationOverflowed;
    mutationOverflowed = false;
    const roots = [...pendingMutationRoots];
    const attributes = [...pendingAttributeTargets];
    pendingMutationRoots.clear();
    pendingAttributeTargets.clear();
    // A child can appear in the same mutation batch as its parent. Scan only
    // the outermost root so one DOM insertion never causes duplicate subtree
    // walks.
    for (const root of roots) {
      if (roots.some((other) => other !== root && other.contains?.(root))) continue;
      scan(root);
    }
    for (const target of attributes) {
      if (roots.some((root) => root === target || root.contains?.(target))) continue;
      scan(target);
    }
    // A hostile or highly dynamic page can exceed the incremental queue. Keep
    // the first bounded roots and permit at most one full recovery scan every
    // five seconds, scheduled during idle time when Chrome exposes it.
    const now = Date.now();
    if (overflowed && now - lastOverflowRescanAt >= MUTATION_RESCAN_COOLDOWN_MS) {
      lastOverflowRescanAt = now;
      const recover = () => scan();
      if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(recover, { timeout: 1000 });
      } else {
        queueMicrotask(recover);
      }
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CLEAR_CACHED_SITE_MEDIA") {
      clearCurrentSiteMediaCache();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "GET_CACHED_SITE_MEDIA") {
      sendResponse({ ok: true, items: currentCachedSiteMedia() });
      return false;
    }
    if (message?.type !== "REQUEST_SCAN") return false;
    // A manual scan is a user action: allow a site to re-process a script
    // element whose text may have been replaced in-place since initial load.
    processedSiteScripts = new WeakSet();
    scan();
    for (const item of currentCachedSiteMedia()) send(item, { force: true });
    sendResponse({ ok: true });
    return false;
  });

  document.addEventListener("loadedmetadata", (event) => {
    if (event.target instanceof HTMLMediaElement) inspectMedia(event.target, "loadedmetadata");
  }, true);
  document.addEventListener("durationchange", (event) => {
    if (event.target instanceof HTMLMediaElement) inspectMedia(event.target, "durationchange");
  }, true);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") queueAttributeTarget(record.target);
      if (record.type === "childList" && record.target instanceof HTMLScriptElement) queueMutationRoot(record.target);
      for (const node of record.addedNodes) queueMutationRoot(node);
    }
  });

  function start() {
    scan();
    observer.observe(document.documentElement || document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "poster", "content", "href", "property", "name", "itemprop", "rel"]
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
