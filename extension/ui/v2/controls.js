// FluxCatch v2 form and frame controls (design review §6.2, §6.3, §6.12,
// §6.13): select, switch, text and number fields, the Settings row and nav,
// the popup-sized dialog and the segmented control. Pure DOM; styles in
// system.css; tokens only. Every control is a native element (or a button
// with a role), so keyboard and label behaviour come from the platform.
import { msg } from "./messages.js";
import { formatCount } from "./locale.js";
import { icon, iconButton } from "./components.js";

let uid = 0;
const nextId = (prefix) => `${prefix}-${(uid += 1)}`;

function addTokens(element, attribute, ...ids) {
  const current = (element.getAttribute(attribute) || "").split(/\s+/).filter(Boolean);
  for (const id of ids) if (id && !current.includes(id)) current.push(id);
  if (current.length) element.setAttribute(attribute, current.join(" "));
}

const LABELABLE = "input, select, textarea, button";

/** The native control inside a builder's wrapper (or the element itself). */
export function controlOf(element) {
  if (!element) return null;
  if (element.matches?.(LABELABLE)) return element;
  return element.querySelector?.(LABELABLE) || null;
}

// What a setting's <label for> may name: a form control or a switch. A plain
// button or link keeps its own words as its name ("Change", "All downloads");
// a <label> would rename it and make a click on the row name run it.
const LABEL_FOR = "input, select, textarea, [role=switch]";
// Form controls a row's error marks with aria-invalid (never an action button).
const FORM_CONTROL = "[data-field], input, select, textarea, [role=switch], [role=radiogroup], [role=tablist]";
const ACTIONS = "button, a[href]";

// The one element a setting's name labels: a form control or switch, or the
// native control inside a field wrapper. Groups (presets, segmented) are named
// by aria-labelledby instead, never through their first button.
function labelTarget(control) {
  if (!control?.matches) return null;
  if (control.matches(LABEL_FOR)) return control;
  if (control.matches("[data-field]")) {
    const native = controlOf(control);
    return native?.matches?.(LABEL_FOR) ? native : null;
  }
  return null;
}

// The trailing actions of a row whose control is a button or link, or a group
// of them (with status words or values beside them); [] for anything else.
function rowActions(control) {
  if (!control?.matches || labelTarget(control)) return [];
  if (control.matches(ACTIONS)) return [control];
  if (control.hasAttribute?.("role")) return [];
  if (control.querySelector?.(FORM_CONTROL)) return [];
  return control.querySelectorAll?.(ACTIONS) || [];
}

function fieldWrapper({ size, width, multiline }) {
  const wrapper = document.createElement("span");
  wrapper.className = "field";
  wrapper.dataset.field = "";
  wrapper.dataset.size = size === "compact" ? "compact" : "regular";
  if (width) wrapper.dataset.width = width;
  if (multiline) wrapper.dataset.multiline = "";
  return wrapper;
}

function applyCommon(control, { id, name, label, describedBy, disabled, required, invalid }) {
  control.id = id || nextId("fc-field");
  if (name) control.name = name;
  if (label) control.setAttribute("aria-label", label);
  if (describedBy) addTokens(control, "aria-describedby", ...[].concat(describedBy));
  if (disabled) control.disabled = true;
  if (required) control.required = true;
  if (invalid) control.setAttribute("aria-invalid", "true");
}

// ---------- select ----------

/**
 * Select (§6.2): a native <select> in the input look, with a chevron glyph.
 * @param {object} o
 * @param {{value: string, label: string, disabled?: boolean}[]} o.options
 * @param {string} [o.value]
 * @param {"regular"|"compact"} [o.size]  36 or 32 px high
 * @param {"short"|"medium"|"fill"} [o.width]
 * @param {string} [o.label]  aria-label, only when no visible <label> names it
 * @param {(value: string, select: HTMLSelectElement) => void} [o.onChange]
 * @returns {HTMLSpanElement} span.field.select-field; the <select> is controlOf(it)
 */
export function select({ id, name, options = [], value, size = "regular", width, label, describedBy, disabled, onChange } = {}) {
  const wrapper = fieldWrapper({ size, width });
  wrapper.classList.add("select-field");
  const control = document.createElement("select");
  applyCommon(control, { id, name, label, describedBy, disabled });
  setOptions(control, options, value);
  if (onChange) control.addEventListener("change", () => onChange(control.value, control));
  const chevron = document.createElement("span");
  chevron.className = "field-glyph field-chevron";
  chevron.append(icon("chevron"));
  wrapper.append(control, chevron);
  return wrapper;
}

