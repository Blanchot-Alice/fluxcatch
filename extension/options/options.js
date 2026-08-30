import { BUILD_PROFILE, HOST_MISMATCH_MESSAGE } from "../lib/build-profile.js";
import { insertTemplateToken, normalizeFormState, notificationStatusText, reconcileSaveCompletion, resolveNotificationLoadState, statesEqual, validateSettings } from "./form-state.js";
import { waitForNativeRecovery } from "./native-recovery.js";
import { isActionPending, restoreFocus, runKeyedAction, withPendingAction } from "../ui/interactions.js";
import { bindUiCustomization } from "../ui/customization.js";
import { bindUiI18n, changeUiLanguage, loadUiLanguage } from "../ui/i18n.js";

let domContentLoadedSeen = document.readyState !== "loading";
document.addEventListener("DOMContentLoaded", () => { domContentLoadedSeen = true; }, { once: true });
await bindUiI18n();

const form = document.querySelector("#settingsForm");
const saveButton = form.querySelector(".save-btn");
const discardButton = document.querySelector("#discardChangesButton");
const dirtyStatus = document.querySelector("#dirtyStatus");
const status = document.querySelector("#saveStatus");
const errorSummary = document.querySelector("#errorSummary");
const errorSummaryList = document.querySelector("#errorSummaryList");
const nativePermissionButton = document.querySelector("#nativePermissionButton");
const nativePermissionStatus = document.querySelector("#nativePermissionStatus");
const nativeInstallGuide = document.querySelector("#nativeInstallGuide");
const notificationInput = form.elements.namedItem("showNotifications");
const notificationPermissionStatus = document.querySelector("#notificationPermissionStatus");
const privateNetworkInput = form.elements.namedItem("allowPrivateNetworkMedia");
const privateNetworkDialog = document.querySelector("#privateNetworkDialog");
const privateNetworkCancelButton = document.querySelector("#privateNetworkCancelButton");
const copyDiagnosticsButton = document.querySelector("#copyDiagnosticsButton");
const templateInput = form.elements.namedItem("filenameTemplate");
const optionsLoadState = document.querySelector("#optionsLoadState");
const optionsLoadMessage = document.querySelector("#optionsLoadMessage");
const retrySettingsButton = document.querySelector("#retrySettingsButton");

const CAPABILITY_LABELS = Object.freeze({
  directMedia: "普通视频与音频文件",
  staticHls: "静态 HLS 视频",
  staticDash: "静态 DASH 视频",
  bilibiliDashPair: "哔哩哔哩分离音视频合并",
  liveHls: "HLS 直播",
  encryptedHls: "加密 HLS",
  separateAudioHls: "HLS 独立音轨",
  externalToolNetwork: "外部下载工具联网",
  remoteThumbnails: "远程视频封面"
});

const LAB_FEATURES = Object.freeze([
  "externalToolNetwork",
  "liveHls",
  "encryptedHls"
]);

const PRESETS = Object.freeze([
  Object.freeze({ name: "stable", fragments: 4, ranges: 4 }),
  Object.freeze({ name: "balanced", fragments: 8, ranges: 8 }),
  Object.freeze({ name: "fast", fragments: 12, ranges: 12 })
]);

let baseline = null;
let diagnostics = null;
let nativePermissionGranted = false;
let notificationPermissionGranted = false;
let ready = false;
let dirty = false;
let statusTimer = null;
let privateNetworkTrigger = null;
let templateSelection = { start: 0, end: 0 };

document.addEventListener("DOMContentLoaded", initialize, { once: true });

function initialize() {
  void bindUiCustomization();
  renderCapabilities();
  renderLabStates();
  bindFormInteractions();
  void load();
}

function bindFormInteractions() {
  form.addEventListener("submit", (event) => void save(event));
  form.addEventListener("input", handleFormMutation);
  form.addEventListener("change", handleFormMutation);
  discardButton.addEventListener("click", discardChanges);
  nativePermissionButton.addEventListener("click", () => void requestNativeAccess());
  copyDiagnosticsButton.addEventListener("click", () => void copyDiagnostics());
  retrySettingsButton.addEventListener("click", () => void load());
  notificationInput.addEventListener("change", () => void changeNotificationPermission());
  privateNetworkInput.addEventListener("change", handlePrivateNetworkChange);
  privateNetworkDialog.addEventListener("close", finishPrivateNetworkConfirmation);
  window.addEventListener("beforeunload", handleBeforeUnload);
  chrome.permissions?.onAdded?.addListener(handleNativePermissionChange);
  chrome.permissions?.onRemoved?.addListener(handleNativePermissionChange);

  for (const button of document.querySelectorAll(".preset-button")) {
    button.addEventListener("click", () => applyPreset(button));
  }
  for (const button of document.querySelectorAll(".token-chip")) {
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => insertFilenameToken(button.dataset.token));
  }
  for (const type of ["click", "keyup", "select", "input", "blur"]) {
    templateInput.addEventListener(type, rememberTemplateSelection);
  }
}

