const PURPOSES = new Set([
  "thumbnail",
  "manifest_probe",
  "user_download",
  "manifest_child",
  "redirect",
  "site_metadata"
]);

const PROVENANCES = new Set([
  "observed_response",
  "dom_media_element",
  "dom_metadata",
  "site_payload",
  "fixed_site_api",
  "user_supplied"
]);

const NETWORK_SCOPE_SET = new Set(["public_only", "private_network_opt_in"]);
const BILIBILI_METADATA_PATHS = new Set(["/x/player/pagelist", "/x/player/playurl"]);
const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata",
  "instance-data",
  "instance-data.ec2.internal",
  "metadata.google.internal",
  "metadata.aws.internal",
  "metadata.azure.internal"
]);

function cleanHostname(value) {
  return String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function parseIpv4(hostname) {
  const parts = cleanHostname(hostname).split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const values = parts.map(Number);
  return values.every((value) => value >= 0 && value <= 255) ? values : null;
}

function parseIpv6(hostname) {
  let source = cleanHostname(hostname);
  if (!source.includes(":")) return null;
  const zone = source.indexOf("%");
  if (zone >= 0) source = source.slice(0, zone);

  let ipv4Tail = null;
  const tail = source.split(":").at(-1);
  if (tail?.includes(".")) {
    ipv4Tail = parseIpv4(tail);
    if (!ipv4Tail) return null;
    source = source.slice(0, source.length - tail.length) + `${((ipv4Tail[0] << 8) | ipv4Tail[1]).toString(16)}:${((ipv4Tail[2] << 8) | ipv4Tail[3]).toString(16)}`;
  }

  const halves = source.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[a-f0-9]{1,4}$/i.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
  if (words.length !== 8) return null;
  return words.reduce((value, word) => (value << 16n) | BigInt(word), 0n);
}

function inIpv6Prefix(value, prefix, bits) {
  const shift = 128n - BigInt(bits);
  return value >> shift === prefix >> shift;
}

function classifyEmbeddedIpv4(value, hostname) {
  const ipv4 = Number(value & 0xffffffffn);
  const embedded = `${ipv4 >>> 24}.${(ipv4 >>> 16) & 255}.${(ipv4 >>> 8) & 255}.${ipv4 & 255}`;
  return { ...classifyNetworkHost(embedded), hostname };
}

function classifyNat64Local(value, hostname) {
  // RFC 6052's /48 layout splits the IPv4 payload around the reserved u octet:
  // prefix(48) | v4[0:16] | u(8) | v4[16:32] | zero suffix(40).
  const uOctet = (value >> 56n) & 0xffn;
  const suffix = value & ((1n << 40n) - 1n);
  if (uOctet !== 0n || suffix !== 0n) return { category: "reserved", hostname };
  const embedded = (((value >> 64n) & 0xffffn) << 16n) | ((value >> 40n) & 0xffffn);
  return classifyEmbeddedIpv4(embedded, hostname);
}

export function classifyNetworkHost(value) {
  const hostname = cleanHostname(value);
  if (!hostname) return { category: "invalid", hostname };
  if (ALWAYS_BLOCKED_HOSTS.has(hostname)) return { category: "metadata", hostname };
  if (hostname === "localhost" || hostname === "localhost.localdomain" || hostname.endsWith(".localhost")) {
    return { category: "private", hostname };
  }

  const ipv4 = parseIpv4(hostname);
  if (ipv4) {
    const [a, b, c, d] = ipv4;
    if ((a === 169 && b === 254 && c === 169 && d === 254)
      || (a === 100 && b === 100 && c === 100 && d === 200)) return { category: "metadata", hostname };
    if (a === 0) return { category: "unspecified", hostname };
    if (a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) {
      return { category: "private", hostname };
    }
    if (a === 169 && b === 254) return { category: "link_local", hostname };
    if (a >= 224 && a <= 239) return { category: "multicast", hostname };
    if (a >= 240) return { category: "reserved", hostname };
    if ((a === 100 && b >= 64 && b <= 127)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)) return { category: "reserved", hostname };
    return { category: "public", hostname };
  }

  const ipv6 = parseIpv6(hostname);
  if (ipv6 !== null) {
    if (ipv6 === 0n) return { category: "unspecified", hostname };
    if (ipv6 === 1n) return { category: "private", hostname };
    if (ipv6 >> 32n === 0xffffn) {
      return classifyEmbeddedIpv4(ipv6, hostname);
    }
    // Deprecated IPv4-compatible addresses (::/96), including hexadecimal
    // spellings such as ::7f00:1, inherit the embedded IPv4 classification.
    if (ipv6 >> 32n === 0n) return classifyEmbeddedIpv4(ipv6, hostname);
    // Both standardized NAT64 prefixes carry the destination IPv4 address in
    // their low 32 bits. Never let an encoded loopback/metadata target look
    // like a public IPv6 destination.
    if (inIpv6Prefix(ipv6, 0x0064ff9bn << 96n, 96)) return classifyEmbeddedIpv4(ipv6, hostname);
    if (inIpv6Prefix(ipv6, 0x0064ff9b0001n << 80n, 48)) return classifyNat64Local(ipv6, hostname);
    // 6to4 embeds IPv4 immediately after its 2002::/16 prefix.
    if (inIpv6Prefix(ipv6, 0x2002n << 112n, 16)) return classifyEmbeddedIpv4((ipv6 >> 80n) & 0xffffffffn, hostname);
    // Teredo endpoints require protocol-aware unmasking and are never a safe
    // direct HTTP literal for this extension.
    if (inIpv6Prefix(ipv6, 0x20010000n << 96n, 32)) return { category: "reserved", hostname };
    if (inIpv6Prefix(ipv6, 0xfc00n << 112n, 7)) return { category: "private", hostname };
    if (inIpv6Prefix(ipv6, 0xfe80n << 112n, 10)) return { category: "link_local", hostname };
    if (inIpv6Prefix(ipv6, 0xff00n << 112n, 8)) return { category: "multicast", hostname };
    if (inIpv6Prefix(ipv6, 0xfec0n << 112n, 10)
      || inIpv6Prefix(ipv6, 0x0100n << 112n, 64)
      || inIpv6Prefix(ipv6, 0x20010db8n << 96n, 32)
      || inIpv6Prefix(ipv6, 0x20010010n << 96n, 28)
      || inIpv6Prefix(ipv6, 0x20010020n << 96n, 28)
      || inIpv6Prefix(ipv6, 0x200100020000n << 80n, 48)
      || inIpv6Prefix(ipv6, 0x3fffn << 112n, 20)) return { category: "reserved", hostname };
    // After explicit transition mechanisms, only the IPv6 global-unicast
    // allocation 2000::/3 is eligible for public network requests. Other
    // special-purpose and currently unallocated ranges fail closed.
    if (inIpv6Prefix(ipv6, 0x2000n << 112n, 3)) return { category: "public", hostname };
    return { category: "reserved", hostname };
  }

  if (hostname.endsWith(".local") || !hostname.includes(".")) return { category: "local_name", hostname };
  return { category: "public", hostname };
}