/** Replace a select's options, keeping `value` selected when present
 *  (an absent value leaves the first option selected, never a blank select). */
export function setOptions(control, options, value) {
  const target = controlOf(control);
  target.replaceChildren(...options.map((option) => {
    const element = document.createElement("option");
    element.value = String(option.value);
    element.textContent = option.label;
    if (option.disabled) element.disabled = true;
    return element;
  }));
  if (value !== undefined && options.some((option) => String(option.value) === String(value))) target.value = String(value);
}

// ---------- switch: the one boolean control ----------

/**
 * Switch: the ONE boolean control in the product (Settings toggles and any
 * dialog option). A <button role="switch" aria-checked>, so Space and Enter
 * toggle it and a <label for> names it. (Exported as switchControl because
 * `switch` is a reserved word.) Fires a bubbling "change" event after a toggle.
 * @param {object} o
 * @param {boolean} [o.checked]
 * @param {string} [o.label]  aria-label, only when no visible <label> names it
 * @param {(checked: boolean, element: HTMLButtonElement) => void} [o.onChange]
 * @returns {HTMLButtonElement} button.switch
 */
export function switchControl({ id, name, checked = false, disabled = false, label, describedBy, onChange } = {}) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "switch";
  element.setAttribute("role", "switch");
  applyCommon(element, { id: id || nextId("fc-switch"), name, label, describedBy, disabled });
  if (name) element.dataset.name = name;
  const thumb = document.createElement("span");
  thumb.className = "switch-thumb";
  thumb.setAttribute("aria-hidden", "true");
  element.append(thumb);
  setSwitch(element, checked);
  element.addEventListener("click", () => {
    if (element.disabled) return;
    setSwitch(element, !isSwitchOn(element));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    onChange?.(isSwitchOn(element), element);
  });
  return element;
}

/** Set a switch without firing change. */
export function setSwitch(element, checked) {
  element.setAttribute("aria-checked", String(Boolean(checked)));
}

export function isSwitchOn(element) {
  return element.getAttribute("aria-checked") === "true";
}

// ---------- text and number fields ----------

/**
 * Text field (§6.2) on the shared .field: tonal fill, no border at rest,
 * focus ring. Optional trailing unit in meta style ("KB", "MB/s").
 * @param {object} o
 * @param {string} [o.unit]
 * @param {boolean} [o.multiline]  a <textarea> (rows, default 4)
 * @param {"regular"|"compact"} [o.size]
 * @param {"short"|"medium"|"fill"} [o.width]
 * @returns {HTMLSpanElement} span.field; the input is controlOf(it)
 */
export function textField({ id, name, value = "", placeholder = "", unit = "", size = "regular", width, label, describedBy, disabled, required, invalid, multiline = false, rows = 4, maxLength, type = "text", inputMode, autocomplete = "off", spellcheck, onInput, onChange } = {}) {
  const wrapper = fieldWrapper({ size, width, multiline });
  const control = document.createElement(multiline ? "textarea" : "input");
  if (multiline) control.rows = rows;
  else control.type = type;
  applyCommon(control, { id, name, label, describedBy, disabled, required, invalid });
  control.value = String(value ?? "");
  if (placeholder) control.placeholder = placeholder;
  if (maxLength) control.maxLength = maxLength;
  if (inputMode) control.inputMode = inputMode;
  if (autocomplete) control.setAttribute("autocomplete", autocomplete);
  if (spellcheck !== undefined) control.spellcheck = Boolean(spellcheck);
  if (onInput) control.addEventListener("input", () => onInput(control.value, control));
  if (onChange) control.addEventListener("change", () => onChange(control.value, control));
  wrapper.append(control);
  if (unit && !multiline) {
    const unitNode = document.createElement("span");
    unitNode.className = "field-unit t-meta";
    unitNode.id = `${control.id}-unit`;
    unitNode.textContent = unit;
    addTokens(control, "aria-describedby", unitNode.id);
    wrapper.append(unitNode);
  }
  return wrapper;
}

/** Number field: textField with type=number, numeric input mode, min/max/step. */
export function numberField({ min, max, step, width = "short", ...options } = {}) {
  const wrapper = textField({ ...options, width, type: "number", inputMode: "numeric" });
  const control = controlOf(wrapper);
  if (min !== undefined) control.min = String(min);
  if (max !== undefined) control.max = String(max);
  if (step !== undefined) control.step = String(step);
  return wrapper;
}