function handleNativePermissionChange(permissions) {
  if (!permissions?.permissions?.includes("nativeMessaging")
      || isActionPending("native-access") || isActionPending("native-recovery")) return;
  void refreshNativeAccess();
}

async function load() {
  ready = false;
  setOptionsLoadState("loading", "正在加载设置…");
  form.inert = true;
  form.setAttribute("aria-busy", "true");
  syncDirtyState();
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response?.ok) throw new Error(response?.error || "读取设置失败");
    notificationPermissionGranted = await chrome.permissions.contains({ permissions: ["notifications"] });
    let loaded = stateFromSettings(response.settings || {});
    const notificationLoad = resolveNotificationLoadState({
      persisted: loaded.showNotifications,
      permissionGranted: notificationPermissionGranted
    });
    if (notificationLoad.requiresRepair) {
      const repaired = await chrome.runtime.sendMessage({
        type: "SAVE_SETTINGS",
        settings: { ...(response.settings || {}), showNotifications: false }
      });
      if (!repaired?.ok) throw new Error(repaired?.error || "通知设置同步失败");
      loaded = stateFromSettings(repaired.settings || { ...(response.settings || {}), showNotifications: false });
    }
    loaded.showNotifications = notificationLoad.checked;
    writeFormState(loaded);
    baseline = normalizeFormState(loaded);
    ready = true;
    form.inert = false;
    form.removeAttribute("aria-busy");
    setOptionsLoadState("ready", "设置已加载");
    clearValidation();
    syncDirtyState();
    renderNotificationStatus();
    await Promise.allSettled([refreshNativeAccess(), refreshDiagnostics()]);
  } catch (error) {
    ready = false;
    form.inert = true;
    form.setAttribute("aria-busy", "false");
    const message = error?.message || "读取设置失败";
    setOptionsLoadState("error", `${message}。请重新读取。`);
    setStatus(message, "error", 5000);
    nativePermissionStatus.textContent = "暂时未能检查本地下载引擎";
    renderHostStatus({ connected: false }, { permissionGranted: false, failed: true });
    syncDirtyState();
  }
}

function stateFromSettings(settings) {
  return {
    concurrentFragments: settings.concurrentFragments,
    concurrentRanges: settings.concurrentRanges,
    outputContainer: settings.outputContainer,
    minimumKiB: Math.round(Number(settings.minimumBytes || 0) / 1024),
    filenameTemplate: settings.filenameTemplate,
    blockedDomains: Array.isArray(settings.blockedDomains) ? settings.blockedDomains : [],
    saveAs: Boolean(settings.saveAs),
    useNativeForDirect: Boolean(settings.useNativeForDirect),
    allowPrivateNetworkMedia: Boolean(settings.allowPrivateNetworkMedia),
    autoEnrichSiteQuality: typeof settings.autoEnrichSiteQuality === "boolean"
      ? settings.autoEnrichSiteQuality
      : true,
    showNotifications: Boolean(settings.showNotifications)
  };
}

function collectRawState() {
  return {
    concurrentFragments: form.elements.namedItem("concurrentFragments").value,
    concurrentRanges: form.elements.namedItem("concurrentRanges").value,
    outputContainer: form.elements.namedItem("outputContainer").value,
    minimumKiB: form.elements.namedItem("minimumKiB").value,
    filenameTemplate: templateInput.value,
    blockedDomains: form.elements.namedItem("blockedDomains").value,
    saveAs: form.elements.namedItem("saveAs").checked,
    useNativeForDirect: form.elements.namedItem("useNativeForDirect").checked,
    allowPrivateNetworkMedia: privateNetworkInput.checked,
    autoEnrichSiteQuality: form.elements.namedItem("autoEnrichSiteQuality").checked,
    showNotifications: notificationInput.checked
  };
}

function writeFormState(value) {
  const state = normalizeFormState(value);
  form.elements.namedItem("concurrentFragments").value = state.concurrentFragments;
  form.elements.namedItem("concurrentRanges").value = state.concurrentRanges;
  form.elements.namedItem("outputContainer").value = state.outputContainer;
  form.elements.namedItem("minimumKiB").value = state.minimumKiB;
  templateInput.value = state.filenameTemplate;
  form.elements.namedItem("blockedDomains").value = state.blockedDomains.join("\n");
  for (const key of ["saveAs", "useNativeForDirect", "allowPrivateNetworkMedia", "autoEnrichSiteQuality", "showNotifications"]) {
    form.elements.namedItem(key).checked = state[key];
  }
  rememberTemplateSelection();
  syncPresetState();
  renderTemplatePreview();
  renderNetworkScope();
}

function handleFormMutation(event) {
  const field = event.target?.name;
  if (field) clearFieldError(field);
  hideErrorSummary();
  clearStatus();
  if (field === "concurrentFragments" || field === "concurrentRanges") syncPresetState();
  if (field === "filenameTemplate") renderTemplatePreview();
  if (field === "allowPrivateNetworkMedia") renderNetworkScope();
  syncDirtyState();
  if (field === "showNotifications" && !isActionPending("notification-permission")) renderNotificationStatus();
}

