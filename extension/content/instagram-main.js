(() => {
  "use strict";

  if (window !== window.top || globalThis.__fluxcatchInstagramMainInstalled) return;
  const pageHost = String(location.hostname || "").toLowerCase().replace(/\.$/, "");
  if (!/(?:^|\.)instagram\.com$/.test(pageHost)) return;
  globalThis.__fluxcatchInstagramMainInstalled = true;

  const MAX_RESPONSE_BYTES = 4_000_000;
  const MAX_VISITED_NODES = 50_000;
  const MAX_DEPTH = 24;
  const MAX_VERSIONS = 24;
  const MAX_INSPECTIONS_PER_WINDOW = 8;
  const INSPECTION_WINDOW_MS = 10_000;
  const MEDIA_HOST_RE = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i;
  const emitted = new Map();
  let inspectionWindowStartedAt = 0;
  let inspectionsInWindow = 0;
  let responseInspectionInFlight = false;

  function currentPageCode() {
    return String(location.pathname || "").match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i)?.[1] || "";
  }

  function beginInspection() {
    if (!currentPageCode() || responseInspectionInFlight) return false;
    const now = Date.now();
    if (!inspectionWindowStartedAt || now - inspectionWindowStartedAt >= INSPECTION_WINDOW_MS) {
      inspectionWindowStartedAt = now;
      inspectionsInWindow = 0;
    }
    if (inspectionsInWindow >= MAX_INSPECTIONS_PER_WINDOW) return false;
    inspectionsInWindow += 1;
    responseInspectionInFlight = true;
    return true;
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function completeMetaMp4(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !MEDIA_HOST_RE.test(url.hostname) || !/\.mp4$/i.test(url.pathname)) return null;
      if (url.searchParams.has("bytestart") || url.searchParams.has("byteend")) return null;
      url.hash = "";
      return url.href.length <= 16_384 ? url.href : null;
    } catch {
      return null;
    }
  }

  function bestVersion(versions) {
    if (!Array.isArray(versions)) return null;
    const eligible = versions.slice(0, MAX_VERSIONS).map((version) => ({
      url: completeMetaMp4(typeof version?.url === "string" ? version.url : ""),
      width: positive(version?.width),
      height: positive(version?.height),
      bandwidth: positive(version?.bandwidth || version?.bitrate)
    })).filter((version) => version.url);
    eligible.sort((a, b) =>
      (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
      || (b.bandwidth || 0) - (a.bandwidth || 0));
    return eligible[0] || null;
  }

  function mediaCode(value) {
    for (const key of ["code", "shortcode"]) {
      const code = typeof value?.[key] === "string" ? value[key] : "";
      if (/^[A-Za-z0-9_-]{5,40}$/.test(code)) return code;
    }
    return "";
  }

  function extractCurrentVideo(root) {
    if (!root || typeof root !== "object") return null;
    const pageCode = currentPageCode();
    const stack = [{ value: root, depth: 0 }];
    const seen = new WeakSet();
    let visited = 0;
    while (stack.length && visited < MAX_VISITED_NODES) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      if (!Array.isArray(value) && Array.isArray(value.video_versions)) {
        const best = bestVersion(value.video_versions);
        const code = mediaCode(value);
        if (best && pageCode && code === pageCode) return best;
      }
      if (depth >= MAX_DEPTH) continue;
      const children = Array.isArray(value) ? value.slice(0, 500) : Object.values(value).slice(0, 500);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        if (children[index] && typeof children[index] === "object") stack.push({ value: children[index], depth: depth + 1 });
      }
    }
    return null;
  }

  function emit(value) {
    const video = extractCurrentVideo(value);
    if (!video) return;
    const now = Date.now();
    const key = `${currentPageCode()}|${video.url}`;
    if (emitted.has(key) && now - emitted.get(key) < 30_000) return;
    emitted.set(key, now);
    if (emitted.size > 80) {
      for (const [entry, at] of emitted) if (now - at > 60_000) emitted.delete(entry);
    }
    window.postMessage({
      type: "FLUXCATCH_INSTAGRAM_MEDIA_V1",
      video: { ...video, contentType: "video/mp4" }
    }, location.origin);
  }

  function inspectText(text) {
    if (typeof text !== "string" || !text.includes("video_versions") || text.length > MAX_RESPONSE_BYTES) return;
    try { emit(JSON.parse(text)); } catch { /* Ignore non-JSON responses. */ }
  }

  async function readResponseLimited(response) {
    const declared = Number(response.headers?.get?.("content-length") || 0);
    if (declared > MAX_RESPONSE_BYTES) return null;
    if (!response.body?.getReader) {
      const text = await response.text();
      return text.length <= MAX_RESPONSE_BYTES ? text : null;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value?.byteLength || 0;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          return null;
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } finally {
      try { reader.releaseLock(); } catch { /* The stream may already be closed. */ }
    }
  }

  async function inspectFetchResponse(response) {
    if (!beginInspection()) return;
    const requestedCode = currentPageCode();
    try {
      if (!response?.ok) return;
      const type = String(response.headers?.get?.("content-type") || "").toLowerCase();
      if (type && !/json|javascript|text\//.test(type)) return;
      const text = await readResponseLimited(response.clone());
      if (text !== null && requestedCode && requestedCode === currentPageCode()) inspectText(text);
    } catch { /* Page fetch behavior must never depend on optional inspection. */ }
    finally { responseInspectionInFlight = false; }
  }

  const originalFetch = window.fetch;
  if (typeof originalFetch === "function") {
    window.fetch = function fluxcatchObservedFetch(...args) {
      const result = Reflect.apply(originalFetch, this, args);
      Promise.resolve(result).then((response) => void inspectFetchResponse(response)).catch(() => {});
      return result;
    };
  }

  // Some Reel payloads are present only in the initial JSON script nodes and
  // never produce a later fetch after document_start. Parse only bounded JSON
  // text and apply the same current-shortcode and CDN checks used above.
  if (typeof document === "object") {
    const inspectInitialScripts = () => {
      if (!currentPageCode()) return;
      for (const script of [...document.querySelectorAll("script")].slice(0, 160)) {
        const text = script.textContent || "";
        if (text.includes("video_versions")) inspectText(text);
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inspectInitialScripts, { once: true });
    } else {
      queueMicrotask(inspectInitialScripts);
    }
  }

  const xhrPrototype = window.XMLHttpRequest?.prototype;
  const originalSend = xhrPrototype?.send;
  if (typeof originalSend === "function") {
    xhrPrototype.send = function fluxcatchObservedSend(...args) {
      const requestedCode = currentPageCode();
      this.addEventListener("load", () => {
        let inspectionStarted = false;
        try {
          if (!requestedCode || requestedCode !== currentPageCode() || !beginInspection()) return;
          inspectionStarted = true;
          const type = String(this.getResponseHeader?.("content-type") || "").toLowerCase();
          if (type && !/json|javascript|text\//.test(type)) return;
          if (this.responseType === "json" && this.response && typeof this.response === "object") emit(this.response);
          else inspectText(this.responseText);
        } catch { /* responseText is unavailable for some responseType values. */ }
        finally { if (inspectionStarted) responseInspectionInFlight = false; }
      }, { once: true });
      return Reflect.apply(originalSend, this, args);
    };
  }
})();