/** A visible label (label role) above a control, for dialogs and forms. */
export function fieldStack({ label, control }) {
  const stack = document.createElement("div");
  stack.className = "field-stack";
  const target = controlOf(control);
  const name = document.createElement("label");
  name.className = "t-label";
  name.textContent = label;
  if (target) {
    if (!target.id) target.id = nextId("fc-field");
    name.htmlFor = target.id;
  }
  stack.append(name, control);
  return stack;
}

// ---------- Settings: one row per setting, inline "Saved" ----------

/**
 * SettingRow (§6.13): name (row role), at most one line of description (body
 * role), the control on the column's trailing edge, a "Saved" note before it.
 * - A form control or switch: the name is its <label for>; the description
 *   and error line describe it.
 * - Buttons or links (one, or several with status words beside them): the
 *   name is a <span>, and every action is described by the name, description
 *   and error line, so each keeps its own words as its accessible name.
 * - A group with a role (a segmented radiogroup): the name labels it through
 *   aria-labelledby.
 * - Anything else (a status word, a value): aria-labelledby on the control.
 * @param {object} o
 * @param {string} o.id           the row's id (for nav anchors and tests)
 * @param {string} o.name
 * @param {string} [o.description]
 * @param {HTMLElement|HTMLElement[]} o.control from switchControl(), select(), numberField() …;
 *        an array is laid out in one span.trail-group (a status word and its action)
 * @param {"inline"|"stack"} [o.layout]  stack puts the control under the text (text areas)
 * @returns {HTMLDivElement} div.setting-row
 */
export function settingRow({ id, name, description = "", control: given, layout = "inline" }) {
  let control = given;
  if (Array.isArray(given)) {
    control = document.createElement("span");
    control.className = "trail-group";
    control.append(...given.filter(Boolean));
  }
  const row = document.createElement("div");
  row.className = "setting-row";
  row.dataset.layout = layout === "stack" ? "stack" : "inline";
  row.id = id || nextId("fc-setting");
  const text = document.createElement("div");
  text.className = "setting-text";
  const target = labelTarget(control);
  const actions = [...rowActions(control)];
  const nameNode = document.createElement(target ? "label" : "span");
  nameNode.className = "setting-name t-row";
  nameNode.id = `${row.id}-name`;
  nameNode.textContent = name;
  if (target) {
    if (!target.id) target.id = `${row.id}-control`;
    nameNode.htmlFor = target.id;
  } else if (control && !actions.length) {
    addTokens(control, "aria-labelledby", nameNode.id);
  }
  text.append(nameNode);
  const descriptionNode = document.createElement("p");
  descriptionNode.className = "setting-description t-body";
  descriptionNode.id = `${row.id}-description`;
  descriptionNode.textContent = description;
  descriptionNode.hidden = !description;
  const errorNode = document.createElement("p");
  errorNode.className = "setting-error t-meta";
  errorNode.id = `${row.id}-error`;
  errorNode.setAttribute("role", "alert");
  errorNode.hidden = true;
  text.append(descriptionNode, errorNode);
  const describedBy = [...(description ? [descriptionNode.id] : []), errorNode.id];
  if (actions.length) {
    for (const action of actions) addTokens(action, "aria-describedby", nameNode.id, ...describedBy);
  } else {
    const describeTarget = target || control;
    if (describeTarget) addTokens(describeTarget, "aria-describedby", ...describedBy);
  }
  const trail = document.createElement("div");
  trail.className = "setting-trail";
  const saved = document.createElement("span");
  saved.className = "status saved-note t-meta";
  saved.dataset.tone = "complete";
  saved.dataset.visible = "false";
  saved.setAttribute("role", "status");
  trail.append(saved);
  if (control) trail.append(control);
  row.append(text, trail);
  return row;
}

const savedTimers = new WeakMap();
export const SAVED_VISIBLE_MS = 2000;

/** Show the row's inline "Saved" for about 2 s, then fade it (opacity only,
 *  so it is safe under reduced motion). Re-arms on repeated saves. */
