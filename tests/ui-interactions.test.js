import test from "node:test";
import assert from "node:assert/strict";
import {
  TOAST_DURATIONS,
  createToastController,
  isActionPending,
  restoreFocus,
  runKeyedAction,
  withPendingAction
} from "../extension/ui/interactions.js";

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(value) { this.values.add(value); }
  remove(value) { this.values.delete(value); }
  contains(value) { return this.values.has(value); }
}

class FakeElement {
  constructor(tagName = "button", ownerDocument = null) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.attributeLog = [];
    this.children = [];
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.style = { width: "" };
    this.disabled = false;
    this.hidden = false;
    this.inert = false;
    this.isConnected = true;
    this.isContentEditable = false;
    this.tabIndex = this.tagName === "DIV" ? -1 : 0;
    this.textContent = "";
    this.type = "button";
    this.rectWidth = 0;
    this.focusCalls = [];
  }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    this.attributeLog.push(["set", name, text]);
  }
  getAttribute(name) { return this.attributes.has(name) ? this.attributes.get(name) : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) {
    this.attributes.delete(name);
    this.attributeLog.push(["remove", name]);
  }
  getBoundingClientRect() { return { width: this.rectWidth }; }
  replaceChildren(...children) { this.children = children; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  click() { this.listeners.get("click")?.({ currentTarget: this }); }
  focus(options) { this.focusCalls.push(options); }
  matches(selector) {
    if (!selector.includes(":disabled")) return false;
    return this.disabled || this.hidden || this.inert;
  }
}

class FakeDocument {
  createElement(tagName) { return new FakeElement(tagName, this); }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

test("keyed actions invoke one operation and share its in-flight result", async () => {
  const gate = deferred();
  let calls = 0;
  const first = runKeyedAction("unit:shared", async () => {
    calls += 1;
    await gate.promise;
    return "done";
  });
  const duplicate = runKeyedAction("unit:shared", () => {
    calls += 100;
    return "duplicate";
  });

  assert.strictEqual(duplicate, first);
  assert.equal(isActionPending("unit:shared"), true);
  await Promise.resolve();
  assert.equal(calls, 1);
  gate.resolve();
  assert.equal(await first, "done");
  await Promise.resolve();
  assert.equal(isActionPending("unit:shared"), false);
});

test("keyed action cleanup also runs after rejection", async () => {
  const expected = new Error("expected failure");
  await assert.rejects(runKeyedAction("unit:reject", () => { throw expected; }), (error) => error === expected);
  await Promise.resolve();
  assert.equal(isActionPending("unit:reject"), false);
});

test("withPendingAction sets state synchronously and restores every original value", async () => {
  const button = new FakeElement();
  button.textContent = "开始";
  button.rectWidth = 123.5;
  button.style.width = "37%";
  button.setAttribute("aria-busy", "mixed");
  button.setAttribute("data-ui-state", "idle");
  const gate = deferred();
  let calls = 0;

  const task = withPendingAction(button, "unit:button", async () => {
    calls += 1;
    await gate.promise;
    return 42;
  }, {
    pendingText: "处理中…",
    successText: "已完成 ✓",
    failureText: "失败",
    successDurationMs: 0
  });

  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.getAttribute("data-ui-state"), "pending");
  assert.equal(button.textContent, "处理中…");
  assert.equal(button.style.width, "123.5px");
  const duplicate = withPendingAction(button, "unit:button", () => { calls += 100; });
  assert.strictEqual(duplicate, task);

  gate.resolve();
  assert.equal(await task, 42);
  assert.equal(calls, 1);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-busy"), "mixed");
  assert.equal(button.hasAttribute("aria-disabled"), false);
  assert.equal(button.getAttribute("data-ui-state"), "idle");
  assert.equal(button.textContent, "开始");
  assert.equal(button.style.width, "37%");
  assert.ok(button.attributeLog.some((entry) => entry[0] === "set" && entry[1] === "data-ui-state" && entry[2] === "success"));
});

