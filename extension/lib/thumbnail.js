import { requireNetworkRequest } from "./network-policy.js";
import { BUILD_PROFILE } from "./build-profile.js";

const DEFAULT_MAX_THUMBNAIL_BYTES = 8 * 1024 * 1024;
const OBJECT_URL_REVOKE_TIMEOUT_MS = 15_000;

function normalizeThumbnailUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    // Reject instead of silently rewriting. A page must not use extension
    // privileges to turn an embedded-credential URL into a second request.
    if (url.username || url.password) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

async function readBoundedBlob(response, contentType, maxBytes) {
  if (!response.body?.getReader) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error("thumbnail_too_large");
    return blob.type === contentType ? blob : new Blob([blob], { type: contentType });
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel("thumbnail_too_large");
        throw new Error("thumbnail_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: contentType });
}

function cancelResponseBody(response) {
  const cancellation = response.body?.cancel?.("thumbnail_rejected");
  cancellation?.catch?.(() => {});
}

export async function fetchThumbnailBlob(value, {
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_THUMBNAIL_BYTES,
  pageUrl = "",
  observedMediaUrls = [],
  adapterImageHosts = [],
  allowedThumbnailOrigins = [],
  networkScope = "public_only",
  provenance = "dom_metadata"
} = {}) {
  const url = normalizeThumbnailUrl(value);
  if (!url) throw new Error("invalid_thumbnail_url");
  const policy = { purpose: "thumbnail", provenance, networkScope, pageUrl, observedMediaUrls, adapterImageHosts, allowedThumbnailOrigins };
  const allowedUrl = requireNetworkRequest({ ...policy, url });

  const response = await fetchImpl(allowedUrl, {
    method: "GET",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "force-cache",
    redirect: "error"
  });
  if (!response.ok) {
    cancelResponseBody(response);
    throw new Error(`thumbnail_http_${response.status}`);
  }
  if (response.url && response.url !== allowedUrl) {
    cancelResponseBody(response);
    // redirect:"error" should make fetch reject before this point. Treat any
    // implementation that still reports a different final URL as a protocol
    // violation rather than re-authorizing it under a broader purpose.
    throw new Error("thumbnail_redirect_rejected");
  }

  const contentType = (response.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
    // Raster-only prevents a fetched SVG from referencing additional remote
    // resources outside the credential-free request made here.
    cancelResponseBody(response);
    throw new Error("thumbnail_not_image");
  }

  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    cancelResponseBody(response);
    throw new Error("thumbnail_too_large");
  }
  return readBoundedBlob(response, contentType, maxBytes);
}

export function loadPrivacySafeThumbnail(value, fallback, {
  className = "media-thumbnail",
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_MAX_THUMBNAIL_BYTES,
  enabled = BUILD_PROFILE.features.remoteThumbnails,
  ...policy
} = {}) {
  // The stable profile renders the existing media-type tile without making a
  // page-derived network request. The bounded raster implementation below is
  // retained for a future profile that explicitly enables this capability.
  if (!enabled) return fallback;
  const url = normalizeThumbnailUrl(value);
  if (!url) return fallback;

  void fetchThumbnailBlob(url, { fetchImpl, maxBytes, ...policy }).then((blob) => {
    if (!fallback.isConnected) return;
    const objectUrl = URL.createObjectURL(blob);
    let settled = false;
    let revokeTimer = 0;
    const revoke = () => {
      if (settled) return;
      settled = true;
      if (revokeTimer) clearTimeout(revokeTimer);
      URL.revokeObjectURL(objectUrl);
    };
    revokeTimer = setTimeout(revoke, OBJECT_URL_REVOKE_TIMEOUT_MS);

    try {
      const thumbnail = document.createElement("img");
      thumbnail.className = className;
      thumbnail.alt = "";
      thumbnail.loading = "lazy";
      thumbnail.decoding = "async";
      thumbnail.referrerPolicy = "no-referrer";
      thumbnail.addEventListener("load", () => {
        // The decoded image remains usable after its short-lived Blob URL is released.
        setTimeout(revoke, 0);
      }, { once: true });
      thumbnail.addEventListener("error", () => {
        revoke();
        if (thumbnail.isConnected) thumbnail.replaceWith(fallback);
      }, { once: true });

      fallback.replaceWith(thumbnail);
      thumbnail.src = objectUrl;
    } catch (error) {
      revoke();
      throw error;
    }
  }).catch(() => {
    // Keep the media-type tile when the server rejects the request or the file
    // is not a bounded image. A missing poster must not disrupt media actions.
  });

  return fallback;
}

export { DEFAULT_MAX_THUMBNAIL_BYTES };
