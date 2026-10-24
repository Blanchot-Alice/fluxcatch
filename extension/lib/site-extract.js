/*
 * FluxCatch site payload extraction (Instagram / X / Pornhub / MissAV / Jable).
 *
 * Loaded as a classic content script before content.js, and imported for unit
 * tests via its globalThis side effect. Pure string parsing: no network, no
 * DOM, no eval. Instagram and X embed direct media URLs inside JSON blobs in
 * <script> tags; Pornhub keeps its quality ladder in a `flashvars_<id>` JSON
 * object; MissAV hides its playlist address in a p,a,c,k,e,d-packed script;
 * Jable assigns it to `hlsUrl`. Every helper slices balanced brackets or
 * decodes the packer as data, so a truncated or adversarial page can never
 * make us execute page code.
 */
(() => {
  "use strict";

  const MAX_TEXT_LENGTH = 8_000_000;
  const MAX_FRAGMENTS = 40;
  const INSTAGRAM_MEDIA_HOST = /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i;
  const INSTAGRAM_PAGE_HOST = /(?:^|\.)instagram\.com$/i;
  const TWITTER_PAGE_HOST = /(?:^|\.)(?:x|twitter)\.com$/i;
  const PORNHUB_PAGE_HOST = /(?:^|\.)pornhub(?:premium)?\.(?:com|org|net)$/i;
  const MISSAV_PAGE_HOST = /(?:^|\.)(?:missav|thisav)\d*\.(?:ws|com|ai|live)$/i;
  const JABLE_PAGE_HOST = /(?:^|\.)jable\.tv$/i;
  // Sites whose adapter publishes an HLS ladder or playlist from page scripts.
  const LADDER_SITES = Object.freeze(["pornhub", "missav", "jable"]);

  // Content scripts run in every HTTP(S) frame so generic <video>/<audio>
  // detection keeps working inside embedded players. Large site-specific JSON
  // payloads are different: inspect them only in the top-level document and
  // only on the two sites whose payload formats we understand.
  function payloadSiteForPage(hostname, topFrame) {
    if (!topFrame) return null;
    const host = String(hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (INSTAGRAM_PAGE_HOST.test(host)) return "instagram";
    if (TWITTER_PAGE_HOST.test(host)) return "twitter";
    if (PORNHUB_PAGE_HOST.test(host)) return "pornhub";
    if (MISSAV_PAGE_HOST.test(host)) return "missav";
    if (JABLE_PAGE_HOST.test(host)) return "jable";
    return null;
  }

  // An HLS playlist address a page script names: http(s), credential-free,
  // `.m3u8` path. Hosts are not allow-listed here because every ladder
  // download goes through the pinned native client and its network policy;
  // the extension never saves these through Chrome directly.
  function playlistUrl(value) {
    try {
      const url = new URL(typeof value === "string" ? value.trim() : "");
      if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
      if (!/\.m3u8$/i.test(url.pathname)) return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  // Pornhub: `var flashvars_<id> = {...};` carries mediaDefinitions, one HLS
  // master per quality on the site's CDN (plus a remote "get_media" JSON
  // entry that is never followed), the title, duration and poster.
  function extractPornhubLadder(text) {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return null;
    const match = /var\s+flashvars_(\d+)\s*=\s*\{/.exec(source);
    if (!match) return null;
    const fragment = balancedSlice(source, match.index + match[0].length - 1, "{", "}");
    if (!fragment) return null;
    let flashvars;
    try { flashvars = JSON.parse(fragment); } catch { return null; }
    if (!flashvars || typeof flashvars !== "object") return null;
    const definitions = Array.isArray(flashvars.mediaDefinitions) ? flashvars.mediaDefinitions.slice(0, 64) : [];
    const renditions = [];
    const seen = new Set();
    for (const definition of definitions) {
      if (!definition || typeof definition !== "object") continue;
      if (String(definition.format || "").toLowerCase() !== "hls") continue;
      const url = playlistUrl(definition.videoUrl);
      const height = positive(definition.height) || positive(definition.quality);
      if (!url || !height || seen.has(url)) continue;
      seen.add(url);
      renditions.push({ url, height, width: positive(definition.width) });
    }
    if (!renditions.length) return null;
    renditions.sort((a, b) => b.height - a.height);
    return {
      key: `pornhub:${match[1]}`,
      title: typeof flashvars.video_title === "string" ? flashvars.video_title : "",
      duration: positive(flashvars.video_duration),
      thumbnailUrl: typeof flashvars.image_url === "string" ? flashvars.image_url : "",
      renditions
    };
  }

  // Dean Edwards' p,a,c,k,e,d packer, decoded as data: the call ends in
  // `}('<p>',<a>,<c>,'<k>'.split('|'),0,{})`; every base-<a> token of <p> is
  // substituted from the word list, exactly as the packer's own loop does.
  function readQuoted(text, index) {
    if (text[index] !== "'") return null;
    let value = "";
    for (let cursor = index + 1; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if (character === "\\") {
        const next = text[cursor + 1];
        if (next === undefined) return null;
        value += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
        cursor += 1;
        continue;
      }
      if (character === "'") return { value, end: cursor + 1 };
      value += character;
    }
    return null;
  }

  function packedToken(value, base) {
    const head = value < base ? "" : packedToken(Math.floor(value / base), base);
    const rest = value % base;
    return head + (rest > 35 ? String.fromCharCode(rest + 29) : rest.toString(36));
  }

  function unpackPackedCall(text, start) {
    const payload = readQuoted(text, start);
    if (!payload) return null;
    const tail = /^,\s*(\d+)\s*,\s*(\d+)\s*,\s*/.exec(text.slice(payload.end, payload.end + 40));
    if (!tail) return null;
    const words = readQuoted(text, payload.end + tail[0].length);
    if (!words || !text.startsWith(".split('|')", words.end)) return null;
    const base = Number(tail[1]);
    const count = Number(tail[2]);
    if (!Number.isInteger(base) || base < 2 || base > 95 || !Number.isInteger(count) || count > 20_000) return null;
    const list = words.value.split("|");
    const dictionary = new Map();
    for (let index = 0; index < count; index += 1) {
      const token = packedToken(index, base);
      dictionary.set(token, list[index] || token);
    }
    return payload.value.replace(/\b\w+\b/g, (token) => (dictionary.has(token) ? dictionary.get(token) : token));
  }

  function unpackPackedScripts(text) {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return [];
    const results = [];
    let searchFrom = 0;
    while (results.length < 8) {
      const at = source.indexOf("}('", searchFrom);
      if (at === -1) break;
      searchFrom = at + 3;
      const unpacked = unpackPackedCall(source, at + 2);
      if (unpacked) results.push(unpacked);
    }
    return results;
  }

  // MissAV: the packed script assigns `source='https://<cdn>/<uuid>/playlist.m3u8'`
  // (the master with the full ladder) plus per-height siblings such as
  // `source1280` that the master already lists.
  function extractMissavPlaylist(text) {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH || !source.includes("m3u8")) return null;
    const candidates = [source, ...unpackPackedScripts(source)];
    for (const body of candidates) {
      const match = /\bsource\s*=\s*'(https?:\/\/[^']+\.m3u8[^']*)'/i.exec(body);
      const url = match ? playlistUrl(match[1]) : null;
      if (!url) continue;
      const pathname = new URL(url).pathname;
      return { key: `missav:${pathname.replace(/\/playlist\.m3u8$/i, "")}`, url };
    }
    return null;
  }

  // Jable: `var hlsUrl = 'https://<cdn>/hls/<id>/video.m3u8';` names an
  // AES-128 media playlist; the engine fetches its key through the same
  // pinned client and decrypts locally.
  function extractJablePlaylist(text) {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return null;
    const match = /\bhlsUrl\s*=\s*(["'])(https?:\/\/[^"'\s]+?\.m3u8[^"'\s]*)\1/i.exec(source);
    const url = match ? playlistUrl(match[2]) : null;
    if (!url) return null;
    return { key: `jable:${new URL(url).pathname}`, url };
  }

  // One shape for every ladder site: renditions carry the height the page
  // declared (a lone playlist has none; the engine reads its ladder later).
  function extractSiteLadder(site, text) {
    if (site === "pornhub") return extractPornhubLadder(text);
    if (site === "missav") {
      const playlist = extractMissavPlaylist(text);
      return playlist ? { key: playlist.key, title: "", duration: null, thumbnailUrl: "", renditions: [{ url: playlist.url, height: null, width: null }] } : null;
    }
    if (site === "jable") {
      const playlist = extractJablePlaylist(text);
      return playlist ? { key: playlist.key, title: "", duration: null, thumbnailUrl: "", renditions: [{ url: playlist.url, height: null, width: null }] } : null;
    }
    return null;
  }

  // Cheap prefilter before a script body is parsed at all.
  function scriptMayCarryLadder(site, text) {
    if (site === "pornhub") return /flashvars_\d+/.test(text);
    if (site === "missav") return text.includes("m3u8") && (/\bsource\s*=\s*'/.test(text) || text.includes("}('"));
    if (site === "jable") return /\bhlsUrl\s*=/.test(text);
    return false;
  }

  function positive(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  function instagramProgressiveUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !INSTAGRAM_MEDIA_HOST.test(url.hostname)) return null;
      if (!/\.mp4$/i.test(url.pathname)) return null;
      // Meta's player puts byte ranges in the query string. Those URLs are
      // fMP4 fragments (usually moof/mdat only), not standalone downloads.
      // Keep them out of the site-payload path even when a page happens to
      // include them inside a video_versions array.
      if (url.searchParams.has("bytestart") || url.searchParams.has("byteend")) return null;
      return url.href;
    } catch {
      return null;
    }
  }

  function twitterProgressiveUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.hostname.toLowerCase() !== "video.twimg.com") return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  }

  function twitterStatusId(value) {
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

  function bestTwitterVideo(info) {
    const variants = Array.isArray(info?.variants) ? info.variants : [];
    const progressive = [];
    for (const variant of variants.slice(0, 64)) {
      const url = twitterProgressiveUrl(typeof variant?.url === "string" ? variant.url : "");
      if (!url) continue;
      const contentType = typeof variant.content_type === "string" ? variant.content_type : "";
      if (contentType.toLowerCase() !== "video/mp4") continue;
      progressive.push({
        url,
        width: positive(variant.width),
        height: positive(variant.height),
        bandwidth: positive(variant.bitrate),
        contentType: "video/mp4"
      });
    }
    progressive.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0)
      || (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0));
    return progressive[0] || null;
  }

  function twitterVideosFromObject(root) {
    const results = [];
    const seenUrls = new Set();
    const seenNodes = new WeakSet();
    const stack = [{ value: root, depth: 0 }];
    let visited = 0;
    while (stack.length && visited < 50_000 && results.length < MAX_FRAGMENTS) {
      const { value, depth } = stack.pop();
      if (!value || typeof value !== "object" || seenNodes.has(value)) continue;
      seenNodes.add(value);
      visited += 1;
      const best = !Array.isArray(value) ? bestTwitterVideo(value.video_info) : null;
      if (best && !seenUrls.has(best.url)) {
        seenUrls.add(best.url);
        results.push(best);
      }
      if (depth >= 24) continue;
      const children = Array.isArray(value) ? value.slice(0, 500) : Object.values(value).slice(0, 500);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        if (children[index] && typeof children[index] === "object") stack.push({ value: children[index], depth: depth + 1 });
      }
    }
    return results;
  }

  function bestInstagramVersion(versions) {
    if (!Array.isArray(versions)) return null;
    const eligible = versions.slice(0, 24).map((version) => ({
      url: instagramProgressiveUrl(typeof version?.url === "string" ? version.url : ""),
      width: positive(version?.width),
      height: positive(version?.height),
      bandwidth: positive(version?.bandwidth || version?.bitrate)
    })).filter((version) => version.url);
    eligible.sort((a, b) =>
      (b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)
      || (b.bandwidth || 0) - (a.bandwidth || 0));
    return eligible[0] || null;
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
  function extractInstagramVideos(text, currentCode = "") {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return [];
    const requestedCode = /^[A-Za-z0-9_-]{5,40}$/.test(String(currentCode || "")) ? String(currentCode) : "";
    if (requestedCode) {
      let root;
      try { root = JSON.parse(source); } catch { return []; }
      const stack = [{ value: root, depth: 0 }];
      const seenNodes = new WeakSet();
      let visited = 0;
      while (stack.length && visited < 50_000) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== "object" || seenNodes.has(value)) continue;
        seenNodes.add(value);
        visited += 1;
        if (!Array.isArray(value)) {
          const code = typeof value.code === "string" ? value.code : typeof value.shortcode === "string" ? value.shortcode : "";
          if (code === requestedCode) {
            const best = bestInstagramVersion(value.video_versions);
            return best ? [{ ...best, contentType: "video/mp4" }] : [];
          }
        }
        if (depth >= 24) continue;
        const children = Array.isArray(value) ? value.slice(0, 500) : Object.values(value).slice(0, 500);
        for (let index = children.length - 1; index >= 0; index -= 1) {
          if (children[index] && typeof children[index] === "object") stack.push({ value: children[index], depth: depth + 1 });
        }
      }
      return [];
    }
    const results = [];
    const seen = new Set();
    for (const fragment of collectFragments(source, "video_versions", "[", "]")) {
      let versions;
      try {
        versions = JSON.parse(fragment);
      } catch {
        continue;
      }
      const best = bestInstagramVersion(versions);
      if (!best || seen.has(best.url)) continue;
      seen.add(best.url);
      results.push({ ...best, contentType: "video/mp4" });
    }
    return results;
  }

  // X embeds "video_info":{"variants":[{"bitrate":2176000,"content_type":
  // "video/mp4","url":"https://video.twimg.com/...mp4?tag=12"}, ...]}.
  function extractTwitterVideos(text, requestedStatusId = "") {
    const source = typeof text === "string" ? text : "";
    if (!source || source.length > MAX_TEXT_LENGTH) return [];
    if (requestedStatusId) {
      let root;
      try { root = JSON.parse(source); } catch { return []; }
      const stack = [{ value: root, depth: 0 }];
      const seenNodes = new WeakSet();
      let visited = 0;
      while (stack.length && visited < 50_000) {
        const { value, depth } = stack.pop();
        if (!value || typeof value !== "object" || seenNodes.has(value)) continue;
        seenNodes.add(value);
        visited += 1;
        if (twitterStatusId(value) === requestedStatusId) return twitterVideosFromObject(value);
        if (depth >= 24) continue;
        const children = Array.isArray(value) ? value.slice(0, 500) : Object.values(value).slice(0, 500);
        for (let index = children.length - 1; index >= 0; index -= 1) {
          if (children[index] && typeof children[index] === "object") stack.push({ value: children[index], depth: depth + 1 });
        }
      }
      return [];
    }
    const results = [];
    const seen = new Set();
    for (const fragment of collectFragments(source, "video_info", "{", "}")) {
      let info;
      try {
        info = JSON.parse(fragment);
      } catch {
        continue;
      }
      const best = bestTwitterVideo(info);
      if (!best || seen.has(best.url)) continue;
      seen.add(best.url);
      results.push(best);
    }
    results.sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
    return results;
  }

  const api = {
    extractInstagramVideos,
    extractTwitterVideos,
    payloadSiteForPage,
    twitterStatusId,
    LADDER_SITES,
    extractPornhubLadder,
    extractMissavPlaylist,
    extractJablePlaylist,
    extractSiteLadder,
    scriptMayCarryLadder,
    unpackPackedScripts
  };
  globalThis.__fluxcatchSiteExtract = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