function syncDirtyState() {
  dirty = Boolean(ready && baseline && !statesEqual(collectRawState(), baseline));
  form.dataset.dirty = String(dirty);
  dirtyStatus.textContent = !ready ? "设置尚未就绪" : dirty ? "有未保存的更改" : "所有更改均已保存";
  const pending = isActionPending("options-save");
  saveButton.disabled = !ready || !dirty || pending;
  discardButton.disabled = !ready || !dirty || pending;
}

function setOptionsLoadState(type, message) {
  optionsLoadMessage.textContent = message;
  optionsLoadState.dataset.state = type;
  optionsLoadState.hidden = type === "ready";
  optionsLoadState.querySelector(".spinner").hidden = type !== "loading";
  retrySettingsButton.hidden = type !== "error";
  retrySettingsButton.disabled = type === "loading";
}

function handleBeforeUnload(event) {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
}

function discardChanges() {
  if (!baseline || !dirty || isActionPending("options-save")) return;
  writeFormState(baseline);
  clearValidation();
  clearStatus();
  syncDirtyState();
  renderNotificationStatus();
}

async function save(event) {
  event.preventDefault();
  if (!ready || !dirty || isActionPending("options-save")) return;
  const submittedState = collectRawState();
  const validation = validateSettings(submittedState);
  if (!validation.valid) {
    renderValidation(validation);
    syncDirtyState();
    return;
  }

  clearValidation();
  setStatus("保存中…", "pending");
  form.setAttribute("aria-busy", "true");
  try {
    await withPendingAction(saveButton, "options-save", async () => {
      const normalized = validation.normalized;
      const settings = {
        concurrentFragments: normalized.concurrentFragments,
        concurrentRanges: normalized.concurrentRanges,
        outputContainer: normalized.outputContainer,
        liveDuration: 0,
        minimumBytes: normalized.minimumKiB * 1024,
        filenameTemplate: normalized.filenameTemplate,
        blockedDomains: normalized.blockedDomains,
        saveAs: normalized.saveAs,
        useNativeForDirect: normalized.useNativeForDirect,
        allowPrivateNetworkMedia: normalized.allowPrivateNetworkMedia,
        autoEnrichSiteQuality: normalized.autoEnrichSiteQuality,
        youtubeEnabled: false,
        showNotifications: normalized.showNotifications
      };
      const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
      if (!response?.ok) throw new Error(response?.error || "保存失败");
      const saved = stateFromSettings(response.settings || settings);
      saved.showNotifications = normalized.showNotifications;
      const completion = reconcileSaveCompletion({
        submitted: submittedState,
        current: collectRawState(),
        saved
      });
      baseline = completion.baseline;
      if (!completion.changedDuringSave) writeFormState(completion.formState);
      clearValidation();
      syncDirtyState();
      renderNotificationStatus();
      if (completion.changedDuringSave) {
        setStatus("已保存提交内容；保存期间有新的更改", "warning", 5000);
      } else {
        setStatus("已保存 ✓", "success", 1800);
      }
    }, {
      pendingText: "保存中…",
      successText: "已保存 ✓",
      failureText: "保存失败",
      successDurationMs: 850,
      failureDurationMs: 900
    });
  } catch (error) {
    setStatus(error?.message || "保存失败", "error", 5000);
  } finally {
    form.removeAttribute("aria-busy");
    syncDirtyState();
  }
}

function renderValidation(validation) {
  clearValidation();
  for (const [field, messages] of Object.entries(validation.fieldErrors)) {
    const control = form.elements.namedItem(field);
    const error = document.querySelector(`#${field}Error`);
    control?.setAttribute("aria-invalid", "true");
    if (error) {
      error.textContent = messages.join(" ");
      error.hidden = false;
    }
  }
  errorSummaryList.replaceChildren();
  for (const error of validation.errors) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = `#${error.field}`;
    link.textContent = error.message;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      form.elements.namedItem(error.field)?.focus();
    });
    item.append(link);
    errorSummaryList.append(item);
  }
  errorSummary.hidden = false;
  form.elements.namedItem(validation.firstInvalidField)?.focus();
}

function clearValidation() {
  for (const control of form.querySelectorAll("[aria-invalid]")) control.removeAttribute("aria-invalid");
  for (const error of form.querySelectorAll(".field-error")) {
    error.textContent = "";
    error.hidden = true;
  }
  hideErrorSummary();
}

function clearFieldError(field) {
  form.elements.namedItem(field)?.removeAttribute("aria-invalid");
  const error = document.querySelector(`#${field}Error`);
  if (error) {
    error.textContent = "";
    error.hidden = true;
  }
}

function hideErrorSummary() {
  errorSummary.hidden = true;
  errorSummaryList.replaceChildren();
}

function applyPreset(button) {
  form.elements.namedItem("concurrentFragments").value = Number(button.dataset.fragments);
  form.elements.namedItem("concurrentRanges").value = Number(button.dataset.ranges);
  clearFieldError("concurrentFragments");
  clearFieldError("concurrentRanges");
  hideErrorSummary();
  clearStatus();
  syncPresetState();
  syncDirtyState();
}

