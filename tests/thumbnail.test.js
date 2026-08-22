import test from "node:test";
import assert from "node:assert/strict";
import { fetchThumbnailBlob } from "../extension/lib/thumbnail.js";

test("thumbnail fetch uses an allowlisted origin, omits credentials and rejects redirects", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return new Response(new Uint8Array([137, 80, 78, 71]), {
      status: 200,
      headers: {
        "content-type": "image/png; charset=binary",
        "content-length": "4"
      }
    });
  };

  const blob = await fetchThumbnailBlob(
    "https://images.example.test/poster.png#private",
    { fetchImpl, pageUrl: "https://images.example.test/watch" }
  );

  assert.equal(request.url, "https://images.example.test/poster.png");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  assert.equal(request.options.cache, "force-cache");
  assert.equal(request.options.redirect, "error");
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 4);
});

test("thumbnail fetch fails closed without worker-derived policy context", async () => {
  await assert.rejects(
    fetchThumbnailBlob("https://images.example.test/poster.png", {
      fetchImpl: async () => { throw new Error("must_not_fetch"); }
    }),
    /thumbnail_origin_not_allowlisted/
  );
  await assert.rejects(
    fetchThumbnailBlob("https://preview-user:preview-pass@images.example.test/poster.png", {
      pageUrl: "https://images.example.test/watch",
      fetchImpl: async () => { throw new Error("must_not_fetch"); }
    }),
    /invalid_thumbnail_url/
  );
  await assert.rejects(
    fetchThumbnailBlob("http://127.0.0.1/poster.png", {
      pageUrl: "http://127.0.0.1/watch",
      fetchImpl: async () => { throw new Error("must_not_fetch"); }
    }),
    /blocked_private/
  );
});

test("thumbnail redirect targets are rechecked and cannot reach a private address", async () => {
  await assert.rejects(
    fetchThumbnailBlob("https://images.example.test/poster.png", {
      pageUrl: "https://images.example.test/watch",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "http://127.0.0.1/private.png?token=REDIRECT_SECRET",
        headers: { get: () => "image/png" },
        body: { cancel: async () => {} }
      })
    }),
    (error) => /thumbnail_redirect_rejected/.test(error.message) && !/REDIRECT_SECRET|token/.test(error.message)
  );

  await assert.rejects(
    fetchThumbnailBlob("https://images.example.test/poster.png", {
      pageUrl: "https://images.example.test/watch",
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        url: "https://cdn.example.test/public-poster.png",
        headers: { get: () => "image/png" },
        body: { cancel: async () => {} }
      })
    }),
    /thumbnail_redirect_rejected/,
    "even a public cross-origin final URL is rejected instead of changing policy purpose"
  );
});

test("thumbnail fetch rejects non-images and oversized response bodies", async () => {
  await assert.rejects(
    fetchThumbnailBlob("https://images.example.test/not-an-image", {
      pageUrl: "https://images.example.test/watch",
      fetchImpl: async () => new Response("text", {
        status: 200,
        headers: { "content-type": "text/plain" }
      })
    }),
    /thumbnail_not_image/
  );

  await assert.rejects(
    fetchThumbnailBlob("https://images.example.test/too-large.jpg", {
      maxBytes: 3,
      pageUrl: "https://images.example.test/watch",
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      })
    }),
    /thumbnail_too_large/
  );
});
