// Speed graph and segment map for the active-download card. Pure DOM/SVG
// builders with no page state: pages keep a short ring of samples per job and
// call `renderSpeedGraph(container, samples)` on every update.
//
// The graph is an area chart in pond fading to transparent with gridlines in
// the soft line colour, and a mirrored, blurred, faint copy beneath it (the
// one literal "water" in the interface). The segment map is a field of short
// dashes in pond and celadon, kept low contrast.

export const SPEED_SAMPLE_LIMIT = 48;

const SVG_NS = "http://www.w3.org/2000/svg";

/** Append a speed sample (bytes per second) to a bounded ring. */
export function pushSpeedSample(ring, speed, limit = SPEED_SAMPLE_LIMIT) {
  const list = Array.isArray(ring) ? ring : [];
  list.push(Math.max(0, Number(speed) || 0));
  while (list.length > limit) list.shift();
  return list;
}

function element(name, attributes = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  parent?.append(node);
  return node;
}

function pathFor(samples, width, height, pad) {
  const count = samples.length;
  const peak = Math.max(1, ...samples);
  const innerWidth = width - pad * 2;
  const innerHeight = height - pad * 2;
  const step = count > 1 ? innerWidth / (count - 1) : innerWidth;
  const points = samples.map((value, index) => [
    pad + (count > 1 ? index * step : innerWidth),
    pad + innerHeight - (value / peak) * innerHeight
  ]);
  if (count === 1) points.unshift([pad, points[0][1]]);
  const line = points.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const first = points[0];
  const last = points[points.length - 1];
  const area = `${line} L${last[0].toFixed(1)} ${(height - pad).toFixed(1)} L${first[0].toFixed(1)} ${(height - pad).toFixed(1)} Z`;
  return { line, area };
}

/**
 * Build or update a speed graph inside `container`. The container ends up as
 * `.fc-reflection` holding the chart and its reflection; the gradient id is
 * unique per graph so several charts can share a page.
 */
export function renderSpeedGraph(container, samples, { width = 320, height = 64, label = "下载速度" } = {}) {
  if (!container) return null;
  const values = (Array.isArray(samples) ? samples : []).map((value) => Math.max(0, Number(value) || 0));
  if (values.length === 0) values.push(0);
  const pad = 2;
  const { line, area } = pathFor(values, width, height, pad);
  let chart = container.querySelector(".fc-speed");
  let copy = container.querySelector(".fc-reflection-copy");
  if (!chart) {
    container.classList.add("fc-reflection");
    container.replaceChildren();
    const id = `fc-speed-fill-${Math.random().toString(36).slice(2, 8)}`;
    chart = element("svg", { class: "fc-speed", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none", role: "img" }, container);
    chart.dataset.gradient = id;
    const title = element("title", {}, chart);
    title.textContent = label;
    const defs = element("defs", {}, chart);
    const gradient = element("linearGradient", { id, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    // stop-color must be a style property for var() to resolve.
    element("stop", { offset: "0%", style: "stop-color:var(--pond);stop-opacity:.38" }, gradient);
    element("stop", { offset: "100%", style: "stop-color:var(--pond);stop-opacity:0" }, gradient);
    for (const fraction of [0.25, 0.5, 0.75]) {
      const y = (pad + (height - pad * 2) * fraction).toFixed(1);
      element("line", { class: "grid", x1: pad, x2: width - pad, y1: y, y2: y }, chart);
    }
    const areaPath = element("path", { class: "area", d: area }, chart);
    areaPath.setAttribute("fill", `url(#${id})`);
    element("path", { class: "line", d: line }, chart);
    copy = chart.cloneNode(true);
    copy.classList.remove("fc-speed");
    copy.classList.add("fc-speed", "fc-reflection-copy");
    copy.setAttribute("aria-hidden", "true");
    copy.querySelector("title")?.remove();
    container.append(copy);
  }
  for (const node of [chart, copy]) {
    if (!node) continue;
    node.querySelector(".area")?.setAttribute("d", area);
    node.querySelector(".line")?.setAttribute("d", line);
  }
  const latest = values[values.length - 1];
  chart.setAttribute("aria-label", `${label}：${formatRate(latest)}`);
  return chart;
}

/**
 * Build or update a segment map: `done` of `total` short dashes filled in
 * celadon, the ones in flight in pond-soft, the rest in a pond tint. Large
 * totals are folded into at most `maximum` dashes.
 */
export function renderSegmentMap(container, { done = 0, total = 0, active = 0 } = {}, { maximum = 48, label = "分片进度" } = {}) {
  if (!container) return null;
  const totalCount = Math.max(0, Math.floor(Number(total) || 0));
  if (totalCount === 0) {
    container.replaceChildren();
    container.hidden = true;
    return null;
  }
  const buckets = Math.min(maximum, totalCount);
  const doneCount = Math.min(totalCount, Math.max(0, Math.floor(Number(done) || 0)));
  const activeCount = Math.min(totalCount - doneCount, Math.max(0, Math.floor(Number(active) || 0)));
  const doneBuckets = Math.round((doneCount / totalCount) * buckets);
  const activeBuckets = Math.min(buckets - doneBuckets, Math.max(activeCount > 0 ? 1 : 0, Math.round((activeCount / totalCount) * buckets)));
  container.hidden = false;
  container.classList.add("fc-segments");
  container.setAttribute("role", "img");
  container.setAttribute("aria-label", `${label}：${doneCount}/${totalCount}`);
  const dashes = [...container.children];
  while (dashes.length < buckets) {
    const dash = document.createElement("i");
    container.append(dash);
    dashes.push(dash);
  }
  while (dashes.length > buckets) dashes.pop().remove();
  dashes.forEach((dash, index) => {
    dash.className = index < doneBuckets ? "done" : index < doneBuckets + activeBuckets ? "active" : "";
  });
  return container;
}

/** Parse the engine's "分片 12/48" progress message into a segment count.
    Only the 分片 form counts, so byte summaries like "1.2 MB / 5 MB" never
    turn into a segment map. */
export function segmentsFromMessage(message) {
  const match = /分片\s*(\d+)\s*\/\s*(\d+)/.exec(String(message || ""));
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return { done, total };
}

export function formatRate(bytesPerSecond) {
  const value = Math.max(0, Number(bytesPerSecond) || 0);
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB/s`;
  return `${Math.round(value)} B/s`;
}