function syncPresetState() {
  const fragments = Number(form.elements.namedItem("concurrentFragments").value);
  const ranges = Number(form.elements.namedItem("concurrentRanges").value);
  const current = PRESETS.find((preset) => preset.fragments === fragments && preset.ranges === ranges)?.name || null;
  for (const button of document.querySelectorAll(".preset-button")) {
    const selected = button.dataset.preset === current;
    button.classList.toggle("is-current", selected);
    button.setAttribute("aria-pressed", String(selected));
    if (selected) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }
}

function rememberTemplateSelection() {
  templateSelection = {
    start: Number.isInteger(templateInput.selectionStart) ? templateInput.selectionStart : templateInput.value.length,
    end: Number.isInteger(templateInput.selectionEnd) ? templateInput.selectionEnd : templateInput.value.length
  };
}

function insertFilenameToken(token) {
  const inserted = insertTemplateToken(templateInput.value, token, templateSelection.start, templateSelection.end);
  templateInput.value = inserted.value;
  templateInput.focus();
  templateInput.setSelectionRange(inserted.selectionStart, inserted.selectionEnd);
  rememberTemplateSelection();
  clearFieldError("filenameTemplate");
  hideErrorSummary();
  clearStatus();
  renderTemplatePreview();
  syncDirtyState();
}

function renderTemplatePreview() {
  const preview = document.querySelector("#filenameTemplatePreview strong");
  if (!preview) return;
  const values = { title: "示例视频", host: "media.example.com", kind: "HLS", height: "1080", date: "2026-08-23" };
  const rendered = String(templateInput.value || "")
    .replace(/\{(title|host|kind|height|date)\}/g, (_, key) => values[key])
    .trim();
  preview.textContent = rendered ? `${rendered}.mp4` : "可能生成空文件名";
}

function handlePrivateNetworkChange() {
  renderNetworkScope();
  if (!privateNetworkInput.checked || baseline?.allowPrivateNetworkMedia === true) return;
  privateNetworkInput.checked = false;
  renderNetworkScope();
  syncDirtyState();
  privateNetworkTrigger = privateNetworkInput;
  privateNetworkDialog.returnValue = "";
  privateNetworkInput.setAttribute("aria-controls", "privateNetworkDialog");
  privateNetworkInput.setAttribute("aria-expanded", "true");
  if (typeof privateNetworkDialog.showModal === "function") {
    privateNetworkDialog.showModal();
    queueMicrotask(() => privateNetworkCancelButton.focus());
  } else {
    const confirmed = typeof globalThis.confirm === "function"
      && globalThis.confirm("允许 FluxCatch 访问你局域网中的媒体设备？保留网络仍会被禁止。");
    privateNetworkDialog.returnValue = confirmed ? "confirm" : "cancel";
    finishPrivateNetworkConfirmation();
  }
}

function finishPrivateNetworkConfirmation() {
  privateNetworkInput.checked = privateNetworkDialog.returnValue === "confirm";
  privateNetworkInput.setAttribute("aria-expanded", "false");
  renderNetworkScope();
  syncDirtyState();
  const trigger = privateNetworkTrigger;
  privateNetworkTrigger = null;
  const restoreTrigger = () => {
    restoreFocus(trigger);
  };
  // Native <dialog> focus restoration completes after its close event and can
  // run after animation-frame callbacks. Use the next task so the browser
  // cannot move focus back onto the now-hidden dialog action afterwards.
  if (typeof globalThis.setTimeout === "function") {
    globalThis.setTimeout(restoreTrigger, 0);
  } else {
    queueMicrotask(restoreTrigger);
  }
}

function renderNetworkScope() {
  setRuntimeStatus(
    "runtimeNetworkStatus",
    privateNetworkInput.checked ? "公共网络与已确认的局域网" : "仅公共网络",
    privateNetworkInput.checked ? "warning" : "ok"
  );
}

function renderNotificationStatus(override = "") {
  if (override) {
    notificationPermissionStatus.textContent = override;
    return;
  }
  notificationPermissionStatus.textContent = notificationStatusText({
    checked: notificationInput.checked,
    baselineChecked: baseline?.showNotifications === true,
    dirty,
    permissionGranted: notificationPermissionGranted
  });
}

