// DownloadRow (design review §6.4, §6.7, §6.8) for every v2 surface: pure DOM
// builders plus update functions. No page state: callers pass the data and
// the handlers, and keep the returned views. Styles live in system.css
// (.row, .row-lead, .row-main, .row-trail, .row-actions, .focus-panel,
// .segment-map, .speed-chart).
//
// One grid per row: lead column (a frame on full pages, a glyph elsewhere) · text column
// (filename in `row`, meta and source in `meta`) · trailing cell (exception
// status, replaced by actions on hover, focus-within and selection), ending
// on the column's right edge. The grid follows --lead and --lead-gap, so the
// same row fits full pages (lead 56) and the popup and side panel (lead 32).
import { formatBytes, formatDuration, formatRate, formatRelativeTime, uiLanguage } from "./locale.js";
import { msg } from "./messages.js";
import { button, filename, icon, iconButton, progress, setProgress, status } from "./components.js";
import { classifyJobFailure, describeJobActivity, describeJobFailure, segmentsFromActivity } from "../../lib/job-failure.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const AUDIO_FILE = /\.(mp3|m4a|aac|flac|wav|ogg|opus)$/i;
const STREAM_KINDS = new Set(["hls", "dash", "dash_pair"]);
const POSTER = /^data:image\/(png|jpe?g|webp);/;

// ---------- lead ----------

/** "audio" | "stream" | "video", from item.kind and the filename. */
export function mediaKindOf(item) {
  const kind = String(item?.kind || "");
  if (kind === "audio" || AUDIO_FILE.test(item?.filename || "")) return "audio";
  if (STREAM_KINDS.has(kind)) return "stream";
  return "video";
}

/** The lead cell. On full pages (`poster` on, the default) it is the 56 × 32
 *  frame of v3 §3.5: the media's own thumbnail when item.thumbnail is a data:
 *  image, else the sunken ground with the 16px type glyph centred; an
 *  indicator, not a container. The popup and side panel pass poster: false
 *  and get the bare 20px type glyph. */
export function rowLead(item, { poster = true } = {}) {
  const lead = document.createElement("span");
  lead.className = "row-lead";
  if (!poster) {
    lead.append(icon(mediaKindOf(item)));
    return lead;
  }
  const frame = document.createElement("span");
  frame.className = "lead-frame";
  frame.dataset.indicator = "";
  if (typeof item?.thumbnail === "string" && POSTER.test(item.thumbnail)) {
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.src = item.thumbnail;
    frame.append(image);
  } else {
    frame.append(icon(mediaKindOf(item)));
  }
  lead.append(frame);
  return lead;
}

// ---------- generic row ----------

/**
 * A row for anything that is not a history record or a live job, such as a
 * detected media item in the popup or side panel.
 * @param {object} o
 * @param {HTMLElement} [o.lead]   from rowLead(); defaults to a video glyph
 * @param {string}  o.title        filename or media title (middle-truncated)
 * @param {string}  [o.meta]       "MP4 · 1080p · 12 MB · 2:28"
 * @param {Node|string} [o.source] "youtube.com · 1 hr ago"; wrap user content in data-user-content
 * @param {HTMLElement} [o.status] status() for exceptions only
 * @param {HTMLElement[]} [o.actions] trailing buttons (tertiary + overflow)
 * @param {boolean} [o.actionsVisible] keep actions shown at rest (the row's core verb)
 * @param {string}  [o.tag]        "li" (default) or "div"
 * @param {string}  [o.id]         stored as data-item-id
 */
export function downloadRow({ lead, title, meta = "", source = "", status: statusNode = null, actions = [], actionsVisible = false, tag = "li", id = "" }) {
  const row = document.createElement(tag);
  row.className = "row";
  if (id) row.dataset.itemId = id;
  if (actionsVisible) row.dataset.actions = "visible";
  const main = document.createElement("div");
  main.className = "row-main";
  const titleLine = document.createElement("p");
  titleLine.className = "t-row row-title";
  titleLine.append(filename(title));
  main.append(titleLine);
  if (meta) {
    const metaLine = document.createElement("p");
    metaLine.className = "t-meta row-meta";
    metaLine.textContent = meta;
    main.append(metaLine);
  }
  if (source) {
    const sourceLine = document.createElement("p");
    sourceLine.className = "t-meta row-source";
    sourceLine.append(source);
    main.append(sourceLine);
  }
  const trail = document.createElement("div");
  trail.className = "row-trail";
  if (statusNode) trail.append(statusNode);
  const group = document.createElement("div");
  group.className = "row-actions";
  group.append(...actions);
  trail.append(group);
  row.append(lead || rowLead({}), main, trail);
  return row;
}

