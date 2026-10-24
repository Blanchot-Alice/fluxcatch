// FluxCatch v2 component builders (design review §6). Pure DOM, no framework.
// Every builder returns elements that use only the classes in system.css.
import { msg } from "./messages.js";
import { formatCount } from "./locale.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const ICON_PATHS = {
  settings: '<path d="M12 15.25a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5Z"/><path d="M19.1 13.1a7.8 7.8 0 0 0 0-2.2l2-1.55-2-3.46-2.45.98a8.2 8.2 0 0 0-1.9-1.1L14.4 3.15h-4.8l-.35 2.62a8.2 8.2 0 0 0-1.9 1.1L4.9 5.89l-2 3.46 2 1.55a7.8 7.8 0 0 0 0 2.2l-2 1.55 2 3.46 2.45-.98a8.2 8.2 0 0 0 1.9 1.1l.35 2.62h4.8l.35-2.62a8.2 8.2 0 0 0 1.9-1.1l2.45.98 2-3.46-2-1.55Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L11.5 4.4"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.3-1.3"/>',
  more: '<circle class="fill" cx="5" cy="12" r="1.5"/><circle class="fill" cx="12" cy="12" r="1.5"/><circle class="fill" cx="19" cy="12" r="1.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  video: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path class="fill" d="M10 9.2v5.6l4.6-2.8z"/>',
  audio: '<path d="M9 18V6.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  stream: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="M7 13.5c1.6-1.4 3.4-1.4 5 0s3.4 1.4 5 0M7 10c1.6-1.4 3.4-1.4 5 0s3.4 1.4 5 0"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2h8.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  source: '<path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  remove: '<path d="M6 6l12 12M18 6 6 18"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  rescan: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
  workspace: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M14.5 4.5v15"/>',
  clear: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "icon");
  svg.innerHTML = ICON_PATHS[name] || "";
  return svg;
}

const LOGO = '<circle class="logo-cream" cx="64" cy="64" r="60"/><circle class="logo-ring" cx="64" cy="64" r="58.5" stroke-width="3"/><path class="logo-wave" d="M22 100q42-13 84 0" stroke-width="5"/><path class="logo-wave" d="M34 112q30-9 60 0" stroke-width="4" stroke-opacity=".5"/><path class="logo-pad" d="M52.4 26A34 34 0 1 1 32 46.4L64 58Z"/><circle class="logo-bloom" cx="92" cy="36" r="9"/>';

/** BrandMark (§4): logo + “FluxCatch”, sizes s and m, never a subtitle.
 *  It lays its two parts into the parent's lead grid (display: contents). */
export function brandMark({ size = "m" } = {}) {
  const mark = document.createElement("span");
  mark.className = "brandmark";
  mark.dataset.brandmark = "";
  mark.dataset.size = size;
  const logo = document.createElementNS(SVG_NS, "svg");
  logo.setAttribute("viewBox", "0 0 128 128");
  logo.setAttribute("aria-hidden", "true");
  logo.setAttribute("class", "brandmark-logo");
  logo.innerHTML = LOGO;
  const word = document.createElement("span");
  word.className = "t-wordmark";
  word.textContent = msg("brand.name");
  mark.append(logo, word);
  return mark;
}

/** kind: primary | secondary | tertiary | destructive */
export function button({ kind = "tertiary", label, iconName, title, type = "button", action, jobId }) {
  const element = document.createElement("button");
  element.type = type;
  element.className = `btn btn-${kind}`;
  if (iconName) element.append(icon(iconName));
  const text = document.createElement("span");
  text.textContent = label;
  element.append(text);
  if (title) element.title = title;
  if (action) element.dataset.action = action;
  if (jobId) element.dataset.jobId = jobId;
  return element;
}

export function iconButton({ iconName, label, action, jobId, haspopup = false }) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "icon-button";
  element.title = label;
  element.setAttribute("aria-label", label);
  if (haspopup) element.setAttribute("aria-haspopup", "menu");
  if (action) element.dataset.action = action;
  if (jobId) element.dataset.jobId = jobId;
  element.append(icon(iconName));
  return element;
}

/** Status (§6.6): 8px dot + a word. tone: progress | paused | queued | complete | warning | failed | cancelled */
export function status(tone, label) {
  const element = document.createElement("span");
  element.className = "status t-meta";
  element.dataset.tone = tone;
  element.textContent = label;
  return element;
}

/** Progress (v3 §3.2): the fill is the state's colour. state: active | paused | queued | finishing | complete | settled | failed */
export function progress({ value = 0, size = "row", state = "active", label = "" }) {
  const element = document.createElement("div");
  element.className = "progress";
  element.dataset.size = size;
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", "100");
  if (label) element.setAttribute("aria-label", label);
  const fill = document.createElement("span");
  fill.className = "progress-fill";
  element.append(fill);
  setProgress(element, value, state);
  return element;
}

