import test from "node:test";
import assert from "node:assert/strict";
import { waitForNativeRecovery } from "../extension/options/native-recovery.js";

test("native recovery wait accepts an injected scheduler without sleeping", async () => {
  let scheduledDelay = null;
  const waiting = waitForNativeRecovery(35_000, (callback, delay) => {
    scheduledDelay = delay;
    callback();
  });
  await waiting;
  assert.equal(scheduledDelay, 35_000);
});

test("native recovery wait normalizes invalid delays", async () => {
  const delays = [];
  await waitForNativeRecovery(-1, (callback, delay) => { delays.push(delay); callback(); });
  await waitForNativeRecovery(Number.NaN, (callback, delay) => { delays.push(delay); callback(); });
  assert.deepEqual(delays, [0, 0]);
});
