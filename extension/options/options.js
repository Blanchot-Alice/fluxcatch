const form = document.querySelector("#settingsForm");
const status = document.querySelector("#saveStatus");
const nativePermissionButton = document.querySelector("#nativePermissionButton");
const nativePermissionStatus = document.querySelector("#nativePermissionStatus");

document.addEventListener("DOMContentLoaded", load);
form.addEventListener("submit", save);
nativePermissionButton.addEventListener("click", requestNativeAccess);

async function load() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!response?.ok) throw new Error(response?.error || "读取设置失败");
    const s = response.settings;
    form.concurrentFragments.value = s.concurrentFragments;
    form.concurrentRanges.value = s.concurrentRanges;
    form.outputContainer.value = s.outputContainer;
    form.liveDuration.value = s.liveDuration;
    form.minimumKiB.value = Math.round(s.minimumBytes / 1024);
    form.filenameTemplate.value = s.filenameTemplate;
    form.blockedDomains.value = (s.blockedDomains || []).join("\n");
    for (const key of ["saveAs", "useNativeForDirect"]) form[key].checked = Boolean(s[key]);
    form.showNotifications.checked = Boolean(s.showNotifications) && await chrome.permissions.contains({ permissions: ["notifications"] });
    await refreshNativeAccess();
  } catch (error) {
    showStatus(error?.message || "读取设置失败");
    nativePermissionStatus.textContent = "暂时未能检查高速下载功能";
  }
}

async function requestNativeAccess() {
  nativePermissionButton.disabled = true;
  try {
    // Keep request() as the first asynchronous call made by the click handler;
    // Chrome requires optional permissions to be requested from a user gesture.
    const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
    if (!granted) {
      nativePermissionStatus.textContent = "暂未开启；普通文件仍可直接下载";
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: "PING_HOST" });
    if (!response?.ok) throw new Error("暂时未能检查高速下载功能");
    const host = response.hostStatus || {};
    nativePermissionStatus.textContent = host.connected
      ? "已就绪 · 可加速大文件、合并视频片段并转换格式"
      : "已获授权，但配套程序尚未就绪";
    nativePermissionButton.textContent = "重新检查";
  } catch (error) {
    nativePermissionStatus.textContent = "检查失败，请确认配套程序已安装后重试";
  } finally {
    nativePermissionButton.disabled = false;
  }
}

async function refreshNativeAccess() {
  const granted = await chrome.permissions.contains({ permissions: ["nativeMessaging"] });
  nativePermissionStatus.textContent = granted
    ? "已获授权；点击按钮检查是否可用"
    : "加速大文件、合并视频片段或转换格式时需要开启";
  nativePermissionButton.textContent = granted ? "重新检查" : "开启高速下载功能";
}

async function save(event) {
  event.preventDefault();
  let showNotifications = form.showNotifications.checked;
  try {
    if (showNotifications) {
      showNotifications = await chrome.permissions.request({ permissions: ["notifications"] });
    } else {
      await chrome.permissions.remove({ permissions: ["notifications"] });
    }
  } catch (error) {
    showStatus(error?.message || "通知权限更新失败");
    return;
  }
  const settings = {
    concurrentFragments: Number(form.concurrentFragments.value),
    concurrentRanges: Number(form.concurrentRanges.value),
    outputContainer: form.outputContainer.value,
    liveDuration: Number(form.liveDuration.value),
    minimumBytes: Number(form.minimumKiB.value) * 1024,
    filenameTemplate: form.filenameTemplate.value,
    blockedDomains: form.blockedDomains.value.split(/\r?\n/),
    saveAs: form.saveAs.checked,
    useNativeForDirect: form.useNativeForDirect.checked,
    showNotifications
  };
  try {
    const response = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings });
    if (!response?.ok) throw new Error(response?.error || "保存失败");
    showStatus("已保存");
  } catch (error) {
    showStatus(error?.message || "保存失败");
  }
}

let statusTimer = null;
function showStatus(message) {
  clearTimeout(statusTimer);
  status.textContent = message;
  statusTimer = setTimeout(() => { status.textContent = ""; }, 2400);
}