export function setProgress(element, value, state) {
  const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  element.style.setProperty("--p", String(percent));
  element.setAttribute("aria-valuenow", String(percent));
  element.setAttribute("aria-valuetext", `${percent}%`);
  if (state) element.dataset.state = state;
}

const TAIL_CHARS = 8;

/** Split a filename so the head can shrink with an ellipsis while the tail
 *  (last characters of the stem + the extension) always stays visible. */
export function splitFilename(name) {
  const full = String(name || "media");
  const dot = full.lastIndexOf(".");
  const ext = dot > 0 && full.length - dot <= 7 ? full.slice(dot) : "";
  const stem = ext ? full.slice(0, dot) : full;
  const chars = [...stem];
  const cut = Math.max(0, chars.length - TAIL_CHARS);
  return { full, head: chars.slice(0, cut).join(""), tail: chars.slice(cut).join("") + ext };
}

/** Filename in the `row` role, truncated in the middle so the extension survives (§6.4). */
export function filename(name) {
  const { full, head: headText, tail: tailText } = splitFilename(name);
  const element = document.createElement("span");
  element.className = "filename";
  element.dataset.filename = full;
  element.dataset.userContent = "";
  element.title = full;
  const head = document.createElement("span");
  head.className = "filename-head";
  head.textContent = headText;
  const tail = document.createElement("span");
  tail.className = "filename-tail";
  tail.dataset.filenameTail = "";
  tail.textContent = tailText;
  element.append(head, tail);
  return element;
}

export function groupLabel(text, id) {
  const element = document.createElement("h2");
  element.className = "group-label t-label text-column";
  element.textContent = text;
  if (id) element.id = id;
  return element;
}

// ---------- single-flight actions (no label swapping, icons stay) ----------
const running = new Set();

/** Run `task` once per key at a time: the element is aria-busy and disabled
 *  while it runs, and labels never change. Afterwards the element gets its
 *  earlier disabled state back, unless keepDisabled() (evaluated after the
 *  task, on success or failure) says it should stay disabled, e.g. "Clear
 *  finished" once nothing is left to clear. */
export async function runAction(element, key, task, { onError, keepDisabled } = {}) {
  if (running.has(key)) return undefined;
  running.add(key);
  const wasDisabled = element?.disabled;
  if (element) {
    element.setAttribute("aria-busy", "true");
    element.disabled = true;
  }
  try {
    return await task();
  } catch (error) {
    onError?.(error);
    return undefined;
  } finally {
    running.delete(key);
    if (element) {
      element.removeAttribute("aria-busy");
      let keep = false;
      try { keep = Boolean(keepDisabled?.()); } catch { keep = false; }
      element.disabled = keep || Boolean(wasDisabled);
    }
  }
}

// ---------- toasts ----------
export function createToaster(region) {
  return function toast(text, tone = "success") {
    if (!region) return;
    const element = document.createElement("div");
    element.className = "toast";
    element.dataset.tone = tone;
    element.setAttribute("role", tone === "error" ? "alert" : "status");
    const line = document.createElement("span");
    line.className = "status t-body";
    line.textContent = String(text || "");
    element.append(line);
    region.append(element);
    while (region.children.length > 3) region.firstElementChild.remove();
    setTimeout(() => element.remove(), 4000);
  };
}

