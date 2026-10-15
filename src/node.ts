// foxcache/node: the file store that the CLI and the MCP server use. The
// file is $FOXCACHE_HOME/archive.json, default ~/.foxcache/archive.json, and
// it is a foxcache/v1 archive, the same format the extension exports.
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { MAX_ARCHIVE_BYTES, parseArchive, toArchive } from "./archive.js";
import { FoxcacheError } from "./errors.js";
import { KINDS, recordKey } from "./schema.js";
import { type Store, createStore, memoryBackend } from "./store.js";

/** The directory that holds archive.json. */
export function cacheHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.FOXCACHE_HOME || join(homedir(), ".foxcache");
}
export const cachePath = (env: NodeJS.ProcessEnv = process.env) => join(cacheHome(env), "archive.json");

export interface NodeStore {
  store: Store;
  path: string;
  /** Write the store to the file: a temp file first, then a rename, so a crash never leaves half a file (N2). A store larger than an archive can be is refused, so the file always opens again (N5). */
  save(): Promise<void>;
}

/** Read the file into memory. A file that is not a valid archive fails loudly and is never written over (N1). */
async function load(path: string): Promise<Store> {
  const store = createStore(memoryBackend());
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return store;
    throw error;
  }
  if (size > MAX_ARCHIVE_BYTES) throw new FoxcacheError("corrupt-store", `${path} is larger than an archive can be. foxcache did not change it.`);
  let archive;
  try {
    archive = parseArchive(await readFile(path, "utf8"));
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    throw new FoxcacheError("corrupt-store", `${path} is not a foxcache archive (${why}). foxcache did not change it. Fix it or move it away.`);
  }
  for (const kind of KINDS) for (const record of archive[kind]) await store.backend.put(kind, recordKey(kind, record), record);
  return store;
}

export async function openNodeStore(env: NodeJS.ProcessEnv = process.env): Promise<NodeStore> {
  const path = cachePath(env);
  const store = await load(path);
  return {
    store,
    path,
    async save() {
      // mkdir gives the first directory it made, or undefined when all exist (N4).
      const text = `${JSON.stringify(await toArchive(store))}\n`;
      if (Buffer.byteLength(text) > MAX_ARCHIVE_BYTES) throw new FoxcacheError("too-large", `The store would be larger than the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB an archive can be. foxcache did not change ${path}.`);
      if (await mkdir(dirname(path), { recursive: true, mode: 0o700 })) await chmod(dirname(path), 0o700);
      const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temp, text, { mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
  };
}
