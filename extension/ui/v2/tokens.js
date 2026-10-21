// A DOM-free mirror of the few Morning tokens in tokens.css that code outside
// a page needs: the background worker colours the toolbar badge with them,
// and a service worker can neither read CSS custom properties nor fetch
// tokens.css. This is a token file like tokens.css (the only other place
// colour literals may appear); tests/ui-v2.test.js fails when a value drifts
// from the Morning block of tokens.css.

/** Morning values of --primary-fill, --text-secondary and --text-on-accent. */
export const MORNING = Object.freeze({
  "--primary-fill": "#437497",
  "--text-secondary": "#4E5371",
  "--text-on-accent": "#F9F6F1"
});

/** The toolbar badge: the primary fill while downloading, text-secondary
 *  otherwise, and the on-accent colour for the count. */
export const BADGE_COLORS = Object.freeze({
  active: MORNING["--primary-fill"],
  idle: MORNING["--text-secondary"],
  text: MORNING["--text-on-accent"]
});
