(() => {
  "use strict";
  if (globalThis.__fluxCatchContentInstalled) return;
  globalThis.__fluxCatchContentInstalled = true;

  const sent = new Map();
  const MAX_SENT = 800;
  const previewSent = new Map();
  const MAX_PREVIEW_URL_LENGTH = 4096;
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
      url.username = "";
      url.password = "";
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

  function send(data) {
    try {
      const url = new URL(data.url, document.baseURI);
      if (!/^https?:$/.test(url.protocol)) return;
      url.hash = "";
      const key = `${url.href}|${data.mime || ""}|${data.width || 0}x${data.height || 0}`;
      const now = Date.now();
      if (sent.has(key) && now - sent.get(key) < 4000) return;
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
    inspectPreviews(root);
    scanSitePayloads(root);
    if (root instanceof HTMLMediaElement) inspectMedia(root);
    for (const element of root.querySelectorAll?.("video, audio") || []) inspectMedia(element);
    for (const source of root.querySelectorAll?.("source[src]") || []) {
      send({ url: source.src, mime: source.type || "", source: "source-element" });
    }
    for (const link of root.querySelectorAll?.('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[property="og:audio"], link[rel="preload"][as="video"], link[rel="preload"][as="audio"]') || []) {
      const url = link.content || link.href;
      if (url) send({ url, mime: link.type || "", source: "metadata" });
    }
  }

  // Instagram / X keep their direct media URLs inside JSON blobs in <script>
  // tags; pull them out through the shared site-extract helper (loaded just
  // before this file). Sent through the same CONTENT_MEDIA pipeline as every
  // other observation, so background-side validation still applies.
  function scanSitePayloads(root = document) {
    const extract = globalThis.__fluxcatchSiteExtract;
    if (!extract) return;
    const scripts = [];
    if (root instanceof HTMLScriptElement) scripts.push(root);
    if (root.querySelectorAll) scripts.push(...root.querySelectorAll("script"));
    for (const script of scripts) {
      const text = script.textContent || "";
      if (!text || text.length > 8_000_000 || !/video_versions|video_info/.test(text)) continue;
      for (const video of extract.extractInstagramVideos(text)) {
        send({
          url: video.url,
          mime: video.contentType || "video/mp4",
          source: "site-payload",
          width: video.width,
          height: video.height,
          title: document.title
        });
      }
      for (const video of extract.extractTwitterVideos(text)) {
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

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "REQUEST_SCAN") return false;
    scan();
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
      if (record.type === "attributes") {
        if (record.target instanceof HTMLMediaElement) inspectMedia(record.target, "mutation");
        if (record.target instanceof Element) inspectPreviews(record.target);
      }
      for (const node of record.addedNodes) if (node instanceof Element) scan(node);
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
