/*
 * FluxCatch X response observer (MAIN world).
 *
 * X's SPA receives progressive MP4 renditions inside GraphQL JSON responses,
 * but normally plays only the HLS rendition.  The isolated content script
 * cannot read those response bodies, so this small page-world observer clones
 * JSON responses and publishes only validated video.twimg.com MP4 metadata.
 * The page's original fetch/XHR result is never consumed or modified.
 */
(() => {
  "use strict";

  const CHANNEL = "fluxcatch-x-progressive-v1";
  const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
  const MAX_VISITED_OBJECTS = 60_000;
  const MAX_RESULTS = 32;
  const MAX_DEPTH = 24;
  const X_PAGE_HOST = /(?:^|\.)(?:x|twitter)\.com$/i;
  const X_API_HOST = /(?:^|\.)(?:x|twitter)\.com$/i;

  function hostOf(value) {
    try {
      return new URL(value).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  function progressiveUrl(value) {
    try {
      if (typeof value !== "string" || !value || value.length > 16_384) return null;
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      if (url.hostname.toLowerCase() !== "video.twimg.com") return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function statusIdForPath(pathname) {
    return String(pathname || "").match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/i)?.[1] || "";
  }

  function statusIdForObject(value) {
    if (!value || typeof value !== "object") return "";
    const candidates = [
      value.rest_id,
      value.id_str,
      value.tweet_id,
      value.legacy?.id_str,
      value.tweet?.rest_id,
      value.tweet_results?.result?.rest_id
    ];
    return candidates.map((entry) => String(entry || "")).find((entry) => /^\d{5,30}$/.test(entry)) || "";
  }

  function dimensionsForVariant(variant, url) {
    let width = positive(variant?.width);
    let height = positive(variant?.height);
    if (!width || !height) {
      const match = new URL(url).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
      width ||= positive(match?.[1]);
      height ||= positive(match?.[2]);
    }
    return { width, height };
  }

  function bestProgressiveVariant(info) {
    const variants = Array.isArray(info?.variants) ? info.variants : [];
    const progressive = [];
    for (const variant of variants.slice(0, 64)) {
      if (!variant || typeof variant !== "object") continue;
      const contentType = String(variant.content_type || variant.contentType || "").toLowerCase();
      if (contentType !== "video/mp4") continue;
      const url = progressiveUrl(variant.url);
      if (!url) continue;
      const dimensions = dimensionsForVariant(variant, url);
      progressive.push({
        url,
        contentType: "video/mp4",
        bandwidth: positive(variant.bitrate || variant.bandwidth),
        width: dimensions.width,
        height: dimensions.height
      });
    }
    progressive.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0)
      || (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    return progressive[0] || null;
  }

  function matchingStatusRoots(value, requiredStatusId) {
    if (!requiredStatusId) return [value];
    const roots = [];
    const seen = new WeakSet();
    const stack = [{ value, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_OBJECTS && roots.length < 8) {
      const current = stack.pop();
      const item = current?.value;
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      visited += 1;
      if (statusIdForObject(item) === requiredStatusId) {
        roots.push(item);
        continue;
      }
      if (current.depth >= MAX_DEPTH) continue;
      const children = Array.isArray(item) ? item.slice(0, 512) : Object.values(item).slice(0, 512);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return roots;
  }

  function extractProgressiveVideos(value, requiredStatusId = "") {
    if (!value || typeof value !== "object") return [];
    const results = [];
    const urls = new Set();
    const seen = new WeakSet();
    const roots = matchingStatusRoots(value, String(requiredStatusId || ""));
    const stack = roots.map((root) => ({ value: root, depth: 0 }));
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_OBJECTS && results.length < MAX_RESULTS) {
      const current = stack.pop();
      const item = current?.value;
      if (!item || typeof item !== "object" || seen.has(item)) continue;
      seen.add(item);
      visited += 1;

      if (!Array.isArray(item) && item.video_info && typeof item.video_info === "object") {
        const video = bestProgressiveVariant(item.video_info);
        if (video && !urls.has(video.url)) {
          urls.add(video.url);
          results.push(video);
        }
      }

      if (current.depth >= MAX_DEPTH) continue;
      const children = Array.isArray(item) ? item.slice(0, 512) : Object.values(item).slice(0, 512);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child && typeof child === "object") stack.push({ value: child, depth: current.depth + 1 });
      }
    }
    return results;
  }

  function isXApiResponseUrl(value) {
    try {
      const url = new URL(value, typeof location === "object" ? location.href : undefined);
      return url.protocol === "https:" && !url.username && !url.password && X_API_HOST.test(url.hostname);
    } catch {
      return false;
    }
  }

  async function readJsonResponse(response) {
    if (!response || !response.ok || !isXApiResponseUrl(response.url)) return null;
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (!/(?:application|text)\/(?:[^;]+\+)?json\b/.test(contentType)) return null;
    const declared = Number(response.headers?.get?.("content-length") || 0);
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return null;

    const clone = response.clone();
    if (!clone.body?.getReader) return null;
    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value?.byteLength || 0;
        if (bytes > MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => {});
          return null;
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return JSON.parse(text);
    } catch {
      try { await reader.cancel(); } catch { /* clone only */ }
      return null;
    }
  }

  const api = {
    bestProgressiveVariant,
    extractProgressiveVideos,
    isXApiResponseUrl,
    progressiveUrl,
    statusIdForPath,
    statusIdForObject
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  if (typeof window !== "object" || typeof document !== "object" || !X_PAGE_HOST.test(location.hostname)) return;

  const announced = new Set();
  function publish(items, statusId) {
    if (!statusId || statusId !== statusIdForPath(location.pathname)) return;
    const fresh = [];
    for (const item of Array.isArray(items) ? items : []) {
      const key = `${statusId}|${item?.url || ""}`;
      if (!item?.url || announced.has(key)) continue;
      announced.add(key);
      fresh.push(item);
      if (announced.size > 256) announced.delete(announced.values().next().value);
    }
    if (!fresh.length) return;
    window.postMessage({ channel: CHANNEL, version: 1, statusId, items: fresh.slice(0, MAX_RESULTS) }, location.origin);
  }

  function inspectObject(value, statusId) {
    try { publish(extractProgressiveVideos(value, statusId), statusId); } catch { /* observation only */ }
  }

  function inspectFetchResponse(response, statusId) {
    if (!statusId || statusId !== statusIdForPath(location.pathname)) return;
    void readJsonResponse(response).then((value) => {
      if (value && statusId === statusIdForPath(location.pathname)) inspectObject(value, statusId);
    }).catch(() => {});
  }

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function fluxCatchObservedFetch(...args) {
      const statusId = statusIdForPath(location.pathname);
      const result = Reflect.apply(originalFetch, this, args);
      if (statusId) Promise.resolve(result).then((response) => inspectFetchResponse(response, statusId)).catch(() => {});
      return result;
    };
  }

  if (typeof window.XMLHttpRequest === "function") {
    const metadata = new WeakMap();
    const observed = new WeakSet();
    const originalOpen = window.XMLHttpRequest.prototype.open;
    const originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function fluxCatchObservedOpen(method, url, ...args) {
      metadata.set(this, { url: String(url || ""), statusId: statusIdForPath(location.pathname) });
      return Reflect.apply(originalOpen, this, [method, url, ...args]);
    };
    window.XMLHttpRequest.prototype.send = function fluxCatchObservedSend(...args) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener("loadend", () => {
          try {
            const requestMeta = metadata.get(this) || {};
            const url = this.responseURL || requestMeta.url || "";
            const statusId = requestMeta.statusId || "";
            if (!statusId || statusId !== statusIdForPath(location.pathname)) return;
            const contentType = String(this.getResponseHeader?.("content-type") || "").toLowerCase();
            if (!isXApiResponseUrl(url) || !/(?:application|text)\/(?:[^;]+\+)?json\b/.test(contentType)) return;
            if (this.responseType === "json") inspectObject(this.response, statusId);
            else if ((!this.responseType || this.responseType === "text") && this.responseText.length <= MAX_RESPONSE_BYTES) {
              inspectObject(JSON.parse(this.responseText), statusId);
            }
          } catch { /* observation only */ }
        }, { once: true });
      }
      return Reflect.apply(originalSend, this, args);
    };
  }
})();