async function changeNotificationPermission() {
  if (isActionPending("notification-permission")) return;
  const wantsNotifications = notificationInput.checked;
  notificationPermissionStatus.textContent = wantsNotifications ? "正在请求通知权限…" : "通知将在保存后关闭";
  if (!wantsNotifications) {
    // The persisted setting remains the sole switch for emitting notifications.
    // Retaining an existing optional grant keeps Discard reversible; this copy
    // is explicit that the browser-level grant is not revoked here.
    syncDirtyState();
    renderNotificationStatus();
    return;
  }

  let permissionRequest;
  try {
    // This must remain the first asynchronous platform call made by the
    // notification switch's originating user gesture.
    permissionRequest = chrome.permissions.request({ permissions: ["notifications"] });
  } catch (error) {
    notificationPermissionGranted = false;
    notificationInput.checked = false;
    syncDirtyState();
    renderNotificationStatus(error?.message || "通知权限请求失败");
    return;
  }

  let outcome = "";
  try {
    await withPendingAction(notificationInput, "notification-permission", async () => {
      const granted = await permissionRequest;
      notificationPermissionGranted = granted;
      if (!granted) {
        notificationInput.checked = false;
        outcome = "未授予通知权限，通知保持关闭";
      } else {
        outcome = "通知权限已开启；保存后生效";
      }
    }, { successDurationMs: 0, failureDurationMs: 0 });
  } catch (error) {
    notificationPermissionGranted = false;
    notificationInput.checked = false;
    outcome = error?.message || "通知权限请求失败";
  } finally {
    syncDirtyState();
    renderNotificationStatus(outcome);
  }
}

async function requestNativeAccess() {
  if (isActionPending("native-access")) return;
  let permissionRequest;
  let permissionDenied = false;
  try {
    // Native Messaging optional permission must be requested directly from
    // this button's gesture, before awaiting any unrelated work.
    permissionRequest = chrome.permissions.request({ permissions: ["nativeMessaging"] });
  } catch (error) {
    nativePermissionStatus.textContent = error?.message || "本地下载引擎授权失败";
    return;
  }

  let granted = nativePermissionGranted;
  try {
    await withPendingAction(nativePermissionButton, "native-access", async () => {
      granted = await permissionRequest;
      nativePermissionGranted = granted;
      if (!granted) {
        permissionDenied = true;
        renderHostStatus({ connected: false, needsPermission: true }, { permissionGranted: false });
        nativePermissionStatus.textContent = "暂未开启；检测与预览仍可用，多数保存需本地下载引擎";
        throw new Error("暂未开启本地下载引擎");
      }
      nativePermissionStatus.textContent = "正在连接并检查本地工具…";
      const host = await pingNativeHost();
      renderHostStatus(host, { permissionGranted: true });
      const recovery = await recoverNativeApi(host);
      if (recovery.recoveryBlocked) {
        throw nativeAccessFlowFailure(
          "native_recovery_blocked",
          "Chrome 的连接接口长期未恢复，请完全退出并重新启动 Chrome"
        );
      }
      if (recovery.hostStatus?.needsPermission) {
        renderNativePermissionRequired("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权");
        throw nativeAccessFlowFailure(
          "native_permission_removed",
          "本地下载引擎授权已撤销"
        );
      }
      if (!recovery.diagnosticsRefreshed) await refreshDiagnostics();
      // Keep this as the final awaited check in the operation. onRemoved is
      // intentionally ignored while either native action owns the button, so
      // the successful action state must be gated on the live permission.
      nativePermissionGranted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
      if (!nativePermissionGranted) {
        renderNativePermissionRequired("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权");
        throw nativeAccessFlowFailure(
          "native_permission_removed",
          "本地下载引擎授权已撤销"
        );
      }
    }, {
      pendingText: "正在检查…",
      successText: "检查完成 ✓",
      failureText: "未完成",
      successDurationMs: 700,
      failureDurationMs: 900
    });
  } catch (error) {
    if (permissionDenied) {
      renderNativePermissionRequired("暂未开启；检测与预览仍可用，多数保存需本地下载引擎");
    } else if (error?.preserveNativeStatus !== true) {
      renderHostStatus({ connected: false }, { permissionGranted: granted, failed: true });
      nativePermissionStatus.textContent = error?.message || "检查失败，请确认配套程序已安装后重试";
    }
  } finally {
    try {
      nativePermissionGranted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
      if (!nativePermissionGranted) {
        renderNativePermissionRequired(permissionDenied
          ? "暂未开启；检测与预览仍可用，多数保存需本地下载引擎"
          : "本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权");
      }
    } catch (error) {
      nativePermissionStatus.textContent = error?.message || "暂时未能确认本地下载引擎授权状态";
    }
    nativePermissionButton.textContent = nativePermissionGranted ? "重新检查" : "开启本地下载引擎";
  }
}

function nativeAccessFlowFailure(code, message) {
  return Object.assign(new Error(message), { code, preserveNativeStatus: true });
}

function renderNativePermissionRequired(message) {
  nativePermissionGranted = false;
  renderHostStatus({ connected: false, needsPermission: true }, { permissionGranted: false });
  nativePermissionStatus.textContent = message;
}

