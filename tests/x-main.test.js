import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../extension/content/x-main.js", import.meta.url), "utf8");

function loadObserver() {
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, URL });
  vm.runInContext(source, context, { filename: "x-main.js" });
  return module.exports;
}

test("X response observer selects only the highest-bitrate progressive MP4", () => {
  const observer = loadObserver();
  const hls = "https://video.twimg.com/ext_tw_video/2000000000000000000/pu/pl/master.m3u8?tag=12";
  const low = "https://video.twimg.com/ext_tw_video/2000000000000000000/pu/vid/avc1/640x360/low.mp4?tag=12";
  const high = "https://video.twimg.com/ext_tw_video/2000000000000000000/pu/vid/avc1/1920x1080/high.mp4?tag=12#ignored";
  const items = observer.extractProgressiveVideos({
    data: {
      tweet: {
        legacy: {
          extended_entities: {
            media: [{
              video_info: {
                variants: [
                  { content_type: "application/x-mpegURL", url: hls },
                  { content_type: "video/mp4", bitrate: 256_000, url: low },
                  { content_type: "video/mp4", bitrate: 4_800_000, url: high }
                ]
              }
            }]
          }
        }
      }
    }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(items)), [{
    url: high.replace("#ignored", ""),
    contentType: "video/mp4",
    bandwidth: 4_800_000,
    width: 1920,
    height: 1080
  }]);
});

test("X response observer rejects non-video.twimg.com, credentials, HTTP and MIME confusion", () => {
  const observer = loadObserver();
  const items = observer.extractProgressiveVideos({
    video_info: {
      variants: [
        { content_type: "video/mp4", bitrate: 9_000_000, url: "https://video.twimg.com.evil.test/file.mp4" },
        { content_type: "video/mp4", bitrate: 8_000_000, url: "https://user:pass@video.twimg.com/file.mp4" },
        { content_type: "video/mp4", bitrate: 7_000_000, url: "http://video.twimg.com/file.mp4" },
        { content_type: "application/x-mpegURL", bitrate: 6_000_000, url: "https://video.twimg.com/master.m3u8" },
        { content_type: "video/mp4", bitrate: 5_000_000, url: "https://video.twimg.com/good.mp4" }
      ]
    }
  });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://video.twimg.com/good.mp4");
  assert.equal(observer.progressiveUrl("https://sub.video.twimg.com/file.mp4"), null);
});

test("X response observer is bounded, cycle-safe and accepts only X API response URLs", () => {
  const observer = loadObserver();
  const cyclic = { child: null };
  cyclic.child = cyclic;
  assert.equal(observer.extractProgressiveVideos(cyclic).length, 0);
  assert.equal(observer.isXApiResponseUrl("https://x.com/i/api/graphql/abc/TweetDetail"), true);
  assert.equal(observer.isXApiResponseUrl("https://api.twitter.com/2/timeline"), true);
  assert.equal(observer.isXApiResponseUrl("https://x.com.evil.test/graphql"), false);
  assert.equal(observer.isXApiResponseUrl("http://x.com/graphql"), false);
});

test("X response observer binds candidates to the status id in the current route", () => {
  const observer = loadObserver();
  const current = "https://video.twimg.com/ext_tw_video/2000000000000000000/pu/vid/current.mp4";
  const recommendation = "https://video.twimg.com/ext_tw_video/3000000000000000000/pu/vid/recommendation.mp4";
  const payload = {
    data: {
      current: {
        rest_id: "2000000000000000000",
        legacy: { extended_entities: { media: [{ video_info: { variants: [
          { content_type: "video/mp4", bitrate: 2_000_000, url: current }
        ] } }] } }
      },
      recommendation: {
        rest_id: "3000000000000000000",
        legacy: { extended_entities: { media: [{ video_info: { variants: [
          { content_type: "video/mp4", bitrate: 9_000_000, url: recommendation }
        ] } }] } }
      }
    }
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(observer.extractProgressiveVideos(payload, "2000000000000000000"))).map((item) => item.url),
    [current]
  );
  assert.equal(observer.extractProgressiveVideos(payload, "9999999999999999999").length, 0);
  assert.equal(observer.statusIdForPath("/fluxcatch/status/2000000000000000000/photo/1"), "2000000000000000000");
  assert.equal(observer.statusIdForPath("/home"), "");
});

test("manifest registers the observer only in X top frames and in MAIN world", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  const registration = manifest.content_scripts.find((item) => item.js?.includes("content/x-main.js"));
  assert.ok(registration);
  assert.equal(registration.world, "MAIN");
  assert.equal(registration.run_at, "document_start");
  assert.notEqual(registration.all_frames, true);
  assert.deepEqual(registration.matches.sort(), [
    "https://*.twitter.com/*",
    "https://*.x.com/*",
    "https://twitter.com/*",
    "https://x.com/*"
  ].sort());
});
