import { resolveUrl } from "./media.js";

export function parseDash(text, manifestUrl) {
  if (typeof DOMParser === "undefined") {
    return parseDashPortable(text, manifestUrl);
  }
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror") || !doc.documentElement || doc.documentElement.localName !== "MPD") {
    throw new Error("这不是有效的 DASH MPD");
  }

  const rootBase = doc.querySelector(":scope > BaseURL")?.textContent?.trim();
  const baseUrl = rootBase ? resolveUrl(rootBase, manifestUrl) : manifestUrl;
  const representations = [];
  let representationIndex = 0;
  for (const adaptation of doc.querySelectorAll("AdaptationSet")) {
    const adaptationMime = adaptation.getAttribute("mimeType") || "";
    const adaptationCodecs = adaptation.getAttribute("codecs") || "";
    const adaptationBase = adaptation.querySelector(":scope > BaseURL")?.textContent?.trim();
    const adaptationUrl = adaptationBase ? resolveUrl(adaptationBase, baseUrl) : baseUrl;
    for (const rep of adaptation.querySelectorAll(":scope > Representation")) {
      const repBase = rep.querySelector(":scope > BaseURL")?.textContent?.trim();
      representations.push({
        index: representationIndex++,
        id: rep.getAttribute("id") || "",
        mime: rep.getAttribute("mimeType") || adaptationMime,
        codecs: rep.getAttribute("codecs") || adaptationCodecs,
        bandwidth: Number(rep.getAttribute("bandwidth") || 0),
        width: Number(rep.getAttribute("width") || 0) || null,
        height: Number(rep.getAttribute("height") || 0) || null,
        frameRate: rep.getAttribute("frameRate") || null,
        url: repBase ? resolveUrl(repBase, adaptationUrl) : null
      });
    }
  }
  return {
    type: doc.documentElement.getAttribute("type") || "static",
    duration: doc.documentElement.getAttribute("mediaPresentationDuration") || null,
    protected: Boolean(doc.querySelector("ContentProtection")),
    representations
  };
}

function parseDashPortable(text, manifestUrl) {
  const source = String(text || "");
  if (!/<MPD\b/i.test(source)) throw new Error("这不是有效的 DASH MPD");
  const representations = [];
  const repRe = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>|<Representation\b([^>]*)\/>/gi;
  let representationIndex = 0;
  for (const match of source.matchAll(repRe)) {
    const attrs = attributes(match[1] || match[3] || "");
    const body = match[2] || "";
    const base = body.match(/<BaseURL[^>]*>([^<]+)<\/BaseURL>/i)?.[1]?.trim();
    representations.push({
      index: representationIndex++,
      id: attrs.id || "",
      mime: attrs.mimeType || "",
      codecs: attrs.codecs || "",
      bandwidth: Number(attrs.bandwidth || 0),
      width: Number(attrs.width || 0) || null,
      height: Number(attrs.height || 0) || null,
      frameRate: attrs.frameRate || null,
      url: base ? resolveUrl(base, manifestUrl) : null
    });
  }
  return { type: attributes(source.match(/<MPD\b([^>]*)>/i)?.[1] || "").type || "static", duration: null, protected: /<ContentProtection\b/i.test(source), representations };
}

function attributes(source) {
  const result = {};
  for (const match of String(source).matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]] = match[3];
  return result;
}
