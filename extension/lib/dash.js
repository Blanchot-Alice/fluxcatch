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

// MV3 service workers have no DOMParser, so this path is the one that runs in
// production. It walks the tag stream with an element stack instead of a
// single regular expression: the previous regex swallowed every self-closing
// `<Representation …/>` up to the next closing tag, collapsing a whole ladder
// into one entry and dropping the inherited AdaptationSet mimeType.
function parseDashPortable(text, manifestUrl) {
  const source = String(text || "");
  const mpdOpen = source.match(/<MPD\b([^>]*)>/i);
  if (!mpdOpen) throw new Error("这不是有效的 DASH MPD");
  const mpdAttributes = attributes(mpdOpen[1] || "");
  const representations = [];
  const stack = [];
  let representationIndex = 0;
  let protectedContent = false;
  const tagRe = /<\/?([\w:.-]+)\b([^>]*?)(\/?)>/g;
  const stripped = source.replace(/<!--[\s\S]*?-->/g, "").replace(/<\?[\s\S]*?\?>/g, "");
  for (const match of stripped.matchAll(tagRe)) {
    const [raw, name, rawAttributes, selfClose] = match;
    const local = name.includes(":") ? name.slice(name.lastIndexOf(":") + 1) : name;
    const closing = raw.startsWith("</");
    if (closing) {
      for (let depth = stack.length - 1; depth >= 0; depth -= 1) {
        if (stack[depth].name !== local) continue;
        const [frame] = stack.splice(depth);
        if (frame.name === "Representation") representations.push(finishRepresentation(frame, stack, manifestUrl, representationIndex++));
        break;
      }
      continue;
    }
    const frame = { name: local, attrs: attributes(rawAttributes || ""), baseUrl: null };
    if (local === "ContentProtection") protectedContent = true;
    if (local === "BaseURL" && !selfClose) {
      const end = stripped.indexOf("</", match.index + raw.length);
      const value = end >= 0 ? stripped.slice(match.index + raw.length, end).trim() : "";
      const owner = stack[stack.length - 1];
      if (owner && value && !owner.baseUrl) owner.baseUrl = value;
      continue;
    }
    if (selfClose) {
      if (local === "Representation") representations.push(finishRepresentation(frame, stack, manifestUrl, representationIndex++));
      continue;
    }
    stack.push(frame);
  }
  return {
    type: mpdAttributes.type || "static",
    duration: mpdAttributes.mediaPresentationDuration || null,
    protected: protectedContent,
    representations
  };
}

function finishRepresentation(frame, stack, manifestUrl, index) {
  const adaptation = [...stack].reverse().find((item) => item.name === "AdaptationSet") || { attrs: {} };
  // BaseURL resolution follows the document order MPD > Period > AdaptationSet
  // > Representation; a Representation without its own BaseURL addresses no
  // single object (segment templates) and keeps url null.
  let base = manifestUrl;
  for (const ancestor of stack) {
    if (ancestor.baseUrl && ["MPD", "Period", "AdaptationSet"].includes(ancestor.name)) base = resolveUrl(ancestor.baseUrl, base);
  }
  const attrs = frame.attrs || {};
  return {
    index,
    id: attrs.id || "",
    mime: attrs.mimeType || adaptation.attrs.mimeType || "",
    codecs: attrs.codecs || adaptation.attrs.codecs || "",
    bandwidth: Number(attrs.bandwidth || 0),
    width: Number(attrs.width || 0) || null,
    height: Number(attrs.height || 0) || null,
    frameRate: attrs.frameRate || adaptation.attrs.frameRate || null,
    url: frame.baseUrl ? resolveUrl(frame.baseUrl, base) : null
  };
}

function attributes(source) {
  const result = {};
  for (const match of String(source).matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1]] = match[3];
  return result;
}