async function refreshNativeAccess() {
  nativePermissionGranted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
  nativePermissionButton.textContent = nativePermissionGranted ? "重新检查" : "开启本地下载引擎";
  if (!nativePermissionGranted) {
    nativePermissionStatus.textContent = "检测与预览仍可用；多数媒体保存需要开启，仅可信 Instagram/X 固定来源例外";
    renderHostStatus({ connected: false, needsPermission: true }, { permissionGranted: false });
    return;
  }
  nativePermissionStatus.textContent = "已获授权；正在检查本地处理程序…";
  try {
    const host = await pingNativeHost();
    renderHostStatus(host, { permissionGranted: true });
    await recoverNativeApi(host);
  } catch (error) {
    renderHostStatus({ connected: false }, { permissionGranted: true, failed: true });
    nativePermissionStatus.textContent = error?.message || "暂时未能连接本地下载引擎";
  } finally {
    try {
      nativePermissionGranted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
      if (!nativePermissionGranted) {
        renderNativePermissionRequired("本地下载引擎尚未授权；检测与预览仍可用，多数保存需先授权");
      }
    } catch {
      // Keep the last truthful host result when Chrome cannot answer the
      // permission query; the next permission event or recheck retries it.
    }
  }
}

async function recoverNativeApi(host) {
  if (host?.failureReason !== "api_unavailable") {
    return { recoveryBlocked: false, diagnosticsRefreshed: false, hostStatus: host };
  }
  try {
    return await withPendingAction(nativePermissionButton, "native-recovery", () => completeNativeApiRecovery(host), {
      pendingText: "正在初始化…",
      successDurationMs: 0,
      failureDurationMs: 0
    });
  } finally {
    nativePermissionButton.textContent = nativePermissionGranted ? "重新检查" : "开启本地下载引擎";
  }
}

async function completeNativeApiRecovery(host) {
  let response = await requestNativeApiRecovery();
  let recoveredHost = response.hostStatus || host;
  if (recoveredHost.needsPermission) {
    renderNativePermissionRequired("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权");
    return { recoveryBlocked: false, diagnosticsRefreshed: false, hostStatus: recoveredHost };
  }
  renderHostStatus(recoveredHost, { permissionGranted: true });
  const retryAfterMs = Number.isFinite(response.retryAfterMs)
    ? Math.max(0, Math.min(120_000, response.retryAfterMs))
    : 0;
  if (retryAfterMs > 0) {
    nativePermissionStatus.textContent = `授权已生效，Chrome 正在完成初始化；约 ${Math.ceil(retryAfterMs / 1000)} 秒后自动重试…`;
    // Deliberately do not message the service worker during this wait. Its
    // measured MV3 idle lifecycle can then end, and the PING below starts a
    // fresh worker whose optional nativeMessaging API binding is complete.
    await waitForNativeRecovery(retryAfterMs);
    nativePermissionGranted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
    if (!nativePermissionGranted) {
      recoveredHost = { connected: false, needsPermission: true };
      renderHostStatus(recoveredHost, { permissionGranted: false });
      return { recoveryBlocked: false, diagnosticsRefreshed: false, hostStatus: recoveredHost };
    }
    nativePermissionStatus.textContent = "正在自动重试本地下载引擎…";
    recoveredHost = await pingNativeHost();
    if (recoveredHost.needsPermission) {
      renderNativePermissionRequired("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权");
      return { recoveryBlocked: false, diagnosticsRefreshed: false, hostStatus: recoveredHost };
    }
    renderHostStatus(recoveredHost, { permissionGranted: true });
    if (recoveredHost.failureReason === "api_unavailable") {
      response = await requestNativeApiRecovery();
      recoveredHost = response.hostStatus || recoveredHost;
      if (recoveredHost.needsPermission) {
        renderNativePermissionRequired("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权");
        return { recoveryBlocked: false, diagnosticsRefreshed: false, hostStatus: recoveredHost };
      }
      renderHostStatus(recoveredHost, { permissionGranted: true });
    } else {
      await refreshDiagnostics();
      return { recoveryBlocked: false, diagnosticsRefreshed: true, hostStatus: recoveredHost };
    }
  }
  if (response.recoveryBlocked) {
    nativePermissionStatus.textContent = "Chrome 的连接接口长期未恢复。请完全退出并重新启动 Chrome，再返回此页点击“重新检查”。";
  }
  const recoveryBlocked = response.recoveryBlocked === true;
  const diagnosticsRefreshed = !recoveryBlocked && recoveredHost.connected === true;
  if (diagnosticsRefreshed) await refreshDiagnostics();
  return { recoveryBlocked, diagnosticsRefreshed, hostStatus: recoveredHost };
}

async function requestNativeApiRecovery() {
  const response = await chrome.runtime.sendMessage({ type: "RECOVER_NATIVE_API" });
  if (!response?.ok) throw new Error(response?.error || "暂时未能恢复本地下载引擎");
  return response;
}

function pingNativeHost() {
  return runKeyedAction("native-ping", async () => {
    const response = await chrome.runtime.sendMessage({ type: "PING_HOST" });
    if (!response?.ok) throw new Error(response?.error || "暂时未能检查本地下载引擎");
    return response.hostStatus || {};
  });
}

