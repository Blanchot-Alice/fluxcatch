const pendingActions = new Map();

export const TOAST_DURATIONS = Object.freeze({
  success: 1800,
  warning: 3200,
  error: 5000
});

function assertAction(key, operation) {
  if ((typeof key !== "string" && typeof key !== "symbol") || key === "") {
    throw new TypeError("An action key must be a non-empty string or a symbol");
  }
  if (typeof operation !== "function") throw new TypeError("An action operation must be a function");
}

/** Return whether an operation currently owns the supplied action key. */
export function isActionPending(key) {
  return pendingActions.has(key);
}

/**
 * Run one operation per key. A duplicate caller receives the in-flight promise,
 * but its operation is never invoked.
 */
export function runKeyedAction(key, operation) {
  assertAction(key, operation);
  const existing = pendingActions.get(key);
  if (existing) return existing;

  const task = Promise.resolve().then(operation);
  pendingActions.set(key, task);
  const release = () => {
    if (pendingActions.get(key) === task) pendingActions.delete(key);
  };
  // Supply both handlers so the cleanup branch never creates an unhandled
  // rejection while the original task still rejects for its callers.
  task.then(release, release);
  return task;
}

function readAttribute(element, name) {
  return typeof element.getAttribute === "function" ? element.getAttribute(name) : null;
}

function hasAttribute(element, name) {
  return typeof element.hasAttribute === "function" ? element.hasAttribute(name) : readAttribute(element, name) !== null;
}

function setAttribute(element, name, value) {
  if (typeof element.setAttribute === "function") element.setAttribute(name, String(value));
}

function removeAttribute(element, name) {
  if (typeof element.removeAttribute === "function") element.removeAttribute(name);
}

function restoreAttribute(element, name, snapshot) {
  if (snapshot.present) setAttribute(element, name, snapshot.value);
  else removeAttribute(element, name);
}

function snapshotAttribute(element, name) {
  return { present: hasAttribute(element, name), value: readAttribute(element, name) };
}

function optionText(options, name) {
  return Object.prototype.hasOwnProperty.call(options, name) ? String(options[name] ?? "") : null;
}

function setLabel(label, value) {
  if (value !== null && label && "textContent" in label) label.textContent = value;
}

function measuredWidth(element) {
  if (typeof element.getBoundingClientRect === "function") {
    const width = Number(element.getBoundingClientRect()?.width);
    if (Number.isFinite(width) && width > 0) return width;
  }
  for (const value of [element.offsetWidth, element.clientWidth]) {
    const width = Number(value);
    if (Number.isFinite(width) && width > 0) return width;
  }
  return null;
}

function delay(ms) {
  const duration = Math.max(0, Number(ms) || 0);
  return duration ? new Promise((resolve) => setTimeout(resolve, duration)) : Promise.resolve();
}

/**
 * Apply a complete pending/success/failure lifecycle to an actionable element.
 * All element state is restored in finally, including the exact prior inline
 * width. The operation's value and error semantics are preserved.
 */
export function withPendingAction(element, key, operation, options = {}) {
  assertAction(key, operation);
  if (!element || typeof element !== "object") throw new TypeError("An actionable element is required");

  const existing = pendingActions.get(key);
  if (existing) return existing;

  const label = options.labelElement || element;
  const pendingText = optionText(options, "pendingText");
  const successText = optionText(options, "successText");
  const failureText = optionText(options, "failureText");
  const successDurationMs = options.successDurationMs ?? 700;
  const failureDurationMs = options.failureDurationMs ?? 1000;
  const original = {
    ariaBusy: snapshotAttribute(element, "aria-busy"),
    ariaDisabled: snapshotAttribute(element, "aria-disabled"),
    uiState: snapshotAttribute(element, "data-ui-state"),
    disabled: "disabled" in element ? Boolean(element.disabled) : null,
    text: label && "textContent" in label ? label.textContent : null,
    inlineWidth: element.style && "width" in element.style ? element.style.width : null
  };

  const width = measuredWidth(element);
  if (width !== null && element.style && "width" in element.style) element.style.width = `${width}px`;
  if ("disabled" in element) element.disabled = true;
  setAttribute(element, "aria-disabled", "true");
  setAttribute(element, "aria-busy", "true");
  setAttribute(element, "data-ui-state", "pending");
  setLabel(label, pendingText);

  return runKeyedAction(key, async () => {
    try {
      const result = await operation();
      setAttribute(element, "aria-busy", "false");
      setAttribute(element, "data-ui-state", "success");
      setLabel(label, successText === null ? original.text : successText);
      await delay(successDurationMs);
      return result;
    } catch (error) {
      setAttribute(element, "aria-busy", "false");
      setAttribute(element, "data-ui-state", "failure");
      setLabel(label, failureText === null ? original.text : failureText);
      await delay(failureDurationMs);
      throw error;
    } finally {
      if (original.disabled !== null) element.disabled = original.disabled;
      restoreAttribute(element, "aria-busy", original.ariaBusy);
      restoreAttribute(element, "aria-disabled", original.ariaDisabled);
      restoreAttribute(element, "data-ui-state", original.uiState);
      if (label && "textContent" in label) label.textContent = original.text;
      if (original.inlineWidth !== null && element.style && "width" in element.style) {
        element.style.width = original.inlineWidth;
      }
    }
  });
}

