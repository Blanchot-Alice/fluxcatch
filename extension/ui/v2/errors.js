// The one UI error helper for v2 surfaces (design review §7): engine and
// worker errors travel as codes plus parameters and are localised here, in
// the UI language. Raw engine text is never shown; anything that cannot be
// described falls back to one plain sentence.
import { classifyJobFailure, describeJobFailure, FAILURE_CODES } from "../../lib/job-failure.js";
import { uiLanguage } from "./locale.js";
import { msg } from "./messages.js";

const KNOWN_CODES = new Set(FAILURE_CODES);

/** An error whose text is already user copy (from msg()); errorText shows it as is. */
export function userError(text) {
  return Object.assign(new Error(text), { userMessage: text });
}

/** True for a failure code the UI can describe (any FAILURE_CODES entry except "unknown"). */
export function isKnownFailureCode(code) {
  return typeof code === "string" && code !== "unknown" && KNOWN_CODES.has(code);
}

/**
 * The sentence to show for an error, in the UI language.
 * 1. error.userMessage, when the caller already wrote user copy;
 * 2. error.code from lib/job-failure.js FAILURE_CODES (with error.params);
 * 3. the message text classified by classifyJobFailure, unless it is unknown
 *    (the worker and the engine send codes or classifiable text; a test in
 *    tests/job-failure.test.js keeps every Chinese error they emit classified);
 * 4. otherwise toast.genericError. Raw text never reaches either UI: it may be
 *    engine, Chrome or exception text, or Chinese the English UI cannot show.
 */
export function errorText(error) {
  if (error?.userMessage) return error.userMessage;
  if (isKnownFailureCode(error?.code)) return describeJobFailure({ code: error.code, params: error.params }, uiLanguage());
  const raw = String(error?.message || "").trim();
  if (raw) {
    const failure = classifyJobFailure({ text: raw });
    if (failure.code && failure.code !== "unknown") return describeJobFailure(failure, uiLanguage());
  }
  return msg("toast.genericError");
}