export function isBilibiliMetadataEndpoint(value) {
  try {
    const url = new URL(value);
    if (!(url.protocol === "https:"
      && url.hostname.toLowerCase() === "api.bilibili.com"
      && BILIBILI_METADATA_PATHS.has(url.pathname)
      && !url.username
      && !url.password
      && !url.hash)) return false;
    const keys = [...url.searchParams.keys()];
    if (keys.some((key, index) => keys.indexOf(key) !== index)) return false;
    const identityKeys = ["avid", "bvid"].filter((key) => url.searchParams.has(key));
    if (identityKeys.length !== 1) return false;
    const identity = url.searchParams.get(identityKeys[0]) || "";
    if (identityKeys[0] === "avid" ? !/^\d{1,20}$/.test(identity) : !/^BV[a-z0-9]{6,20}$/i.test(identity)) return false;
    if (url.pathname === "/x/player/pagelist") return keys.every((key) => ["avid", "bvid"].includes(key));
    const allowed = new Set(["avid", "bvid", "cid", "qn", "fnval", "fourk"]);
    return keys.every((key) => allowed.has(key))
      && /^\d{1,20}$/.test(url.searchParams.get("cid") || "")
      && url.searchParams.get("qn") === "127"
      && url.searchParams.get("fnval") === "16"
      && url.searchParams.get("fourk") === "1";
  } catch {
    return false;
  }
}

