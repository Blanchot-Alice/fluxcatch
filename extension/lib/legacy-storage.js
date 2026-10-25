// The 0.2.5 storage keys carried the old product name (design review v3.3
// §2.2, item A6). They move once, read-old-write-new-delete-old, when the
// worker starts; until that has happened a page may still find only the old
// key, so readers fall back to it for one release.
export const LEGACY_STORAGE_KEYS = Object.freeze({
  "havre.uiLanguage.v1": "fluxcatch.uiLanguage.v1",
  "havre.pondSeed.v1": "fluxcatch.pondSeed.v1",
  "havre.uiCustomization.v1": "fluxcatch.uiCustomization.v1",
  "havre.developerTools.v1": "fluxcatch.developerTools.v1"
});

/** Move every legacy key whose new key is still unset; delete the legacy keys.
 *  Keys are read and removed one at a time: every storage-like client the
 *  pages accept takes a single key, and this runs once per worker start. */
export async function migrateLegacyStorage(store = globalThis.chrome?.storage?.local) {
  if (!store?.get || !store?.set || !store?.remove) return { moved: [], removed: [] };
  const writes = {};
  const removed = [];
  for (const [key, legacy] of Object.entries(LEGACY_STORAGE_KEYS)) {
    const old = (await store.get(legacy)) || {};
    if (!Object.hasOwn(old, legacy)) continue;
    const current = (await store.get(key)) || {};
    if (!Object.hasOwn(current, key)) writes[key] = old[legacy];
    removed.push(legacy);
  }
  if (Object.keys(writes).length) await store.set(writes);
  for (const legacy of removed) await store.remove(legacy);
  return { moved: Object.keys(writes), removed };
}

/** The value under `key`, or under its legacy key while the migration has not run. */
export async function readWithLegacy(store, key) {
  if (!store?.get) return undefined;
  const stored = (await store.get(key)) || {};
  if (Object.hasOwn(stored, key) && stored[key] !== undefined) return stored[key];
  const legacy = LEGACY_STORAGE_KEYS[key];
  if (!legacy) return undefined;
  const old = (await store.get(legacy)) || {};
  return Object.hasOwn(old, legacy) ? old[legacy] : undefined;
}
