/*
 * FluxCatch site payload extraction (Instagram / X).
 *
 * Loaded as a classic content script before content.js, and imported for unit
 * tests via its globalThis side effect. Pure string parsing: no network, no
 * DOM. Both sites embed direct media URLs inside JSON blobs in <script> tags;
 * these helpers pull the signed CDN links out with balanced-bracket slicing
 * so a truncated or adversarial page can never make us execute page code.
 */
(() => {
  "use strict";

  const MAX_TEXT_LENGTH = 8_000_000;
  const MAX_FRAGMENTS = 40;
  const INSTAGRAM_MEDIA_HOST = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i;
  const TWITTER_MEDIA_HOST = /(?:^|\.)twimg\.com$/i;
  const INSTAGRAM_PAGE_HOST = /(?:^|\.)instagram\.com$/i;
  const TWITTER_PAGE_HOST = /(?:^|\.)(?:x|twitter)\.com$/i;

  // Content scripts run in every HTTP(S) frame so generic <video>/<audio>
  // detection keeps working inside embedded players. Large site-specific JSON
  // payloads are different: inspect them only in the top-level document and
  // only on the two sites whose payload formats we understand.
  function payloadSiteForPage(hostname, topFrame) {
    if (!topFrame) return null;
    const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (INSTAGRAM_PAGE_HOST.test(host)) return "instagram";
    if (TWITTER_PAGE_HOST.test(host)) return "twitter";
    return null;
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  }

  // Slice a balanced JSON array/object starting at text[start] (which must be
  // the opening delimiter). String/escape aware so braces inside quoted values
  // cannot unbalance the scan.
  function balancedSlice(text, start, open, close) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === open) {
        depth += 1;
      } else if (character === close) {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    return null;
  }

  function collectFragments(text, key, open, close) {
    const fragments = [];
    const needle = `"${key}"`;
    let searchFrom = 0;
    while (fragments.length < MAX_FRAGMENTS) {
      const at = text.indexOf(needle, searchFrom);
      if (at === -1) break;
      let index = at + needle.length;
      while (index < text.length && /\s/.test(text[index])) index += 1;
      if (text[index] === ":") {
        index += 1;
        while (index < text.length && /\s/.test(text[index])) index += 1;
      }
      if (text[index] === open) {
        const fragment = balancedSlice(text, index, open, close);
        if (fragment) {
          fragments.push(fragment);
          searchFrom = index + fragment.length;
          continue;
        }
      }
      searchFrom = at + needle.length;
    }
    return fragments;
  }

  // Instagram embeds "video_versions":[{"type":101,"width":720,"height":1280,
  // "url":"https://...cdninstagram.com/...mp4?..."}, ...] inside _sharedData
  // and friends. Only fbcdn/cdninstagram hosts are accepted so a page cannot
  // smuggle arbitrary origins in as "detected media".
  function extractInstagramVideos(text) {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return [];
    const results = [];
    const seen = new Set();
    for (const fragment of collectFragments(source, "video_versions", "[", "]")) {
      let versions;
      try {
        versions = JSON.parse(fragment);
      } catch {
        continue;
      }
      if (!Array.isArray(versions)) continue;
      for (const version of versions) {
        const url = typeof version?.url === "string" ? version.url : "";
        if (!url || seen.has(url) || !INSTAGRAM_MEDIA_HOST.test(hostOf(url))) continue;
        seen.add(url);
        results.push({
          url,
          width: positive(version.width),
          height: positive(version.height),
          bandwidth: positive(version.bandwidth),
          contentType: "video/mp4"
        });
      }
    }
    return results;
  }

  // X embeds "video_info":{"variants":[{"bitrate":2176000,"content_type":
  // "video/mp4","url":"https://video.twimg.com/...mp4?tag=12"}, ...]}.
  function extractTwitterVideos(text) {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return [];
    const results = [];
    const seen = new Set();
    for (const fragment of collectFragments(source, "video_info", "{", "}")) {
      let info;
      try {
        info = JSON.parse(fragment);
      } catch {
        continue;
      }
      const variants = Array.isArray(info?.variants) ? info.variants : [];
      for (const variant of variants) {
        const url = typeof variant?.url === "string" ? variant.url : "";
        if (!url || seen.has(url) || !TWITTER_MEDIA_HOST.test(hostOf(url))) continue;
        const contentType = typeof variant.content_type === "string" ? variant.content_type : "";
        if (contentType && !/^video\//i.test(contentType)) continue;
        seen.add(url);
        results.push({
          url,
          width: positive(variant.width),
          height: positive(variant.height),
          bandwidth: positive(variant.bitrate),
          contentType: contentType || "video/mp4"
        });
      }
    }
    results.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    return results;
  }

  const api = { extractInstagramVideos, extractTwitterVideos, payloadSiteForPage };
  globalThis.__fluxcatchSiteExtract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
