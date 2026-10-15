// The store backend in the extension: one IndexedDB database, one object
// store per area (each record kind, plus the capture checkpoints). Keys are
// "<provider>:<id>" (src/schema.ts recordKey).
import { KINDS } from "../src/index.ts";

const AREAS = [...KINDS, "checkpoints"];
const done = (request) =>
  new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
const committed = (tx) =>
  new Promise((resolve, reject) => {
    tx.addEventListener("complete", () => resolve(undefined));
    tx.addEventListener("error", () => reject(tx.error));
    tx.addEventListener("abort", () => reject(tx.error ?? new Error("The IndexedDB write was aborted.")));
  });

export function idbBackend(name = "foxcache") {
  let db;
  const open = () => {
    if (!db) {
      const request = indexedDB.open(name, 1);
      request.addEventListener("upgradeneeded", () => {
        for (const area of AREAS) if (!request.result.objectStoreNames.contains(area)) request.result.createObjectStore(area);
      });
      db = done(request);
    }
    return db;
  };
  const write = async (area, fn) => {
    const tx = (await open()).transaction(area, "readwrite");
    fn(tx.objectStore(area));
    await committed(tx);
  };
  const read = async (area, fn) => done(fn((await open()).transaction(area, "readonly").objectStore(area)));
  return {
    get: (area, key) => read(area, (s) => s.get(key)),
    put: (area, key, value) => write(area, (s) => s.put(value, key)),
    delete: (area, key) => write(area, (s) => s.delete(key)),
    async entries(area) {
      // One transaction, so a write between the two reads cannot misalign them.
      const s = (await open()).transaction(area, "readonly").objectStore(area);
      const [keys, values] = await Promise.all([done(s.getAllKeys()), done(s.getAll())]);
      return keys.map((k, i) => [k, values[i]]);
    },
    async clear() {
      const tx = (await open()).transaction(AREAS, "readwrite");
      for (const area of AREAS) tx.objectStore(area).clear();
      await committed(tx);
    },
  };
}