export function renderHostStatus(host = {}, { permissionGranted = nativePermissionGranted, failed = false } = {}) {
  const connected = host.connected === true;
  const compatible = connected && host.compatible === true;
  const mismatch = connected && host.compatible !== true;
  const failureReason = ["api_unavailable", "host_missing", "connection_failed"].includes(host.failureReason)
    ? host.failureReason
    : failed ? "connection_failed" : null;
  const nativeRestartRequired = failureReason === "api_unavailable" && host.restartRequired === true;
  const ffmpeg = host.capabilities?.ffmpeg;
  const ytdlp = host.capabilities?.ytdlp;
  const ffmpegInstalled = Boolean(ffmpeg ? ffmpeg.available : host.ffmpeg);
  const ytdlpInstalled = ytdlp?.installed === true || ytdlp?.available === true;
  const ytdlpAvailable = ytdlp?.available === true;
  const externalGateOpen = BUILD_PROFILE.features.externalToolNetwork === true;
  nativePermissionButton.textContent = permissionGranted && !host.needsPermission ? "重新检查" : "开启本地下载引擎";
  nativeInstallGuide.open = failureReason === "host_missing";

  if (!permissionGranted || host.needsPermission) {
    setMatrixStatus("capabilityNativeConnection", "尚未授权检查", "unknown");
    setMatrixStatus("capabilityNativeProtocol", "等待授权", "unknown");
    setMatrixStatus("capabilityFfmpeg", "尚未检查", "unknown");
    setMatrixStatus("capabilityYtDlp", "尚未检查", "unknown");
    setRuntimeStatus("runtimeNativeStatus", "尚未授权", "warning");
    setRuntimeStatus("runtimeFfmpegStatus", "尚未检查", "warning");
  } else if (failureReason === "api_unavailable") {
    setMatrixStatus("capabilityNativeConnection", nativeRestartRequired ? "授权已生效 · 需要重启浏览器" : "授权已生效 · 浏览器接口待恢复", "mismatch");
    setMatrixStatus("capabilityNativeProtocol", nativeRestartRequired ? "接口长期未恢复 · 请重启 Chrome" : "等待 Chrome 初始化连接接口", "unknown");
    setMatrixStatus("capabilityFfmpeg", "等待连接后检查", "unknown");
    setMatrixStatus("capabilityYtDlp", "等待连接后检查", "unknown");
    setRuntimeStatus("runtimeNativeStatus", nativeRestartRequired ? "需要重启浏览器" : "正在初始化连接接口", "warning");
    setRuntimeStatus("runtimeFfmpegStatus", "等待本地程序", "warning");
  } else if (!connected) {
    setMatrixStatus("capabilityNativeConnection", failureReason === "host_missing" ? "未安装或未注册" : "连接失败 · 请重试", "missing");
    setMatrixStatus("capabilityNativeProtocol", "等待连接", "unknown");
    setMatrixStatus("capabilityFfmpeg", "等待连接后检查", "unknown");
    setMatrixStatus("capabilityYtDlp", "等待连接后检查", "unknown");
    setRuntimeStatus("runtimeNativeStatus", "未连接", "bad");
    setRuntimeStatus("runtimeFfmpegStatus", "等待本地程序", "warning");
  } else {
    setMatrixStatus("capabilityNativeConnection", `已连接${host.version ? ` · ${host.version}` : ""}`, "ready");
    setMatrixStatus("capabilityNativeProtocol", compatible ? `匹配 · 协议 ${host.protocolVersion}` : "协议或能力配置不匹配", compatible ? "ready" : "mismatch");
    setMatrixStatus("capabilityFfmpeg", ffmpegInstalled ? compatible ? "已安装 · 本地处理可用" : "已安装 · 协议不匹配" : "未安装", ffmpegInstalled ? compatible ? "ready" : "mismatch" : "missing");
    setMatrixStatus("capabilityYtDlp", ytdlpInstalled
      ? externalGateOpen && ytdlpAvailable && ytdlp.networkDisabled === false && compatible ? "已安装 · 可用" : "已安装 · 联网功能未开放"
      : "未安装", ytdlpInstalled ? externalGateOpen && ytdlpAvailable && ytdlp.networkDisabled === false && compatible ? "ready" : "gated" : "missing");
    setRuntimeStatus("runtimeNativeStatus", compatible ? "已连接" : "版本不匹配", compatible ? "ok" : "bad");
    setRuntimeStatus("runtimeFfmpegStatus", ffmpegInstalled ? compatible ? "本地处理可用" : "已安装但不可用" : "未安装", ffmpegInstalled ? compatible ? "ok" : "bad" : "bad");
  }

  const externalAvailable = Boolean(externalGateOpen && compatible && ytdlpAvailable && ytdlp.networkDisabled === false);
  setMatrixStatus("capabilityExternalNetwork", !externalGateOpen
    ? "当前构建未启用"
    : externalAvailable ? "可用" : ytdlpInstalled ? "工具已安装 · 联网仍受限" : "需要安装工具",
  externalAvailable ? "ready" : "gated");
  nativePermissionStatus.textContent = !permissionGranted || host.needsPermission
    ? "加速大文件、合并视频片段或转换格式时需要开启"
    : failureReason === "api_unavailable"
      ? nativeRestartRequired
        ? "Chrome 的连接接口长期未恢复。请完全退出并重新启动 Chrome，再返回此页点击“重新检查”。"
        : "授权已生效，正在等待 Chrome 初始化；FluxCatch 将自动重试"
      : failureReason === "host_missing"
        ? "已授权，但本地下载引擎未安装或未注册；请在源码根目录运行 ./scripts/native-install-wrapper.sh 后重试"
        : failureReason === "connection_failed"
          ? "已授权，但本地引擎连接失败；请稍后重新检查，若持续失败请在 chrome://extensions 中查看错误"
    : mismatch
      ? HOST_MISMATCH_MESSAGE
      : connected && compatible
        ? "已就绪 · 可加速大文件、合并视频片段并转换格式"
        : "已授权；等待连接配套程序";
}

