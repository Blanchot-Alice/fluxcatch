// Havre v2: job logic shared by the Downloads page, the popup and the side
// panel (no DOM). Ordering, terminal states, the speed-sample ring and the
// finished-file actions.
import { callWorker } from "./runtime.js";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

/** How many speed samples a live job keeps for its graph. */
export const SPEED_SAMPLES = 48;

export function isTerminalStatus(status) {
  return TERMINAL.has(status);
}

/** Active jobs first (newest start on top), then ended jobs by end time. */
export function compareJobs(a, b) {
  const aEnded = isTerminalStatus(a.status);
  const bEnded = isTerminalStatus(b.status);
  if (aEnded !== bEnded) return aEnded ? 1 : -1;
  if (!aEnded) return (b.createdAt || 0) - (a.createdAt || 0);
  return (b.updatedAt || 0) - (a.updatedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0);
}

/** Push one speed sample while the job is downloading and keep only the
 *  newest SPEED_SAMPLES, so a long download never grows the ring without bound. */
export function recordSpeedSample(ring, job) {
  if (job.status === "downloading") ring.push(Math.max(0, Number(job.speed) || 0));
  while (ring.length > SPEED_SAMPLES) ring.shift();
  return ring;
}

/** Open or reveal a finished file: Chrome's own downloads through the
 *  downloads API (it needs the click's gesture), engine files through the worker. */
export async function runFileAction(job, action, call = callWorker) {
  if (job.method === "browser" && Number.isInteger(job.downloadId) && (action === "open" || action === "reveal")) {
    try {
      if (action === "open") await chrome.downloads.open(job.downloadId);
      else await chrome.downloads.show(job.downloadId);
      return { via: "browser" };
    } catch {
      // Fall through: the worker may still know the published path.
    }
  }
  return call({ type: "FILE_ACTION", action, jobId: job.jobId });
}
