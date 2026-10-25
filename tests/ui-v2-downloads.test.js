// Downloads page copy (ui/v2/messages/downloads.js): the header summary keeps
// its approved wording and counts completed records, and the empty state
// matches the popup and side panel and says the same thing in both languages.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { setUiLanguage } = await import("../extension/ui/v2/locale.js");
const { msg } = await import("../extension/ui/v2/messages.js");
const { default: downloads } = await import("../extension/ui/v2/messages/downloads.js");

test("messages/downloads.js keeps identical English and Chinese keys", () => {
  assert.deepEqual(Object.keys(downloads.en).sort(), Object.keys(downloads.zh).sort());
});

test("the header summary keeps the copy fixed by §6.15 and the approved rename table", () => {
  setUiLanguage("en");
  assert.equal(msg("downloads.summary", { count: 1, size: "2 GB" }), "1 file · 2 GB");
  assert.equal(msg("downloads.summary", { count: 3, size: "3.2 GB" }), "3 files · 3.2 GB");
  assert.equal(msg("downloads.summary", { count: 3, size: "" }), "3 files");
  setUiLanguage("zh");
  assert.equal(msg("downloads.summary", { count: 3, size: "3.2 GB" }), "3 个文件 · 3.2 GB");
  setUiLanguage("en");
});

test("the summary still counts completed records only", () => {
  const source = readFileSync(new URL("../extension/downloads/downloads.js", import.meta.url), "utf8");
  assert.match(source, /record\.status === "completed"[\s\S]{0,400}msg\("downloads\.summary", \{ count: completed\.length/);
});

test("the empty state uses the popup's sentence and says where the button is in both languages", () => {
  setUiLanguage("en");
  assert.equal(msg("downloads.empty.none"), msg("media.downloads.empty"), "one empty sentence for 'no downloads' across surfaces");
  assert.equal(msg("downloads.empty.noneBody"), "On a video page, click the Havre button in the toolbar, or paste a link above.");
  setUiLanguage("zh");
  assert.match(msg("downloads.empty.noneBody"), /工具栏/);
  setUiLanguage("en");
});
