import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyNetworkHost,
  evaluateNetworkRequest,
  isBilibiliMetadataEndpoint,
  redactNetworkUrl,
  requireNetworkRequest
} from "../extension/lib/network-policy.js";

const request = (url, overrides = {}) => evaluateNetworkRequest({
  url,
  purpose: "user_download",
  provenance: "user_supplied",
  networkScope: "public_only",
  userInitiated: true,
  ...overrides
});

test("network policy rejects local and non-public targets by default", () => {
  for (const url of [
    "http://127.0.0.1/video.mp4",
    "http://localhost/video.mp4",
    "http://localhost.localdomain/video.mp4",
    "http://[::1]/video.mp4",
    "http://10.0.0.1/video.mp4",
    "http://172.16.0.1/video.mp4",
    "http://192.168.0.1/video.mp4",
    "http://169.254.169.254/latest/meta-data",
    "http://100.100.100.200/latest/meta-data",
    "http://[fc00::1]/video.mp4",
    "http://[fe80::1]/video.mp4",
    "http://[::7f00:1]/video.mp4",
    "http://[64:ff9b::7f00:1]/video.mp4",
    "http://[64:ff9b::a9fe:a9fe]/latest/meta-data",
    "http://[64:ff9b:1::7f00:1]/video.mp4",
    "http://[64:ff9b:1:7f00:0:100::]/video.mp4",
    "http://[2002:7f00:1::]/video.mp4",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/video.mp4",
    "http://[5f00::1]/video.mp4",
    "http://[100:0:0:1::1]/video.mp4",
    "http://[4000::1]/video.mp4",
    "http://0.0.0.0/video.mp4",
    "http://224.0.0.1/video.mp4"
  ]) assert.equal(request(url).allowed, false, url);

  assert.equal(request("https://media.example.com/video.mp4").allowed, true);
  assert.equal(classifyNetworkHost("127.0.0.1").category, "private");
  assert.equal(classifyNetworkHost("::ffff:127.0.0.1").category, "private");
  assert.equal(classifyNetworkHost("::7f00:1").category, "private");
  assert.equal(classifyNetworkHost("64:ff9b::7f00:1").category, "private");
  assert.equal(classifyNetworkHost("64:ff9b:1:7f00:0:100::").category, "private");
  assert.equal(classifyNetworkHost("64:ff9b:1:808:8:800::").category, "public");
  assert.equal(classifyNetworkHost("64:ff9b:1::7f00:1").category, "reserved");
  assert.equal(classifyNetworkHost("2002:7f00:1::").category, "private");
  assert.equal(classifyNetworkHost("2001:0:4136:e378:8000:63bf:3fff:fdd2").category, "reserved");
  assert.equal(classifyNetworkHost("64:ff9b::808:808").category, "public");
});

test("private opt-in permits local media but never metadata, link-local or reserved targets", () => {
  for (const url of [
    "http://127.0.0.1/video.mp4",
    "http://localhost/video.mp4",
    "http://localhost.localdomain/video.mp4",
    "http://[::1]/video.mp4",
    "http://10.0.0.1/video.mp4",
    "http://172.16.0.1/video.mp4",
    "http://192.168.0.1/video.mp4",
    "http://[fc00::1]/video.mp4",
    "http://media-server/video.mp4"
  ]) assert.equal(request(url, { networkScope: "private_network_opt_in" }).allowed, true, url);

  for (const url of [
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.1.2/video.mp4",
    "http://[fe80::1]/video.mp4",
    "http://0.0.0.0/video.mp4",
    "http://198.51.100.5/video.mp4",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://metadata/latest/meta-data",
    "http://instance-data/latest/meta-data",
    "http://instance-data.ec2.internal/latest/meta-data",
    "http://[fec0::1]/video.mp4",
    "http://[100::1]/video.mp4",
    "http://[3fff::1]/video.mp4",
    "http://[64:ff9b::a9fe:a9fe]/latest/meta-data",
    "http://[2002:a9fe:a9fe::]/latest/meta-data",
    "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/video.mp4"
  ]) assert.equal(request(url, { networkScope: "private_network_opt_in" }).allowed, false, url);
});

test("automatic manifest probes require a browser-observed response", () => {
  const base = {
    url: "https://media.example.com/master.m3u8",
    purpose: "manifest_probe",
    automatic: true
  };
  assert.equal(evaluateNetworkRequest({ ...base, provenance: "observed_response" }).allowed, true);
  assert.equal(evaluateNetworkRequest({ ...base, provenance: "dom_media_element" }).reason, "automatic_probe_requires_observed_response");
  assert.equal(evaluateNetworkRequest({ ...base, provenance: "site_payload" }).allowed, false);
});

test("site metadata is pinned to fixed Bilibili endpoints", () => {
  const good = "https://api.bilibili.com/x/player/playurl?bvid=BV1fixture&cid=1&qn=127&fnval=16&fourk=1";
  assert.equal(isBilibiliMetadataEndpoint(good), true);
  assert.equal(evaluateNetworkRequest({
    url: good,
    purpose: "site_metadata",
    provenance: "fixed_site_api"
  }).allowed, true);
  assert.equal(evaluateNetworkRequest({
    url: "https://api.bilibili.com/x/space/wbi/acc/info?mid=1",
    purpose: "site_metadata",
    provenance: "fixed_site_api"
  }).allowed, false);
  assert.equal(evaluateNetworkRequest({
    url: good,
    purpose: "site_metadata",
    provenance: "site_payload"
  }).allowed, false);
});

test("thumbnail policy requires a worker-derived origin or adapter image host", () => {
  const base = {
    purpose: "thumbnail",
    provenance: "dom_metadata",
    pageUrl: "https://page.example.com/watch",
    observedMediaUrls: ["https://media.example.com/video.mp4"],
    adapterImageHosts: ["biliimg.com"]
  };
  assert.equal(evaluateNetworkRequest({ ...base, url: "https://page.example.com/poster.jpg" }).allowed, true);
  assert.equal(evaluateNetworkRequest({ ...base, url: "https://media.example.com/poster.jpg" }).allowed, true);
  assert.equal(evaluateNetworkRequest({ ...base, url: "https://i0.biliimg.com/poster.jpg" }).allowed, true);
  assert.equal(evaluateNetworkRequest({ ...base, url: "https://attacker.example/poster.jpg" }).allowed, false);
  assert.equal(evaluateNetworkRequest({ ...base, url: "http://127.0.0.1/poster.jpg" }).allowed, false);
  assert.equal(evaluateNetworkRequest({ ...base, url: "https://user:pass@page.example.com/poster.jpg" }).reason, "embedded_credentials");
});

test("network errors redact queries and credentials", () => {
  const secret = "https://user:pass@127.0.0.1/private/video.mp4?token=VERY_SECRET&deadline=99";
  assert.doesNotMatch(redactNetworkUrl(secret), /VERY_SECRET|token|deadline|user|pass/);
  assert.throws(
    () => requireNetworkRequest({
      url: secret,
      purpose: "user_download",
      provenance: "user_supplied",
      userInitiated: true
    }),
    (error) => !/VERY_SECRET|token|deadline|user|pass/.test(error.message)
  );
});
