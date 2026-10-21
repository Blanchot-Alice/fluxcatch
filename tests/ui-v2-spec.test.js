// Spec conformance checks on the shared v2 CSS (design review §5, §6.1, §6.2,
// §6.12, §6.14): static, since Chrome cannot run here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const system = read("extension/ui/v2/system.css").replace(/\/\*[\s\S]*?\*\//g, "");
const tokens = read("extension/ui/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

/** Flat rules: { media, selector, body } (one level of @media nesting). */
function rulesOf(css) {
  const rules = [];
  const walk = (text, media) => {
    let index = 0;
    while (index < text.length) {
      const open = text.indexOf("{", index);
      if (open < 0) break;
      const head = text.slice(index, open).trim();
      if (head.startsWith("@media") || head.startsWith("@supports")) {
        let depth = 1;
        let end = open + 1;
        while (depth && end < text.length) { if (text[end] === "{") depth += 1; if (text[end] === "}") depth -= 1; end += 1; }
        walk(text.slice(open + 1, end - 1), head);
        index = end;
        continue;
      }
      const close = text.indexOf("}", open);
      rules.push({ media, selector: head, body: text.slice(open + 1, close) });
      index = close + 1;
    }
  };
  walk(css, "");
  return rules;
}

const RULES = rulesOf(system);
const ruleFor = (selector) => RULES.find((rule) => rule.selector === selector && !rule.media);

test("no hairline ring at rest: a blur-0 box-shadow of 2px or less only on focus or under prefers-contrast: more", () => {
  for (const rule of RULES) {
    if (/prefers-contrast:\s*more/.test(rule.media)) continue;
    const shadow = (rule.body.match(/box-shadow:\s*([^;]+);/) || [])[1];
    if (!shadow) continue;
    for (const part of shadow.split(/,(?![^(]*\))/)) {
      const lengths = part.replace(/color-mix\([^)]*\)|var\([^)]*\)|inset/g, "").trim().split(/\s+/).map(Number.parseFloat).filter((n) => !Number.isNaN(n));
      if (lengths.length < 3) continue;
      const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
      const hairline = blur === 0 && Math.max(Math.abs(x), Math.abs(y), spread) <= 2 && (spread > 0 || x || y);
      if (hairline) assert.match(rule.selector.replace(/:not\([^)]*\)/g, ""), /:focus/, `${rule.selector} draws a ${part.trim()} line at rest (§6.2, audit g)`);
    }
  }
});

test("every button kind presses: background one step down plus the soft inset in 90ms (§6.1)", () => {
  for (const selector of [".icon-button:active:not(:disabled)", ".segmented button:active:not(:disabled)", ".menu-item:active", ".focus-details summary:active"]) {
    const rule = RULES.find((candidate) => candidate.selector === selector);
    assert.ok(rule, `${selector} exists`);
    assert.match(rule.body, /background:/, `${selector} steps the background down`);
    assert.match(rule.body, /box-shadow: var\(--press-inset\)/, `${selector} adds the soft inset`);
    assert.match(rule.body, /var\(--t-press\)/, `${selector} presses in 90ms`);
  }
  assert.match(ruleFor(".btn:active:not(:disabled)").body, /box-shadow: var\(--press-inset\)/);
  assert.match(ruleFor('.segmented button:is([aria-selected="true"], [aria-checked="true"]):active:not(:disabled)').body, /background: var\(--surface\)/, "the raised segment (tab or radio) steps down to surface");
});

test("Settings keeps the 880 page column, so full pages share one skeleton (§5, P2)", () => {
  const start = tokens.indexOf('[data-surface="settings"] {');
  const body = tokens.slice(start, tokens.indexOf("}", start));
  assert.doesNotMatch(body, /--column-max/, "Settings does not widen the column");
  assert.match(body, /--content-max: 680px/);
  assert.match(ruleFor(".nav-layout").body, /grid-template-columns: var\(--nav-width\) minmax\(0, var\(--content-max\)\)/, "content is at most 680, 632 in the 880 column");
});

test("the top bar holds two trailing icon buttons in one cell (§6.14) and the popup dialog gets the full 600 (§6.12)", () => {
  assert.match(ruleFor(".bar-actions").body, /display: inline-flex/);
  assert.match(ruleFor('[data-surface="popup"]:has(.dialog-shell[open])').body, /min-height: 600px/);
  const readme = read("extension/ui/v2/README.md");
  assert.ok(readme.includes("bar-actions"), "README documents .bar-actions");
});

test("a field in a dialog sits one value step below the dialog, and every field shares one focus ring (§6.2)", () => {
  // The fill sits on the native control and the wrapper is transparent, so the
  // value text shares the label's left edge (one left edge in the dialog).
  assert.match(ruleFor(".dialog-shell .field").body, /background: transparent/);
  const control = RULES.find((rule) => !rule.media && rule.selector.replace(/\s+/g, " ") === ".dialog-shell .field > input, .dialog-shell .field > select");
  assert.ok(control, "the dialog field fill rule on the native control");
  assert.match(control.body, /background: var\(--surface\)/);
  assert.match(control.body, /border-radius: var\(--r-control\)/);
  assert.match(ruleFor(".field:focus-within").body, /box-shadow: 0 0 0 2px var\(--pond-text\)/);
  assert.match(ruleFor('.field[data-field]:has([aria-invalid="true"]):not(:focus-within)').body, /box-shadow: 0 0 0 3px/);
});
