export function waitForNativeRecovery(delayMs, scheduler = globalThis.setTimeout) {
  const duration = Math.max(0, Number(delayMs) || 0);
  if (typeof scheduler !== "function") throw new TypeError("A timer scheduler is required");
  return new Promise((resolve) => scheduler(resolve, duration));
}