function hostMatchesSuffix(hostname, suffix) {
  const expected = cleanHostname(suffix).replace(/^\*\./, "");
  return Boolean(expected) && (hostname === expected || hostname.endsWith(`.${expected}`));
}

function normalizedOrigin(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

export function redactNetworkUrl(value) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname ? "/…" : ""}`;
  } catch {
    return "<无效地址>";
  }
}

export function evaluateNetworkRequest({
  url: rawUrl,
  purpose,
  provenance,
  networkScope = "public_only",
  automatic = false,
  userInitiated = false,
  pageUrl = "",
  observedMediaUrls = [],
  adapterImageHosts = [],
  allowedThumbnailOrigins = []
} = {}) {
  if (!PURPOSES.has(purpose)) return { allowed: false, reason: "invalid_purpose" };
  if (!PROVENANCES.has(provenance)) return { allowed: false, reason: "invalid_provenance" };
  if (!NETWORK_SCOPE_SET.has(networkScope)) return { allowed: false, reason: "invalid_network_scope" };

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "invalid_url" };
  }
  if (!/^https?:$/.test(url.protocol)) return { allowed: false, reason: "invalid_scheme" };
  if (url.username || url.password) return { allowed: false, reason: "embedded_credentials" };
  url.hash = "";

  const target = classifyNetworkHost(url.hostname);
  const privateOptIn = networkScope === "private_network_opt_in";
  if (target.category !== "public" && !(privateOptIn && ["private", "local_name"].includes(target.category))) {
    return { allowed: false, reason: `blocked_${target.category}`, url: url.href };
  }

  if (purpose === "site_metadata") {
    if (provenance !== "fixed_site_api" || !isBilibiliMetadataEndpoint(url.href)) {
      return { allowed: false, reason: "site_metadata_not_allowlisted", url: url.href };
    }
  }

  if (purpose === "manifest_probe" && automatic && provenance !== "observed_response") {
    return { allowed: false, reason: "automatic_probe_requires_observed_response", url: url.href };
  }
  if (automatic && (provenance === "dom_metadata" || provenance === "site_payload") && purpose !== "thumbnail") {
    return { allowed: false, reason: "page_hint_requires_user_action", url: url.href };
  }
  if (purpose === "user_download" && !userInitiated && provenance !== "observed_response") {
    return { allowed: false, reason: "download_requires_observation_or_user_action", url: url.href };
  }

  if (purpose === "thumbnail") {
    const allowedOrigins = new Set([
      normalizedOrigin(pageUrl),
      ...observedMediaUrls.map(normalizedOrigin),
      ...allowedThumbnailOrigins.map(normalizedOrigin)
    ].filter(Boolean));
    const adapterAllowed = adapterImageHosts.some((suffix) => hostMatchesSuffix(url.hostname.toLowerCase(), suffix));
    if (!allowedOrigins.has(url.origin) && !adapterAllowed) {
      return { allowed: false, reason: "thumbnail_origin_not_allowlisted", url: url.href };
    }
  }

  return { allowed: true, url: url.href, reason: null };
}

export function requireNetworkRequest(input) {
  const result = evaluateNetworkRequest(input);
  if (result.allowed) return result.url;
  const error = new Error(`网络策略已阻止 ${redactNetworkUrl(input?.url)}（${result.reason}）`);
  error.code = result.reason;
  throw error;
}

export const NETWORK_PURPOSES = Object.freeze([...PURPOSES]);
export const CANDIDATE_PROVENANCES = Object.freeze([...PROVENANCES]);
export const NETWORK_SCOPES = Object.freeze([...NETWORK_SCOPE_SET]);
