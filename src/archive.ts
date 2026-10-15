// The archive file: the one file the extension exports and the CLI imports.
// It holds checked records only. An import checks every record before it
// writes any, so a bad file changes nothing (A3).
import { FoxcacheError } from "./errors.js";
import { KINDS, type Kind, type RecordOf, SCHEMA, check, recordKey } from "./schema.js";
import type { PutResult, Store } from "./store.js";

export const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;

export type Archive = { schema: typeof SCHEMA; exportedAt: string } & { [K in Kind]: RecordOf[K][] };

/** Parse and check an archive file. Throws too-large or bad-archive (A1-A3). */
export function parseArchive(text: string): Archive {
  // A string has at least one byte per character, so this refuses before parsing.
  if (text.length > MAX_ARCHIVE_BYTES) throw new FoxcacheError("too-large", `The archive is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB.`);
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new FoxcacheError("bad-archive", "The archive is not JSON.");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) throw new FoxcacheError("bad-archive", "The archive must be a JSON object.");
  const o = data as Record<string, unknown>;
  if (o.schema !== SCHEMA) throw new FoxcacheError("bad-archive", `The archive schema is ${JSON.stringify(o.schema)}, not "${SCHEMA}".`);
  if (typeof o.exportedAt !== "string" || Number.isNaN(Date.parse(o.exportedAt))) throw new FoxcacheError("bad-archive", "exportedAt must be a time.");
  const out = { schema: SCHEMA, exportedAt: new Date(o.exportedAt).toISOString() } as Archive;
  for (const kind of KINDS) {
    const items = o[kind];
    if (!Array.isArray(items)) throw new FoxcacheError("bad-archive", `${kind} must be a list.`);
    (out as Record<Kind, unknown[]>)[kind] = items.map((item, i) => {
      try {
        return check(kind, item);
      } catch (error) {
        throw new FoxcacheError("bad-archive", `${kind}[${i}]: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  return out;
}

/** Every valid record in the store, sorted by key, as an archive. */
export async function toArchive(store: Store, now = new Date()): Promise<Archive> {
  const out = { schema: SCHEMA, exportedAt: now.toISOString() } as Archive;
  for (const kind of KINDS) {
    const records = await store.all(kind);
    const keyed = records.map((r) => [recordKey(kind, r), r] as const).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    (out as Record<Kind, unknown[]>)[kind] = keyed.map(([, r]) => r);
  }
  return out;
}

/** Check the whole file, then merge it into the store. The newer copy of a duplicate wins (A4). */
export async function importArchive(store: Store, text: string): Promise<Record<PutResult, number>> {
  const archive = parseArchive(text);
  const counts: Record<PutResult, number> = { added: 0, updated: 0, same: 0 };
  for (const kind of KINDS) for (const record of archive[kind]) counts[await store.put(kind, record)] += 1;
  return counts;
}
