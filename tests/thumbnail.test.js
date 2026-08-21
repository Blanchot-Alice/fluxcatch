import test from "node:test";
import assert from "node:assert/strict";
import { fetchThumbnailBlob } from "../extension/lib/thumbnail.js";

test("thumbnail fetch strips URL credentials and omits ambient credentials", async () => {
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
    "https://preview-user:preview-pass@images.example.test/poster.png#private",
    { fetchImpl }
  );

  assert.equal(request.url, "https://images.example.test/poster.png");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  assert.equal(request.options.cache, "force-cache");
  assert.equal(blob.type, "image/png");
  assert.equal(blob.size, 4);
});

test("thumbnail fetch rejects non-images and oversized response bodies", async () => {
  await assert.rejects(
    fetchThumbnailBlob("https://images.example.test/not-an-image", {
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
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/jpeg" }
      })
    }),
    /thumbnail_too_large/
  );
});