export function markSaved(row, { text = msg("status.saved"), duration = SAVED_VISIBLE_MS } = {}) {
  const note = row?.querySelector?.(".saved-note");
  if (!note) return;
  clearTimeout(savedTimers.get(note));
  note.textContent = text;
  note.dataset.visible = "true";
  savedTimers.set(note, setTimeout(() => {
    note.dataset.visible = "false";
    savedTimers.delete(note);
  }, duration));
}

/** Show (text) or clear (empty) the row's one-line error; sets aria-invalid on
 *  the row's form control: the first [data-field] or control in the trail
 *  (its native input for a field), never on a chip, a preview or an action. */
export function setSettingError(row, text = "") {
  const node = row?.querySelector?.(".setting-error");
  if (!node) return;
  node.textContent = text;
  node.hidden = !text;
  const field = row.querySelector(".setting-trail")?.querySelector(FORM_CONTROL);
  const target = field?.matches("[data-field]") ? controlOf(field) || field : field;
  if (target) {
    if (text) target.setAttribute("aria-invalid", "true");
    else target.removeAttribute("aria-invalid");
  }
}

// ---------- Settings nav ----------

/**
 * Nav (§6.13): a vertical list of anchors; the current item has a tonal pill,
 * text-primary and aria-current="true". Item text sits on the nav's left edge
 * (the pill bleeds into the gap), the same edge as the page title.
 * @param {object} o
 * @param {{id: string, label: string, href?: string}[]} o.items  href defaults to "#id"
 * @param {string} [o.current]
 * @param {string} o.label  aria-label for the <nav>
 * @returns {{element: HTMLElement, setCurrent: (id: string) => void}}
 */
