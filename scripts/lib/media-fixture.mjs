// A local media page for the design audit, so the popup and side panel can be
// captured with real detection results instead of their empty states.
//
// The server listens on 127.0.0.1 and Chrome reaches it under a public-style
// name through --host-resolver-rules (see MEDIA_FIXTURE_HOST). FluxCatch's
// network policy judges hostnames, so the page is treated like any website;
// nothing leaves the machine.
//
// What the page offers, so detection finds three kinds of media:
// - a direct MP4 (<video preload>) from a second host, answered with 206 and a Content-Range
//   total of 812 MB, so the size shows without serving the bytes;
// - a direct M4A (<audio preload>), 48.3 MB the same way;
// - an HLS stream fetched by page script: a master playlist with 1080p and
//   720p variants and VOD media playlists of 58 minutes.
import http from "node:http";

export const MEDIA_FIXTURE_HOST = "lectures.example.org";
// The direct MP4 comes from another site, as from a CDN: FluxCatch hides a
// same-site direct MP4 when a stream ladder exists (suppressRedundantVideoCandidates).
export const MEDIA_FIXTURE_CDN_HOST = "media.example.net";
export const MEDIA_FIXTURE_PATH = "/watch/lecture-12";
// A page with text and no media: what the popup and side panel see on most sites.
export const BLANK_FIXTURE_PATH = "/notes/reading-list";

const MP4_TOTAL = 812_000_000;
const M4A_TOTAL = 48_300_000;
const SEGMENT_SECONDS = 6;
const SEGMENTS = 580; // 58 minutes

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lecture 12 · Pharmacokinetics</title>
<meta property="og:title" content="Lecture 12 · Pharmacokinetics">
</head>
<body>
<h1>Lecture 12 · Pharmacokinetics</h1>
<video src="http://${MEDIA_FIXTURE_CDN_HOST}/media/lecture-12-pharmacokinetics.mp4" preload="auto" muted playsinline width="640" height="360"></video>
<audio src="/media/lecture-12-audio.m4a" preload="auto"></audio>
<script>fetch("/media/hls/master.m3u8").then((r) => r.text()).catch(() => {});</script>
</body>
</html>`;

const BLANK_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Reading list</title></head>
<body><h1>Reading list</h1><p>Chapter 4: absorption and distribution.</p></body>
</html>`;

function masterPlaylist() {
  return [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    '#EXT-X-STREAM-INF:BANDWIDTH=5000000,AVERAGE-BANDWIDTH=4500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"',
    "1080p/index.m3u8",
    '#EXT-X-STREAM-INF:BANDWIDTH=2800000,AVERAGE-BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
    "720p/index.m3u8",
    ""
  ].join("\n");
}

function mediaPlaylist() {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3", `#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`, "#EXT-X-MEDIA-SEQUENCE:0", "#EXT-X-PLAYLIST-TYPE:VOD"];
  for (let index = 0; index < SEGMENTS; index += 1) lines.push(`#EXTINF:${SEGMENT_SECONDS}.0,`, `segment-${String(index).padStart(5, "0")}.ts`);
  lines.push("#EXT-X-ENDLIST", "");
  return lines.join("\n");
}

function sendRanged(request, response, total, type) {
  // Answer every request as a ranged slice of a large object: a small body,
  // with the full size in Content-Range so the extension learns it.
  const match = /^bytes=(\d+)-(\d*)$/.exec(String(request.headers.range || ""));
  const start = match ? Math.min(Number(match[1]), total - 1) : 0;
  const end = Math.min(start + 4095, total - 1);
  const body = Buffer.alloc(end - start + 1);
  response.writeHead(206, {
    "Content-Type": type,
    "Content-Length": String(body.length),
    "Content-Range": `bytes ${start}-${end}/${total}`,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store"
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function handle(request, response) {
  const url = new URL(request.url, "http://fixture");
  const pathname = url.pathname;
  if (pathname === BLANK_FIXTURE_PATH) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(BLANK_PAGE);
    return;
  }
  if (pathname === MEDIA_FIXTURE_PATH) {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    response.end(PAGE);
    return;
  }
  if (pathname === "/media/lecture-12-pharmacokinetics.mp4") return sendRanged(request, response, MP4_TOTAL, "video/mp4");
  if (pathname === "/media/lecture-12-audio.m4a") return sendRanged(request, response, M4A_TOTAL, "audio/mp4");
  if (pathname === "/media/hls/master.m3u8") {
    response.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
    response.end(masterPlaylist());
    return;
  }
  if (/^\/media\/hls\/(1080p|720p)\/index\.m3u8$/.test(pathname)) {
    response.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
    response.end(mediaPlaylist());
    return;
  }
  if (/^\/media\/hls\/(1080p|720p)\/segment-\d{5}\.ts$/.test(pathname)) {
    response.writeHead(200, { "Content-Type": "video/mp2t", "Content-Length": "188", "Cache-Control": "no-store" });
    response.end(request.method === "HEAD" ? undefined : Buffer.alloc(188));
    return;
  }
  response.writeHead(404, { "Content-Type": "text/plain" });
  response.end("not found");
}

/**
 * Start the fixture server. Returns the Chrome flag that maps the public-style
 * host to it, the page URL, and close().
 */
export async function startMediaFixture() {
  const server = http.createServer(handle);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    port,
    // Chrome would otherwise upgrade the http navigation to https first, and
    // headless Chrome reports the failed upgrade instead of falling back.
    chromeArgs: [
      `--host-resolver-rules=MAP ${MEDIA_FIXTURE_HOST} 127.0.0.1:${port},MAP ${MEDIA_FIXTURE_CDN_HOST} 127.0.0.1:${port}`,
      "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,HttpsFirstModeV2ForEngagedSites"
    ],
    pageUrl: `http://${MEDIA_FIXTURE_HOST}${MEDIA_FIXTURE_PATH}`,
    blankUrl: `http://${MEDIA_FIXTURE_HOST}${BLANK_FIXTURE_PATH}`,
    close: () => new Promise((resolve) => server.close(() => resolve()))
  };
}
