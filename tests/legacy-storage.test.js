// The 0.2.5 storage keys move to their Havre names once (design review v3.3
// §2.2, A6): read old, write new, delete old; readers fall back meanwhile.
import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_STORAGE_KEYS, migrateLegacyStorage, readWithLegacy } from "../extension/lib/legacy-storage.js";

function fakeStore(initial = {}) {
  const data = { ...initial };
  const calls = [];
  return {
    data,
    calls,
    async get(keys) {
      calls.push(["get", keys]);
      const wanted = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(wanted.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    async set(values) { calls.push(["set", values]); Object.assign(data, values); },
    async remove(keys) { calls.push(["remove", keys]); for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
}

test("the four keys and only those are mapped", () => {
  assert.deepEqual(Object.keys(LEGACY_STORAGE_KEYS), ["havre.uiLanguage.v1", "havre.pondSeed.v1", "havre.uiCustomization.v1", "havre.developerTools.v1"]);
  for (const [key, legacy] of Object.entries(LEGACY_STORAGE_KEYS)) assert.equal(legacy, key.replace(/^havre\./, "fluxcatch."));
});

test("migrateLegacyStorage moves old values once and deletes the old keys", async () => {
  const store = fakeStore({ "fluxcatch.uiLanguage.v1": "zh", "fluxcatch.pondSeed.v1": 0x5eed1e5, "fluxcatch.developerTools.v1": true, settings: { keep: 1 } });
  const result = await migrateLegacyStorage(store);
  assert.deepEqual(result.moved, ["havre.uiLanguage.v1", "havre.pondSeed.v1", "havre.developerTools.v1"]);
  assert.deepEqual(result.removed, ["fluxcatch.uiLanguage.v1", "fluxcatch.pondSeed.v1", "fluxcatch.developerTools.v1"]);
  assert.deepEqual(store.data, { "havre.uiLanguage.v1": "zh", "havre.pondSeed.v1": 0x5eed1e5, "havre.developerTools.v1": true, settings: { keep: 1 } });
  // A second run is a no-op.
  const again = await migrateLegacyStorage(store);
  assert.deepEqual(again, { moved: [], removed: [] });
  assert.equal(store.calls.filter(([kind]) => kind === "set").length, 1, "one set in all");
  assert.equal(store.calls.filter(([kind]) => kind === "remove").length, 3, "each old key removed once");
});

test("a value already stored under the new key wins; the old key is still deleted", async () => {
  const store = fakeStore({ "fluxcatch.uiLanguage.v1": "zh", "havre.uiLanguage.v1": "en" });
  const result = await migrateLegacyStorage(store);
  assert.deepEqual(result, { moved: [], removed: ["fluxcatch.uiLanguage.v1"] });
  assert.deepEqual(store.data, { "havre.uiLanguage.v1": "en" });
});

test("readWithLegacy reads the new key first and the old key until the migration has run", async () => {
  const store = fakeStore({ "fluxcatch.uiCustomization.v1": { sectionGap: 30 } });
  assert.deepEqual(await readWithLegacy(store, "havre.uiCustomization.v1"), { sectionGap: 30 });
  await migrateLegacyStorage(store);
  assert.deepEqual(await readWithLegacy(store, "havre.uiCustomization.v1"), { sectionGap: 30 });
  assert.equal(await readWithLegacy(store, "havre.pondSeed.v1"), undefined);
  assert.equal(await readWithLegacy(store, "settings"), undefined, "a key without a legacy name reads itself only");
  assert.equal(await readWithLegacy(null, "havre.pondSeed.v1"), undefined);
});

test("without a storage area the migration is a no-op", async () => {
  assert.deepEqual(await migrateLegacyStorage(undefined), { moved: [], removed: [] });
  assert.deepEqual(await migrateLegacyStorage({ get: async () => ({}) }), { moved: [], removed: [] });
});
