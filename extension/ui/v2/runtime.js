// Messaging with the background worker for v2 surfaces.
// The worker answers { ok: true, ...result } or { ok: false, error, code?, params?, jobId? }.
// A failed answer becomes an Error that keeps code, params and jobId, so
// errors.js can describe it from the code instead of the raw text.
// connectWorkerPort() keeps a page's broadcast port alive across the idle
// shutdowns of the MV3 worker.

/** Send one message to the worker; resolve with the response, or throw on { ok: false }. */
export async function callWorker(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw workerError(response);
  return response;
}

/** The Error for a failed worker response (exported for tests and custom transports). */
export function workerError(response) {
  const error = new Error(response?.error || "");
  if (typeof response?.code === "string" && response.code) error.code = response.code;
  if (response?.params && typeof response.params === "object") error.params = response.params;
  if (typeof response?.jobId === "string" && response.jobId) error.jobId = response.jobId;
  return error;
}

/**
 * The page's port to the worker. An MV3 worker that goes idle is stopped and
 * its ports disconnect, though the extension is fine: reconnect (that wakes
 * the worker), then resync whatever the page missed. Only when connecting
 * fails, or the resync finds no worker several times in a row, does the page
 * report the loss (onLost), e.g. after the extension was reloaded or updated.
 * Call it before anything awaits, so no broadcast is missed.
 * @param {object} o
 * @param {string} o.name                       "havre-popup" | "havre-sidepanel" | "havre-downloads"
 * @param {(message) => void} o.onMessage
 * @param {() => Promise<boolean>} [o.onReconnect] resync; false when the worker did not answer
 * @param {() => void} [o.onLost]
 * @param {number[]} [o.delays]                  waits before each attempt, in ms
 */
export function connectWorkerPort({ name, onMessage, onReconnect, onLost, delays = [300, 1000, 3000] } = {}) {
  let attempt = 0;
  let lost = false;
  let current = null;
  const loseOnce = () => { if (!lost) { lost = true; onLost?.(); } };
  function open() {
    // One live port at a time, so no broadcast arrives twice.
    try { current?.disconnect?.(); } catch { /* already gone */ }
    let port;
    try { port = chrome.runtime.connect({ name }); } catch { current = null; return false; }
    current = port;
    port.onMessage.addListener((message) => { if (port === current) onMessage?.(message); });
    port.onDisconnect.addListener(() => {
      void chrome.runtime.lastError; // read, so Chrome does not log it as unchecked
      if (port === current) schedule();
    });
    return true;
  }
  let timer = null;
  function schedule() {
    if (lost || timer) return;
    if (attempt >= delays.length) { loseOnce(); return; }
    const wait = delays[attempt];
    attempt += 1;
    timer = setTimeout(async () => {
      timer = null;
      if (!open()) { schedule(); return; }
      const port = current;
      let answered = true;
      try { answered = (await onReconnect?.()) !== false; } catch { answered = false; }
      if (port !== current || lost) return; // a newer attempt took over
      if (answered) attempt = 0;
      else schedule();
    }, wait);
  }
  if (!open()) loseOnce();
}