// ---------- history rows ----------

const FORMAT_NAMES = { mp4: "MP4", m4v: "MP4", m4a: "M4A", mp3: "MP3", webm: "WebM", mkv: "MKV", mov: "MOV", aac: "AAC", flac: "FLAC", wav: "WAV", ogg: "OGG", opus: "Opus", ts: "TS" };

/** Bytes of a record or job: total, then size, then bytes. */
export function recordBytes(record) {
  return Number(record.total) || Number(record.size) || Number(record.bytes) || 0;
}

/** "MP4", "M4A" … from the file extension, else the media container; "" when unknown. */
export function formatName(record) {
  const ext = (String(record.filename || "").match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase();
  const container = String(record.media?.container || "").toLowerCase();
  return FORMAT_NAMES[ext] || FORMAT_NAMES[container] || "";
}

/** The source host without "www.", from sourceHost or sourceUrl. */
export function sourceHost(record) {
  let host = record.sourceHost || "";
  if (!host && record.sourceUrl) { try { host = new URL(record.sourceUrl).hostname; } catch { host = ""; } }
  return host.replace(/^www\./i, "");
}

/** The localised reason line for a failed record (never raw engine text). */
export function recordFailureText(record) {
  const failure = classifyJobFailure({ text: record.error || record.message || "", status: record.status, nativeCode: record.code || "", browserReason: record.interruptReason || "" });
  return describeJobFailure(failure, uiLanguage());
}

/** "MP4 · 2160p · 2.4 GB · 2:28" for a completed record. */
export function completedMeta(record) {
  return [formatName(record), record.media?.height ? `${record.media.height}p` : "", formatBytes(recordBytes(record)), record.media?.duration ? formatDuration(record.media.duration) : ""].filter(Boolean).join(" · ");
}

/**
 * A history row (§6.4): completed rows carry no status; failed, cancelled and
 * missing files do. Actions: Open (or Retry) + overflow.
 * @param {object} record  a history record from GET_HISTORY
 * @param {object} o
 * @param {number} [o.now]       Date.now() for relative times
 * @param {boolean} [o.poster]   poster frames (full pages only)
 * @param {(action: "open"|"retry"|"more", record: object, button: HTMLButtonElement) => void} o.onAction
 */
export function historyRow(record, { now = Date.now(), poster = true, onAction = () => {} } = {}) {
  const row = document.createElement("li");
  row.className = "row";
  row.dataset.jobId = record.jobId;
  row.dataset.status = record.status;
  const main = document.createElement("div");
  main.className = "row-main";
  const title = document.createElement("p");
  title.className = "t-row row-title";
  title.append(filename(record.filename));
  main.append(title);
  const meta = document.createElement("p");
  meta.className = "t-meta row-meta";
  if (record.status === "completed") meta.textContent = completedMeta(record);
  else if (record.status === "failed") meta.textContent = recordFailureText(record);
  if (meta.textContent) main.append(meta);
  const source = document.createElement("p");
  source.className = "t-meta row-source";
  const host = sourceHost(record);
  if (host) {
    const hostNode = document.createElement("span");
    hostNode.dataset.userContent = "";
    hostNode.textContent = host;
    source.append(hostNode);
  }
  const when = formatRelativeTime(record.finishedAt || record.createdAt, now);
  if (when) source.append(document.createTextNode(`${host ? " · " : ""}${when}`));
  if (source.childNodes.length) main.append(source);

  const trail = document.createElement("div");
  trail.className = "row-trail";
  const missing = record.status === "completed" && record.fileMissing;
  if (record.status === "failed") trail.append(status("failed", msg("status.failed")));
  else if (record.status === "cancelled") trail.append(status("cancelled", msg("status.cancelled")));
  else if (missing) trail.append(status("warning", msg("status.missing")));
  const actions = document.createElement("div");
  actions.className = "row-actions";
  if (record.status === "completed" && record.hasFile && !missing) {
    const open = button({ kind: "tertiary", label: msg("action.open"), action: "open", jobId: record.jobId });
    open.addEventListener("click", () => onAction("open", record, open));
    actions.append(open);
  } else if (record.status !== "completed" && record.retryable) {
    const retry = button({ kind: "tertiary", label: msg("action.retry"), action: "retry", jobId: record.jobId });
    retry.addEventListener("click", () => onAction("retry", record, retry));
    actions.append(retry);
  }
  const more = iconButton({ iconName: "more", label: msg("action.moreFor", { name: record.filename || "" }), action: "more", jobId: record.jobId, haspopup: true });
  more.addEventListener("click", () => onAction("more", record, more));
  actions.append(more);
  trail.append(actions);
  row.append(rowLead(record, { poster }), main, trail);
  return row;
}

// ---------- live rows ----------

/** [tone, word] for a running job; finishing jobs read as done. */
export function liveStatus(job, finishing = null) {
  if (finishing) return ["complete", msg("status.completed")];
  switch (job.status) {
    case "paused": return ["paused", msg("status.paused")];
    case "pausing": return ["paused", msg("status.pausing")];
    case "queued": return ["queued", msg("status.queued")];
    case "starting": return ["queued", msg("status.starting")];
    case "remuxing": return ["progress", msg("status.remuxing")];
    default: return ["progress", msg("status.downloading")];
  }
}

/** Time left as "m:ss" while downloading, else "". With a known total it
 *  comes from the bytes left; for a stream counted in parts (no total) it is
 *  estimated from the bytes so far and the progress fraction. */
export function remainingTime(job) {
  const speed = Number(job.speed) || 0;
  const total = Number(job.total) || 0;
  const bytes = Number(job.bytes) || 0;
  const fraction = Number(job.progress) || 0;
  if (job.status !== "downloading" || speed <= 0) return "";
  let seconds;
  if (total > 0) {
    if (bytes >= total) return "";
    seconds = (total - bytes) / speed;
  } else if (bytes > 0 && fraction > 0 && fraction < 1) {
    seconds = (bytes / fraction - bytes) / speed;
  } else {
    return "";
  }
  return Number.isFinite(seconds) && seconds < 36_000 ? formatDuration(seconds) : "";
}

/**
 * The meta parts after the status word, most useful first, so a narrow row
 * ellipses the least useful part: "62%", "0:31 left", "56.3 MB/s", then the
 * size ("1.2 GB of 3 GB", or the bytes so far when the total is unknown).
 * The parts count of a stream never appears here; it lives in Details (§6.8).
 * compact (popup and side panel): the size is left out, so the line fits.
 * While finishing (remuxing) the status word speaks alone, unless the engine
 * names a distinct step ("Joining picture and sound").
 */
export function liveMetaParts(job, { compact = false } = {}) {
  if (job.status === "remuxing") return remuxActivity(job);
  const percent = Math.round(Math.max(0, Math.min(1, Number(job.progress) || 0)) * 100);
  const parts = [];
  if (percent > 0 && job.status !== "queued") parts.push(`${percent}%`);
  const left = remainingTime(job);
  if (left) parts.push(msg("job.left", { time: left }));
  if (job.status === "downloading" && Number(job.speed) > 0) parts.push(formatRate(job.speed));
  if (!compact) {
    if (Number(job.total) > 0) parts.push(msg("job.bytesOf", { done: formatBytes(job.bytes) || "0", total: formatBytes(job.total) }));
    else if (Number(job.bytes) > 0) parts.push(formatBytes(job.bytes));
  }
  if (!parts.length) {
    const activity = describeJobActivity(job.message, uiLanguage());
    if (activity) parts.push(activity);
  }
  return parts;
}

// The engine's step while finishing, when it says more than the status word:
// never an echo of "Finishing", never the generic "Downloading…" fallback.
function remuxActivity(job) {
  const language = uiLanguage();
  const activity = describeJobActivity(job.message, language);
  if (!activity) return [];
  const generic = describeJobActivity("?", language);
  const word = msg("status.remuxing").toLocaleLowerCase();
  return activity === generic || activity.toLocaleLowerCase().startsWith(word) ? [] : [activity];
}

/**
 * Pause or Resume (tertiary) and Cancel (destructive) for a running job.
 * The caller decides what each does (confirm Cancel in place with createMenus().confirm).
 * @param {(action: "pause"|"resume"|"cancel", job: object, button: HTMLButtonElement) => void} onControl
 */
export function transferControls(job, onControl) {
  const controls = [];
  if (job.status === "paused" && job.resumable) {
    const resume = button({ kind: "tertiary", label: msg("action.resume"), action: "resume", jobId: job.jobId });
    resume.addEventListener("click", () => onControl("resume", job, resume));
    controls.push(resume);
  } else if (job.pausable) {
    const pause = button({ kind: "tertiary", label: msg("action.pause"), action: "pause", jobId: job.jobId });
    pause.addEventListener("click", () => onControl("pause", job, pause));
    controls.push(pause);
  }
  const cancel = button({ kind: "destructive", label: msg("action.cancel"), action: "cancel", jobId: job.jobId });
  cancel.addEventListener("click", () => onControl("cancel", job, cancel));
  controls.push(cancel);
  return controls;
}

/**
 * A live download: a row with a 3px progress bar under its text, or (focus: true)
 * the view's one focus panel with a 6px bar and a Details disclosure (§6.8).
 * Returns a view to pass to updateLiveRow(); view.root is the element to insert.
 * @param {object} job
 * @param {object} [o]
 * @param {boolean} [o.focus]   the active download's focus panel (at most one per view)
 * @param {boolean} [o.poster]  poster frames (full pages only)
 * @param {boolean} [o.compact] leave the size out of the meta line (popup and side panel)
 */
export function liveRow(job, { focus = false, poster = true, compact = false } = {}) {
  const row = document.createElement(focus ? "div" : "li");
  row.className = "row";
  row.dataset.live = "";
  row.dataset.jobId = job.jobId;
  const main = document.createElement("div");
  main.className = "row-main";
  const title = document.createElement("p");
  title.className = "t-row row-title";
  const meta = document.createElement("p");
  meta.className = "t-meta row-meta";
  main.append(title, meta);
  const trail = document.createElement("div");
  trail.className = "row-trail";
  const actions = document.createElement("div");
  actions.className = "row-actions";
  trail.append(actions);
  row.append(rowLead(job, { poster }), main, trail);
  const bar = progress({ size: focus ? "panel" : "row", label: msg("job.progressLabel", { name: job.filename || "" }) });
  const view = { root: row, row, title, meta, actions, bar, focus, compact, controlsKey: "", name: null, details: null, job, onControl: null };
  if (focus) {
    const panel = document.createElement("article");
    panel.className = "focus-panel";
    panel.dataset.jobId = job.jobId;
    const barWrap = document.createElement("div");
    barWrap.className = "focus-progress";
    barWrap.append(bar);
    const details = document.createElement("details");
    details.className = "focus-details";
    // The chevron turns when the disclosure opens (system.css), as Settings' does.
    const summary = document.createElement("summary");
    const summaryText = document.createElement("span");
    summaryText.textContent = msg("action.details");
    summary.append(summaryText, icon("chevron"));
    const body = document.createElement("div");
    body.className = "details-body";
    details.append(summary, body);
    panel.append(row, barWrap, details);
    view.root = panel;
    view.details = { element: details, body };
  } else {
    // A grid child of the row, so the bar runs from the text column to the
    // column's right edge, under the actions as well as the text.
    row.append(bar);
  }
  return view;
}

/** The bar's state (v3 §3.2): the finish hold's phase, else the job's own
 *  state: paused, downloading (active), finishing (remuxing), failed, queued. */
export function barState(job, finishing = null) {
  if (finishing) return finishing.phase;
  switch (job.status) {
    case "paused":
    case "pausing": return "paused";
    case "downloading": return "active";
    case "remuxing": return "finishing";
    case "failed": return "failed";
    default: return "queued";
  }
}

/**
 * Update a live view in place (no re-render, focus stays put).
 * Controls are rebuilt only when status, pausable or resumable change; their
 * handlers always receive the latest job and call the latest onControl. When a
 * rebuild replaces the focused control, focus moves to the control now in the
 * same place (Pause becomes Resume), so keyboard users keep their position.
 * @param {object} view       from liveRow()
 * @param {object} job
 * @param {object} [o]
 * @param {{phase: "complete"|"settled"}|null} [o.finishing]  the finish hold (§6.7): celadon, then fade
 * @param {number[]} [o.samples]  recent speed samples for the focus panel's chart
 * @param {(action, job, button) => void} [o.onControl]  see transferControls()
 */
export function updateLiveRow(view, job, { finishing = null, samples = [], onControl = () => {} } = {}) {
  view.job = job;
  view.onControl = onControl;
  if (view.name !== job.filename) {
    view.name = job.filename;
    view.title.replaceChildren(filename(job.filename));
    view.bar.setAttribute("aria-label", msg("job.progressLabel", { name: job.filename || "" }));
  }
  const percent = finishing ? 100 : Math.round(Math.max(0, Math.min(1, Number(job.progress) || 0)) * 100);
  const [tone, word] = liveStatus(job, finishing);
  const parts = finishing ? [] : liveMetaParts(job, { compact: view.compact });
  view.meta.replaceChildren(status(tone, word), document.createTextNode(parts.join(" · ")));
  setProgress(view.bar, percent, barState(job, finishing));
  const controlsKey = finishing ? "none" : `${job.status}:${job.pausable}:${job.resumable}`;
  if (controlsKey !== view.controlsKey) {
    view.controlsKey = controlsKey;
    const focused = globalThis.document?.activeElement;
    const index = focused?.closest?.(".row-actions") === view.actions ? [...view.actions.children].indexOf(focused) : -1;
    const forward = (action, _job, control) => view.onControl?.(action, view.job, control);
    view.actions.replaceChildren(...(finishing ? [] : transferControls(job, forward)));
    if (index >= 0) {
      const next = view.actions.children[Math.min(index, view.actions.children.length - 1)];
      next?.focus({ preventScroll: true });
    }
  }
  if (view.details) renderLiveDetails(view.details, job, samples);
}

/**
 * Fill the focus panel's Details (§6.8; hidden when there is nothing to show):
 * a parts map only when the engine reports each part's own level
 * (job.segments, levels 0–1), the speed line, and one meta line with the parts
 * count and "Now … · Peak …". An aggregate done/total never draws a map: it
 * would only repeat the progress bar above it.
 */
export function renderLiveDetails(details, job, samples = []) {
  const segments = segmentsFromActivity(job.message);
  const levels = Array.isArray(job.segments) ? job.segments.map(Number).filter(Number.isFinite) : [];
  const hasSpeed = samples.filter((value) => value > 0).length > 1;
  details.element.hidden = !segments && !levels.length && !hasSpeed;
  if (details.element.hidden) return;
  const nodes = [];
  if (levels.length) nodes.push(segmentMap(levels));
  const words = [];
  if (segments) words.push(msg("job.parts", segments));
  if (hasSpeed) words.push(msg("job.speedNowPeak", { now: formatRate(samples[samples.length - 1]) || "–", peak: formatRate(Math.max(...samples)) }));
  // The caption sits right under its line: chart and caption share one block.
  const block = document.createElement("div");
  block.className = "speed-block";
  if (hasSpeed) block.append(speedChart(samples));
  const meta = document.createElement("p");
  meta.className = "t-meta";
  meta.textContent = words.join(" · ");
  block.append(meta);
  nodes.push(block);
  details.body.replaceChildren(...nodes);
}

/**
 * Segment map (§6.8): one bar divided by 2px gaps, each part filled to its
 * own level. Contiguous finished parts merge into one solid run, so a gap
 * appears only where parts really differ (never a row of identical dashes).
 * @param {number[]} levels  one level per part, 0–1
 */
export function segmentMap(levels) {
  const clamped = levels.map((level) => Math.max(0, Math.min(1, Number(level) || 0)));
  const map = document.createElement("div");
  map.className = "segment-map";
  map.dataset.indicator = "";
  map.setAttribute("role", "img");
  map.setAttribute("aria-label", msg("job.parts", { done: clamped.filter((level) => level >= 1).length, total: clamped.length }));
  // At most 48 cells: average neighbouring parts into buckets.
  const buckets = Math.max(1, Math.min(48, clamped.length));
  const per = clamped.length / buckets;
  const cells = [];
  for (let index = 0; index < buckets; index += 1) {
    const slice = clamped.slice(Math.floor(index * per), Math.max(Math.floor(index * per) + 1, Math.floor((index + 1) * per)));
    const level = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    const last = cells[cells.length - 1];
    if (level >= 1 && last && last.level >= 1) last.span += 1;
    else cells.push({ level, span: 1 });
  }
  for (const { level, span } of cells) {
    const cell = document.createElement("span");
    const fill = document.createElement("i");
    cell.style.setProperty("--level", level.toFixed(3));
    cell.style.flexGrow = String(span);
    cell.append(fill);
    map.append(cell);
  }
  return map;
}

/** Speed chart (§6.8): the line only, no reflection. The line spans the box
 *  from 80% of the slowest sample to the peak, so it uses the box's height. */
export function speedChart(samples) {
  const width = 640;
  const height = 24;
  const peak = Math.max(1, ...samples);
  const floor = Math.min(peak * 0.999, Math.max(0, Math.min(...samples) * 0.8));
  const range = Math.max(1e-9, peak - floor);
  const step = samples.length > 1 ? width / (samples.length - 1) : width;
  const d = samples.map((value, index) => `${index ? "L" : "M"}${(index * step).toFixed(1)} ${(height - 2 - ((Math.max(floor, value) - floor) / range) * (height - 4)).toFixed(1)}`).join(" ");
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "speed-chart");
  svg.dataset.indicator = "";
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", msg("job.speedChart"));
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}
