// Decimal byte sizes and rates (1 GB = 1,000,000,000 bytes, as Finder counts),
// written with Intl unit formatting in the given locale. DOM-free, so the
// background worker and the UI (ui/v2/locale.js, which passes the UI locale)
// share one implementation.

const UNITS = [
  [1e12, "terabyte"],
  [1e9, "gigabyte"],
  [1e6, "megabyte"],
  [1e3, "kilobyte"],
  [1, "byte"]
];

function decimal(amount, locale, suffix = "", { fixed = false } = {}) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return "";
  const [base, unit] = UNITS.find(([size]) => value >= size) || UNITS[UNITS.length - 1];
  const scaled = value / base;
  // One decimal below 100 ("2.4 GB", "48.3 MB"), none above or for bytes.
  // fixed keeps a trailing zero ("58.0 MB/s"), so rates shown side by side
  // ("Now 56.3 MB/s · Peak 58.0 MB/s") share one precision.
  const digits = scaled >= 100 || unit === "byte" ? 0 : 1;
  return new Intl.NumberFormat(locale, { style: "unit", unit: `${unit}${suffix}`, unitDisplay: "short", maximumFractionDigits: digits, minimumFractionDigits: fixed ? digits : 0 }).format(scaled);
}

/** "2.4 GB", "812 MB" in `locale` (a BCP 47 tag); "" for zero, negative or invalid input. */
export function formatBytes(bytes, locale) {
  return decimal(bytes, locale);
}

/** "56.3 MB/s", "58.0 MB/s", "512 kB/s" in `locale` (one fixed decimal below
 *  100); "" for zero, negative or invalid input. */
export function formatRate(bytesPerSecond, locale) {
  return decimal(bytesPerSecond, locale, "-per-second", { fixed: true });
}