test("withPendingAction exposes failure state, restores state and rethrows the same error", async () => {
  const button = new FakeElement();
  button.textContent = "重试";
  button.rectWidth = 80;
  button.disabled = true;
  button.setAttribute("aria-disabled", "true");
  const expected = new Error("operation failed");

  const task = withPendingAction(button, "unit:failure", () => { throw expected; }, {
    pendingText: "检查中…",
    failureText: "检查失败",
    failureDurationMs: 0
  });
  await assert.rejects(task, (error) => error === expected);

  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-disabled"), "true");
  assert.equal(button.hasAttribute("aria-busy"), false);
  assert.equal(button.hasAttribute("data-ui-state"), false);
  assert.equal(button.textContent, "重试");
  assert.equal(button.style.width, "");
  assert.ok(button.attributeLog.some((entry) => entry[0] === "set" && entry[1] === "data-ui-state" && entry[2] === "failure"));
  assert.equal(isActionPending("unit:failure"), false);
});

test("toast controller applies exact timing, semantics and a dismissible error", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div", document);
  container.hidden = true;
  let nextTimer = 1;
  const timers = new Map();
  const cleared = [];
  const controller = createToastController(container, {
    setTimeout(callback, duration) {
      const id = nextTimer++;
      timers.set(id, { callback, duration });
      return id;
    },
    clearTimeout(id) {
      cleared.push(id);
      timers.delete(id);
    }
  });

  const success = controller.success("已完成");
  assert.equal(success.type, "success");
  assert.equal(success.durationMs, 1800);
  assert.equal(typeof success.close, "function");
  assert.equal(timers.get(1).duration, TOAST_DURATIONS.success);
  assert.equal(container.getAttribute("role"), "status");
  assert.equal(container.getAttribute("aria-live"), "polite");
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].textContent, "已完成");
  assert.equal(container.hidden, false);
  assert.equal(container.classList.contains("show"), true);

  controller.warning("请注意");
  assert.ok(cleared.includes(1));
  assert.equal(timers.get(2).duration, TOAST_DURATIONS.warning);
  assert.equal(container.getAttribute("role"), "status");

  controller.error("操作失败");
  assert.ok(cleared.includes(2));
  assert.equal(timers.get(3).duration, TOAST_DURATIONS.error);
  assert.equal(container.getAttribute("role"), "alert");
  assert.equal(container.getAttribute("aria-live"), "assertive");
  assert.equal(container.getAttribute("data-toast-type"), "error");
  assert.equal(container.children.length, 2);
  const closeButton = container.children[1];
  assert.equal(closeButton.tagName, "BUTTON");
  assert.equal(closeButton.getAttribute("aria-label"), "关闭提示");
  closeButton.click();
  assert.equal(container.hidden, true);
  assert.equal(container.classList.contains("show"), false);
  assert.ok(cleared.includes(3));
});

test("a stale toast timer cannot dismiss a newer toast", () => {
  const document = new FakeDocument();
  const container = new FakeElement("div", document);
  const timers = [];
  const controller = createToastController(container, {
    setTimeout(callback, duration) { timers.push({ callback, duration }); return timers.length; },
    clearTimeout() {}
  });
  controller.error("first");
  const staleClose = container.children[1];
  controller.warning("second");
  timers[0].callback();
  staleClose.click();
  assert.equal(container.hidden, false);
  assert.equal(container.children[0].textContent, "second");
  timers[1].callback();
  assert.equal(container.hidden, true);
});

test("restoreFocus only focuses a connected, enabled and focusable target", () => {
  const button = new FakeElement("button");
  assert.equal(restoreFocus(button), true);
  assert.deepEqual(button.focusCalls, [{ preventScroll: true }]);

  const disconnected = new FakeElement("button");
  disconnected.isConnected = false;
  assert.equal(restoreFocus(disconnected), false);
  assert.equal(disconnected.focusCalls.length, 0);

  const disabled = new FakeElement("button");
  disabled.disabled = true;
  assert.equal(restoreFocus(disabled), false);

  const plainDiv = new FakeElement("div");
  assert.equal(restoreFocus(plainDiv), false);

  const linked = new FakeElement("a");
  linked.tabIndex = -1;
  linked.setAttribute("href", "#target");
  assert.equal(restoreFocus(linked), true);
});