// ---------- menus and in-place confirmation ----------
export function createMenus(layer) {
  const menu = layer.querySelector(".menu");
  let anchor = null;
  let resolveConfirm = null;

  function place(target) {
    const rect = target.getBoundingClientRect();
    const width = Math.max(220, menu.offsetWidth);
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    const height = menu.offsetHeight;
    const below = rect.bottom + 6;
    menu.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below}px`;
  }

  function close({ restore = true } = {}) {
    if (layer.hidden) return;
    layer.hidden = true;
    menu.replaceChildren();
    const previous = anchor;
    anchor = null;
    if (resolveConfirm) { const resolve = resolveConfirm; resolveConfirm = null; resolve(false); }
    previous?.closest?.("[data-selected]")?.removeAttribute("data-selected");
    if (restore && previous?.isConnected) previous.focus({ preventScroll: true });
  }

  function openItems(target, items) {
    close({ restore: false });
    anchor = target;
    target.closest?.(".row, .focus-panel")?.setAttribute("data-selected", "");
    menu.setAttribute("role", "menu");
    // A confirm left its question as the label; a menu is named by its anchor.
    menu.removeAttribute("aria-label");
    for (const item of items) {
      const entry = document.createElement("button");
      entry.type = "button";
      entry.className = "menu-item";
      entry.setAttribute("role", "menuitem");
      if (item.tone) entry.dataset.tone = item.tone;
      if (item.iconName) entry.append(icon(item.iconName));
      const text = document.createElement("span");
      text.textContent = item.label;
      entry.append(text);
      entry.addEventListener("click", () => {
        close({ restore: !item.keepOpen });
        item.run(target);
      });
      menu.append(entry);
    }
    layer.hidden = false;
    place(target);
    menu.querySelector("button")?.focus();
  }

  /** Ask in place, next to the control that triggered the action. Resolves true or false.
   *  confirmKind: the confirming button's kind, "destructive" by default; an
   *  opt-in that removes nothing (Settings' "Allow") passes "tertiary". */
  function confirm(target, { question, confirmLabel, cancelLabel = msg("action.keep"), confirmKind = "destructive" }) {
    close({ restore: false });
    anchor = target;
    target.closest?.(".row, .focus-panel")?.setAttribute("data-selected", "");
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", question);
    const box = document.createElement("div");
    box.className = "confirm";
    // The question is what the box is for: row (text-primary), not body.
    const text = document.createElement("p");
    text.className = "t-row";
    text.textContent = question;
    const actions = document.createElement("div");
    actions.className = "confirm-actions";
    const keep = button({ kind: "tertiary", label: cancelLabel });
    const yes = button({ kind: confirmKind, label: confirmLabel });
    actions.append(keep, yes);
    box.append(text, actions);
    menu.append(box);
    layer.hidden = false;
    place(target);
    keep.focus();
    return new Promise((resolve) => {
      resolveConfirm = resolve;
      keep.addEventListener("click", () => close());
      yes.addEventListener("click", () => {
        resolveConfirm = null;
        close();
        resolve(true);
      });
    });
  }

  layer.addEventListener("click", (event) => { if (event.target === layer) close(); });
  document.addEventListener("keydown", (event) => {
    if (layer.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    const items = [...menu.querySelectorAll("button")];
    if (!items.length) return;
    // Enter and Space activate the focused item here, on keydown, and the key
    // is consumed. Left to the button's own keypress activation, the keydown
    // stays unhandled, and Chrome on macOS then replays an unhandled key
    // through the system key path when the window is key (a DevTools-driven
    // window is): the replay lands on the anchor that close() just focused and
    // activates it, which reopens the popover, and so on without end.
    if (event.key === "Enter" || event.key === " ") {
      const active = document.activeElement;
      if (!items.includes(active)) return;
      event.preventDefault();
      active.click();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
    items[next].focus();
  });
  window.addEventListener("resize", () => close({ restore: false }));
  return { openItems, confirm, close, isOpen: () => !layer.hidden };
}

// ---------- status line: an 8px dot in the lead column, text on the text column ----------

const statusLines = new WeakMap();

/** Fill an existing status line in place (the element keeps its id and role).
 *  tone: "" (harbour) | progress | warning | complete | failed.
 *  actions: [{ label, run(button), kind = "tertiary" }]. An empty text clears it.
 *  Idempotent: repeating the same tone, text and action labels keeps the nodes
 *  (no re-announcement, focus stays) and only swaps in the new run handlers.
 *  A real change rebuilds the line and keeps focus on the action in the same place. */
export function setStatusLine(container, { tone = "", text = "", actions = [] } = {}) {
  const signature = JSON.stringify([tone, text, actions.map((action) => [action.label, action.kind || "tertiary"])]);
  const previous = statusLines.get(container);
  if (previous && previous.signature === signature && (text ? previous.dot.parentNode === container : !container.firstChild)) {
    previous.runs = actions.map((action) => action.run);
    return container;
  }
  const focused = globalThis.document?.activeElement;
  const focusIndex = previous && focused?.closest?.(".line-actions") ? previous.buttons.indexOf(focused) : -1;
  container.replaceChildren();
  container.dataset.tone = tone;
  const entry = { signature, dot: null, buttons: [], runs: actions.map((action) => action.run) };
  statusLines.set(container, entry);
  if (!text) return container;
  const dot = document.createElement("span");
  entry.dot = dot;
  dot.className = "line-dot";
  // The 8px dot is a status indicator, like the dot of .status (not a container).
  dot.dataset.indicator = "";
  dot.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "line-text t-body";
  const words = document.createElement("span");
  words.textContent = text;
  body.append(words);
  if (actions.length) {
    const group = document.createElement("span");
    group.className = "line-actions";
    actions.forEach((action, index) => {
      const element = button({ kind: action.kind || "tertiary", label: action.label });
      element.addEventListener("click", (event) => entry.runs[index]?.(event.currentTarget));
      entry.buttons.push(element);
      group.append(element);
    });
    body.append(group);
  }
  container.append(dot, body);
  if (focusIndex >= 0 && entry.buttons.length) entry.buttons[Math.min(focusIndex, entry.buttons.length - 1)].focus({ preventScroll: true });
  return container;
}

/** StatusLine (§6.6, §7): the one-line status with its dot hanging in the lead
 *  column, e.g. the local-engine line "Local engine isn’t set up · Set up".
 *  Returns <p class="status-line lead-grid" role="status">. */
export function statusLine({ tone = "", text = "", actions = [], id } = {}) {
  const element = document.createElement("p");
  element.className = "status-line lead-grid";
  element.setAttribute("role", "status");
  if (id) element.id = id;
  return setStatusLine(element, { tone, text, actions });
}

// ---------- list header: title + optional count, trailing tertiary actions ----------

/** ListHeader, e.g. "Media on this page  3 · Rescan · Clear results".
 *  The title sits on the text column; actions end on the column's right edge.
 *  meta: an optional line in the meta role after the title (e.g. the page
 *  host); pass metaUserContent: true when it is user content, so it is never
 *  translated or counted as UI copy. Hidden while empty.
 *  actions: [{ label, run(button), kind = "tertiary" | "destructive", action }].
 *  Returns { element, heading, count, meta, actions, setCount(n), setMeta(text) }; the count is hidden at 0. */
export function listHeader({ title, count = 0, meta = "", metaUserContent = false, actions = [], level = 2, id } = {}) {
  const element = document.createElement("div");
  element.className = "list-header";
  const heading = document.createElement(`h${Math.min(6, Math.max(2, level))}`);
  heading.className = "list-title t-title";
  if (id) heading.id = id;
  const words = document.createElement("span");
  words.textContent = title;
  const countNode = document.createElement("span");
  countNode.className = "list-count t-meta";
  const metaNode = document.createElement("span");
  metaNode.className = "list-meta t-meta";
  if (metaUserContent) metaNode.dataset.userContent = "";
  heading.append(words, countNode, metaNode);
  const group = document.createElement("div");
  group.className = "list-actions";
  for (const action of actions) {
    const control = button({ kind: action.kind || "tertiary", label: action.label, action: action.action });
    control.addEventListener("click", (event) => action.run(event.currentTarget));
    group.append(control);
  }
  element.append(heading, group);
  const setCount = (n) => {
    const value = Number(n) || 0;
    // The leading space keeps the heading's accessible name "Media on this page 3";
    // a flex item drops it visually.
    countNode.textContent = value ? ` ${formatCount(value)}` : "";
    countNode.hidden = value === 0;
  };
  const setMeta = (text) => {
    metaNode.textContent = String(text || "");
    metaNode.hidden = !metaNode.textContent;
  };
  setCount(count);
  setMeta(meta);
  return { element, heading, count: countNode, meta: metaNode, actions: group, setCount, setMeta };
}

// ---------- empty state: one sentence, one body line, at most one action ----------

/** EmptyState (§6.11): left-aligned on the text column, in the upper third.
 *  action: { label, run(button), kind = "tertiary" } (use "primary" only when
 *  it is the view's one primary, e.g. Rescan in the popup).
 *  Returns { element, sentence, body, action, update({ sentence, body, action }) }. */
export function emptyState({ sentence = "", body = "", action = null, id } = {}) {
  const element = document.createElement("section");
  element.className = "empty-state text-column";
  if (id) element.id = id;
  const sentenceNode = document.createElement("p");
  sentenceNode.className = "t-empty";
  const bodyNode = document.createElement("p");
  bodyNode.className = "t-body";
  const actionNode = document.createElement("button");
  actionNode.type = "button";
  let run = null;
  actionNode.addEventListener("click", (event) => run?.(event.currentTarget));
  element.append(sentenceNode, bodyNode, actionNode);
  const update = (next = {}) => {
    sentenceNode.textContent = next.sentence || "";
    bodyNode.textContent = next.body || "";
    bodyNode.hidden = !next.body;
    const spec = next.action || null;
    actionNode.hidden = !spec;
    actionNode.className = `btn btn-${spec?.kind || "tertiary"}`;
    actionNode.replaceChildren(document.createTextNode(spec?.label || ""));
    run = spec?.run || null;
  };
  update({ sentence, body, action });
  return { element, sentence: sentenceNode, body: bodyNode, action: actionNode, update };
}