function setMatrixStatus(id, text, state) {
  const element = document.querySelector(`#${id}`);
  if (!element) return;
  element.textContent = text;
  element.dataset.state = state;
}

function setRuntimeStatus(id, text, dotState) {
  const element = document.querySelector(`#${id}`);
  if (!element) return;
  element.textContent = text;
  const dot = element.closest(".status-item")?.querySelector(".status-dot");
  if (!dot) return;
  dot.classList.toggle("ok", dotState === "ok");
  dot.classList.toggle("bad", dotState === "bad");
}

function renderCapabilities() {
  const list = document.querySelector("#capabilityList");
  list.replaceChildren();
  for (const [feature, label] of Object.entries(CAPABILITY_LABELS)) {
    const enabled = BUILD_PROFILE.features[feature] === true;
    const item = document.createElement("li");
    item.dataset.feature = feature;
    item.dataset.enabled = String(enabled);
    const name = document.createElement("span");
    name.textContent = label;
    const value = document.createElement("strong");
    value.textContent = enabled ? "可用" : "未启用";
    item.append(name, value);
    list.append(item);
  }
}

function renderLabStates() {
  const items = document.querySelectorAll(".roadmap-list li");
  for (let index = 0; index < items.length; index += 1) {
    const feature = LAB_FEATURES[index];
    const enabled = BUILD_PROFILE.features[feature] === true;
    items[index].dataset.feature = feature;
    items[index].dataset.enabled = String(enabled);
    const state = items[index].querySelector(".roadmap-status");
    if (state) state.textContent = enabled ? "可用" : feature === "externalToolNetwork" ? "规划中" : "未开放";
  }
}

function refreshDiagnostics() {
  return runKeyedAction("options-diagnostics", async () => {
    const response = await chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" });
    if (!response?.ok) throw new Error(response?.error || "读取诊断信息失败");
    diagnostics = response.diagnostics;
    const extension = diagnostics.extension || {};
    const native = diagnostics.native || {};
    document.querySelector("#diagnosticExtensionVersion").textContent = extension.version || "未知";
    document.querySelector("#diagnosticExtensionId").textContent = extension.id || "未知";
    document.querySelector("#diagnosticBuild").textContent = `${extension.channel || "未知"} · ${extension.commit || "未知"}`;
    document.querySelector("#diagnosticNativeVersion").textContent = native.connected ? native.version || "未知" : "未连接";
    document.querySelector("#diagnosticProtocol").textContent = native.compatible === true
      ? `匹配 · 协议 ${native.protocolVersion} · 能力配置 ${native.capabilityProfileVersion}`
      : native.connected ? "不匹配" : "等待连接";
    return diagnostics;
  });
}

async function copyDiagnostics() {
  if (isActionPending("copy-diagnostics")) return;
  try {
    await withPendingAction(copyDiagnosticsButton, "copy-diagnostics", async () => {
      if (!diagnostics) await refreshDiagnostics();
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      setStatus("诊断信息已复制", "success", 1800);
    }, {
      pendingText: "正在复制…",
      successText: "已复制 ✓",
      failureText: "复制失败",
      successDurationMs: 700,
      failureDurationMs: 900
    });
  } catch (error) {
    setStatus(error?.message || "复制诊断信息失败", "error", 5000);
  }
}

function setStatus(message, type = "success", duration = 0) {
  clearTimeout(statusTimer);
  statusTimer = null;
  status.textContent = message;
  status.dataset.statusType = type;
  if (duration > 0) statusTimer = setTimeout(() => clearStatus(), duration);
}

function clearStatus() {
  clearTimeout(statusTimer);
  statusTimer = null;
  status.textContent = "";
  delete status.dataset.statusType;
}

const uiLanguageSelect = document.querySelector("#uiLanguageSelect");
if (uiLanguageSelect) {
  loadUiLanguage().then((value) => { uiLanguageSelect.value = value; }).catch(() => {});
  uiLanguageSelect.addEventListener("change", () => { void changeUiLanguage(uiLanguageSelect.value); });
}

// bindUiI18n's top-level await can let DOMContentLoaded slip past the late
// listener registration above in some Chrome locales; initialize now if it did.
if (domContentLoadedSeen) void initialize();