export function nav({ items = [], current, label = "" } = {}) {
  const element = document.createElement("nav");
  element.className = "nav";
  if (label) element.setAttribute("aria-label", label);
  const list = document.createElement("ul");
  list.className = "nav-list";
  for (const item of items) {
    const entry = document.createElement("li");
    const link = document.createElement("a");
    link.className = "nav-item t-row";
    link.href = item.href || `#${item.id}`;
    link.dataset.navId = item.id;
    link.textContent = item.label;
    entry.append(link);
    list.append(entry);
  }
  element.append(list);
  const setCurrent = (id) => {
    for (const link of list.querySelectorAll(".nav-item")) {
      if (link.dataset.navId === id) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
  };
  setCurrent(current ?? items[0]?.id);
  return { element, setCurrent };
}

// ---------- dialog ----------

/**
 * DialogShell (§6.12): a modal <dialog> on the raised surface (float radius
 * and shadow) that fits the 372 × 600 popup: title + close, a scrolling body,
 * and an action row that stays in view with 16px padding, never clipped.
 * Put at most one primary button in `actions`.
 * @param {object} o
 * @param {string} o.title
 * @param {Node|Node[]} [o.body]
 * @param {HTMLElement[]} [o.actions]  e.g. [button({kind:"tertiary"}), button({kind:"primary", type:"submit"})]
 * @param {(event: SubmitEvent) => void} [o.onSubmit]  the form submits on Enter and on a type=submit button
 * @param {(returnValue: string) => void} [o.onClose]
 * @returns {{dialog, form, heading, body, actions, open(), close(value?)}}
 */
export function dialogShell({ title, body = [], actions = [], id, onSubmit, onClose } = {}) {
  const dialog = document.createElement("dialog");
  dialog.className = "dialog-shell";
  dialog.id = id || nextId("fc-dialog");
  const form = document.createElement("form");
  form.className = "dialog-form";
  form.method = "dialog";
  form.noValidate = true;
  const head = document.createElement("header");
  head.className = "dialog-head";
  const heading = document.createElement("h2");
  heading.className = "t-title";
  heading.id = `${dialog.id}-title`;
  heading.textContent = title;
  const close = iconButton({ iconName: "close", label: msg("action.close"), action: "close" });
  close.classList.add("dialog-close");
  close.addEventListener("click", () => dialog.close("cancel"));
  head.append(heading, close);
  const bodyNode = document.createElement("div");
  bodyNode.className = "dialog-body";
  bodyNode.append(...[].concat(body));
  const actionRow = document.createElement("div");
  actionRow.className = "dialog-actions";
  actionRow.append(...actions);
  form.append(head, bodyNode, actionRow);
  dialog.append(form);
  dialog.setAttribute("aria-labelledby", heading.id);
  if (onSubmit) form.addEventListener("submit", onSubmit);
  // Escape closes without a result, which would leave the previous returnValue
  // in place (a stale "submit" reads as a confirmation): report it as "cancel",
  // like the close button.
  dialog.addEventListener("cancel", () => { dialog.returnValue = "cancel"; });
  // Chrome skips the cancel event for a close request without user activation
  // (Escape is not an activation), so a dialog opened from script closes with
  // an empty result. Every deliberate close passes a value; an empty one is a cancel.
  dialog.addEventListener("close", () => { if (!dialog.returnValue) dialog.returnValue = "cancel"; });
  if (onClose) dialog.addEventListener("close", () => onClose(dialog.returnValue));
  return {
    dialog,
    form,
    heading,
    body: bodyNode,
    actions: actionRow,
    open() {
      if (dialog.open) return;
      dialog.returnValue = "";
      dialog.showModal();
    },
    close(value = "") { if (dialog.open) dialog.close(value); }
  };
}

// ---------- segmented control ----------

/**
 * Segmented control (§6.3): sunken track, raised selection, arrow-key, Home
 * and End selection with a roving tabindex. Width and neighbours never change;
 * count chips are hidden at 0.
 * role "tablist" (default): role=tab options with aria-selected, for views
 * with panels (aria-controls). role "radiogroup": role=radio options with
 * aria-checked, for a choice of one value with no panels (speed presets,
 * a theme); the keyboard model is the same.
 * @param {object} o
 * @param {{value: string, label: string, count?: number, controls?: string}[]} o.items
 * @param {string} [o.current]
 * @param {string} o.label  aria-label for the group
 * @param {"tablist"|"radiogroup"} [o.role]
 * @param {(value: string) => void} [o.onSelect]
 * @returns {{element, select(value, {focus}), setCount(value, n), setDisabled(value, bool)}}
 */
export function segmented({ items = [], current, label = "", role = "tablist", onSelect, id } = {}) {
  const radio = role === "radiogroup";
  // The attribute that carries the selection: aria-checked on a radio, aria-selected on a tab.
  const stateAttribute = radio ? "aria-checked" : "aria-selected";
  const element = document.createElement("div");
  element.className = "segmented";
  element.setAttribute("role", radio ? "radiogroup" : "tablist");
  if (label) element.setAttribute("aria-label", label);
  if (id) element.id = id;
  const tabs = items.map((item) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.setAttribute("role", radio ? "radio" : "tab");
    tab.dataset.value = item.value;
    if (item.controls && !radio) tab.setAttribute("aria-controls", item.controls);
    const words = document.createElement("span");
    words.textContent = item.label;
    const count = document.createElement("span");
    count.className = "count";
    tab.append(words, count);
    element.append(tab);
    return tab;
  });
  const byValue = (value) => tabs.find((tab) => tab.dataset.value === value);
  const api = {
    element,
    select(value, { focus = false } = {}) {
      for (const tab of tabs) {
        const selected = tab.dataset.value === value;
        tab.setAttribute(stateAttribute, String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus();
      }
      keepTabStop();
    },
    setCount(value, n) {
      const count = byValue(value)?.querySelector(".count");
      if (!count) return;
      const number = Number(n) || 0;
      count.textContent = number ? formatCount(number) : "";
      count.hidden = number === 0;
    },
    setDisabled(value, disabled) {
      const tab = byValue(value);
      if (tab) tab.disabled = Boolean(disabled);
      keepTabStop();
    }
  };
  // Roving tabindex needs exactly one focusable option: when the selected one
  // is missing (unknown value) or disabled, the first enabled option takes the stop.
  function keepTabStop() {
    const selected = tabs.find((tab) => tab.getAttribute(stateAttribute) === "true" && !tab.disabled);
    const stop = selected || tabs.find((tab) => !tab.disabled);
    for (const tab of tabs) tab.tabIndex = tab === stop ? 0 : -1;
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => { api.select(tab.dataset.value); onSelect?.(tab.dataset.value); });
    tab.addEventListener("keydown", (event) => {
      const enabled = tabs.filter((candidate) => !candidate.disabled);
      const index = enabled.indexOf(tab);
      const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: enabled.length - 1 }[event.key];
      if (next === undefined || !enabled.length) return;
      event.preventDefault();
      const target = enabled[(next + enabled.length) % enabled.length];
      api.select(target.dataset.value, { focus: true });
      onSelect?.(target.dataset.value);
    });
  }
  items.forEach((item) => api.setCount(item.value, item.count));
  api.select(current ?? items[0]?.value);
  return api;
}