function toastSemantics(type) {
  return type === "error"
    ? { role: "alert", live: "assertive" }
    : { role: "status", live: "polite" };
}

/**
 * Create a small typed-toast controller. The optional scheduler is dependency
 * injection for deterministic tests; production callers use platform timers.
 */
export function createToastController(container, scheduler = {}) {
  if (!container || typeof container !== "object" || typeof container.replaceChildren !== "function") {
    throw new TypeError("A toast container with replaceChildren() is required");
  }
  const setTimer = scheduler.setTimeout || globalThis.setTimeout;
  const clearTimer = scheduler.clearTimeout || globalThis.clearTimeout;
  if (typeof setTimer !== "function" || typeof clearTimer !== "function") {
    throw new TypeError("Toast scheduler functions are required");
  }
  const documentRef = container.ownerDocument || globalThis.document;
  if (!documentRef || typeof documentRef.createElement !== "function") {
    throw new TypeError("The toast container must provide an ownerDocument");
  }

  let timer = null;
  let generation = 0;

  const close = () => {
    generation += 1;
    if (timer !== null) clearTimer(timer);
    timer = null;
    container.hidden = true;
    container.classList?.remove?.("show");
    removeAttribute(container, "data-toast-type");
  };

  const show = (message, type = "success") => {
    if (!Object.prototype.hasOwnProperty.call(TOAST_DURATIONS, type)) {
      throw new TypeError(`Unsupported toast type: ${type}`);
    }
    if (timer !== null) clearTimer(timer);
    timer = null;
    const currentGeneration = ++generation;
    const semantics = toastSemantics(type);
    const dismissCurrent = () => {
      if (generation === currentGeneration) close();
    };

    const text = documentRef.createElement("span");
    text.className = "toast-message";
    text.textContent = String(message ?? "");
    const children = [text];
    if (type === "error") {
      const dismiss = documentRef.createElement("button");
      dismiss.type = "button";
      dismiss.className = "toast-close";
      dismiss.textContent = "×";
      dismiss.setAttribute("aria-label", "关闭提示");
      dismiss.addEventListener("click", dismissCurrent);
      children.push(dismiss);
    }

    container.replaceChildren(...children);
    container.hidden = false;
    container.classList?.add?.("show");
    setAttribute(container, "data-toast-type", type);
    setAttribute(container, "role", semantics.role);
    setAttribute(container, "aria-live", semantics.live);
    setAttribute(container, "aria-atomic", "true");
    timer = setTimer(dismissCurrent, TOAST_DURATIONS[type]);
    return { type, durationMs: TOAST_DURATIONS[type], close: dismissCurrent };
  };

  return Object.freeze({
    show,
    success: (message) => show(message, "success"),
    warning: (message) => show(message, "warning"),
    error: (message) => show(message, "error"),
    close,
    destroy: close
  });
}

function isNativeFocusable(element) {
  const name = String(element.tagName || "").toUpperCase();
  if (["BUTTON", "SELECT", "TEXTAREA", "SUMMARY"].includes(name)) return true;
  if (name === "INPUT") return String(element.type || "").toLowerCase() !== "hidden";
  if (name === "A" || name === "AREA") return Boolean(readAttribute(element, "href"));
  return Boolean(element.isContentEditable);
}

/** Restore focus only when the former target remains connected and focusable. */
export function restoreFocus(element) {
  if (!element || element.isConnected !== true || typeof element.focus !== "function") return false;
  if (element.disabled || element.hidden || element.inert) return false;
  if (readAttribute(element, "aria-disabled") === "true" || readAttribute(element, "aria-hidden") === "true") return false;
  if (typeof element.matches === "function" && element.matches(":disabled, [hidden], [inert]")) return false;
  const tabIndex = Number(element.tabIndex);
  if (!(Number.isFinite(tabIndex) && tabIndex >= 0) && !isNativeFocusable(element)) return false;
  try {
    element.focus({ preventScroll: true });
    return true;
  } catch {
    return false;
  }
}
