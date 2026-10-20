// Component preview: renders the section-8 component set into the Morning and
// Dusk panes, wires the density / motion / page-theme toggles, and runs a
// simulated download so the progress gradient, completion cross-fade, speed
// graph and segment map can be judged in motion.
import { pushSpeedSample, renderSegmentMap, renderSpeedGraph, formatRate } from "../ui/speed-graph.js";

const TOTAL_BYTES = 812 * 1024 * 1024;
const SEGMENTS = 96;
const DURATION_MS = 14_000;

const template = document.querySelector("#componentTemplate");
const panes = [...document.querySelectorAll(".pane-body")];
const root = document.documentElement;
const demos = [];

function mount() {
  for (const pane of panes) {
    pane.replaceChildren(template.content.cloneNode(true));
    const bars = [...pane.querySelectorAll("[data-demo-bar]")];
    const demo = {
      pane,
      bars,
      bytes: [...pane.querySelectorAll("[data-demo-bytes]")],
      speeds: [...pane.querySelectorAll("[data-demo-speed]")],
      etas: [...pane.querySelectorAll("[data-demo-eta]")],
      percent: pane.querySelector("[data-demo-percent]"),
      state: pane.querySelector("[data-demo-state]"),
      liveRow: pane.querySelector('[data-demo="live"]'),
      liveState: pane.querySelector('[data-demo="live"] .pv-state'),
      pause: pane.querySelector("[data-demo-pause]"),
      graph: pane.querySelector("[data-demo-graph]"),
      segments: pane.querySelector("[data-demo-segments]"),
      samples: [],
      paused: false,
      startedAt: 0,
      pausedFor: 0,
      pausedAt: 0,
      done: false
    };
    demo.pause?.addEventListener("click", () => togglePause(demo));
    demos.push(demo);
  }
}

function togglePause(demo) {
  if (demo.done) return;
  demo.paused = !demo.paused;
  const now = performance.now();
  if (demo.paused) demo.pausedAt = now;
  else demo.pausedFor += now - demo.pausedAt;
  demo.liveRow?.classList.toggle("is-paused", demo.paused);
  demo.liveRow?.classList.toggle("is-live", !demo.paused);
  for (const bar of demo.bars) bar.classList.toggle("is-paused", demo.paused);
  if (demo.liveState) {
    demo.liveState.textContent = demo.paused ? "‖ 已暂停" : "下载中";
    demo.liveState.classList.toggle("paused", demo.paused);
  }
  if (demo.state) demo.state.textContent = demo.paused ? "‖ 已暂停" : "下载中";
  const label = demo.pause?.querySelector("span");
  if (label) label.textContent = demo.paused ? "继续" : "暂停";
}

function reset(demo) {
  demo.samples = [];
  demo.paused = false;
  demo.pausedFor = 0;
  demo.done = false;
  demo.startedAt = performance.now();
  demo.liveRow?.classList.remove("is-paused", "is-complete");
  demo.liveRow?.classList.add("is-live");
  for (const bar of demo.bars) {
    bar.classList.remove("is-paused", "is-complete");
    bar.setAttribute("aria-valuenow", "0");
    bar.firstElementChild.style.width = "0%";
  }
  if (demo.liveState) { demo.liveState.textContent = "下载中"; demo.liveState.className = "pv-state"; }
  if (demo.state) { demo.state.textContent = "下载中"; demo.state.className = "pv-state"; }
  const label = demo.pause?.querySelector("span");
  if (label) label.textContent = "暂停";
  renderSpeedGraph(demo.graph, demo.samples);
  renderSegmentMap(demo.segments, { done: 0, total: SEGMENTS, active: 8 });
}

function complete(demo) {
  demo.done = true;
  demo.liveRow?.classList.remove("is-live");
  demo.liveRow?.classList.add("is-complete");
  for (const bar of demo.bars) {
    bar.classList.add("is-complete");
    bar.setAttribute("aria-valuenow", "100");
    bar.firstElementChild.style.width = "100%";
  }
  if (demo.liveState) { demo.liveState.textContent = "✓ 已完成"; demo.liveState.className = "pv-state done"; }
  if (demo.state) { demo.state.textContent = "✓ 已完成"; demo.state.className = "pv-state done"; }
  for (const node of demo.speeds) node.textContent = "—";
  for (const node of demo.etas) node.textContent = "已保存";
  renderSegmentMap(demo.segments, { done: SEGMENTS, total: SEGMENTS, active: 0 });
}

function megabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 100 * 1024 * 1024 ? 0 : 1)} MB`;
}

// A frozen mid-transfer frame for screenshots (?demo=static): a fixed speed
// history, 62% done, so the graph, segment map and figures are deterministic.
const STATIC_WAVE = [0.2, 0.42, 0.55, 0.63, 0.7, 0.66, 0.74, 0.8, 0.78, 0.86, 0.9, 0.84, 0.88, 0.95, 0.92, 0.97, 0.93, 0.9, 0.96, 1, 0.94, 0.9, 0.95, 0.97];

function seedStatic(demo) {
  const base = TOTAL_BYTES / (DURATION_MS / 1000);
  const fraction = 0.62;
  demo.samples = STATIC_WAVE.map((value) => base * value);
  demo.done = true;
  const speed = demo.samples[demo.samples.length - 1];
  const bytes = TOTAL_BYTES * fraction;
  for (const bar of demo.bars) {
    bar.setAttribute("aria-valuenow", "62");
    bar.firstElementChild.style.width = "62%";
  }
  for (const node of demo.bytes) node.textContent = megabytes(bytes);
  for (const node of demo.speeds) node.textContent = formatRate(speed);
  for (const node of demo.etas) node.textContent = "剩余 0:05";
  if (demo.percent) demo.percent.textContent = "62%";
  renderSpeedGraph(demo.graph, demo.samples);
  renderSegmentMap(demo.segments, { done: Math.floor(fraction * SEGMENTS), total: SEGMENTS, active: 8 });
}

let loopRunning = false;

function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  requestAnimationFrame(tick);
}

function tick(now) {
  for (const demo of demos) {
    if (demo.done || demo.paused) continue;
    const elapsed = now - demo.startedAt - demo.pausedFor;
    const fraction = Math.min(1, elapsed / DURATION_MS);
    // A believable curve: ramps up, wavers like light on water, settles.
    const wave = 0.8 + 0.2 * Math.sin(elapsed / 420) + 0.12 * Math.sin(elapsed / 97);
    const speed = (TOTAL_BYTES / (DURATION_MS / 1000)) * (fraction < 0.1 ? fraction * 10 : 1) * wave;
    const bytes = TOTAL_BYTES * fraction;
    const percent = Math.round(fraction * 100);
    for (const bar of demo.bars) {
      bar.setAttribute("aria-valuenow", String(percent));
      bar.firstElementChild.style.width = `${fraction * 100}%`;
    }
    for (const node of demo.bytes) node.textContent = megabytes(bytes);
    for (const node of demo.speeds) node.textContent = formatRate(speed);
    const remaining = speed > 0 ? Math.max(0, (TOTAL_BYTES - bytes) / speed) : 0;
    for (const node of demo.etas) node.textContent = `剩余 0:${String(Math.ceil(remaining)).padStart(2, "0")}`;
    if (demo.percent) demo.percent.textContent = `${percent}%`;
    if (!demo.lastSample || now - demo.lastSample > 250) {
      demo.lastSample = now;
      pushSpeedSample(demo.samples, speed);
      renderSpeedGraph(demo.graph, demo.samples);
      renderSegmentMap(demo.segments, { done: Math.floor(fraction * SEGMENTS), total: SEGMENTS, active: fraction < 1 ? 8 : 0 });
    }
    if (fraction >= 1) complete(demo);
  }
  requestAnimationFrame(tick);
}

function bindControls() {
  const density = document.querySelector("#densitySelect");
  const motion = document.querySelector("#motionSelect");
  const theme = document.querySelector("#themeSelect");
  const replay = document.querySelector("#replayButton");
  const params = new URLSearchParams(location.search);
  if (params.get("density")) density.value = params.get("density");
  if (params.get("motion")) motion.value = params.get("motion");
  if (params.get("theme")) theme.value = params.get("theme");
  const apply = () => {
    if (density.value === "compact") root.dataset.density = "compact";
    else delete root.dataset.density;
    if (motion.value === "reduced") root.dataset.motion = "reduced";
    else delete root.dataset.motion;
    if (theme.value === "system") delete root.dataset.theme;
    else root.dataset.theme = theme.value;
  };
  density.addEventListener("change", apply);
  motion.addEventListener("change", apply);
  theme.addEventListener("change", () => {
    // The light changing, not the UI flipping: cross-fade every token-bound
    // colour over --motion-theme, then drop the transition again.
    root.classList.add("fc-theme-fading");
    apply();
    const duration = root.dataset.motion === "reduced" ? 200 : 800;
    setTimeout(() => root.classList.remove("fc-theme-fading"), duration + 50);
  });
  replay.addEventListener("click", () => {
    demos.forEach(reset);
    startLoop();
  });
  apply();
  return params.get("demo") === "static";
}

mount();
const staticDemo = bindControls();
demos.forEach(reset);
if (staticDemo) demos.forEach(seedStatic);
else startLoop();
