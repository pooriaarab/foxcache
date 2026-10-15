// The store: records by kind, keyed <provider>:<id>, on a small backend
// interface. The extension backs it with IndexedDB, the CLI with a file,
// and the tests with memory. Every write goes through check().
import { FoxcacheError } from "./errors.js";
import { type Conversation, KINDS, type Kind, type ProviderId, type RecordOf, check, recordKey } from "./schema.js";

export type Area = Kind | "checkpoints";
export interface Backend {
  get(area: Area, key: string): Promise<unknown>;
  put(area: Area, key: string, value: unknown): Promise<void>;
  delete(area: Area, key: string): Promise<void>;
  entries(area: Area): Promise<Array<[string, unknown]>>;
  clear(): Promise<void>;
}

/** A backend in memory, for tests and for a one-off CLI run. */
export function memoryBackend(): Backend {
  const areas = new Map<Area, Map<string, unknown>>();
  const area = (a: Area) => areas.get(a) ?? areas.set(a, new Map()).get(a)!;
  return {
    get: async (a, key) => structuredClone(area(a).get(key)),
    put: async (a, key, value) => void area(a).set(key, structuredClone(value)),
    delete: async (a, key) => void area(a).delete(key),
    entries: async (a) => [...area(a)].map(([k, v]) => [k, structuredClone(v)]),
    clear: async () => areas.clear(),
  };
}

export type PutResult = "added" | "updated" | "same";
export interface Hit {
  kind: Kind;
  key: string;
  provider: ProviderId;
  title: string;
  snippet: string;
}
export interface SearchOptions {
  provider?: ProviderId;
  kind?: Kind;
  limit?: number;
}
export type Counts = Partial<Record<ProviderId, Partial<Record<Kind, number>>>>;
export interface Problem {
  kind: Kind;
  key: string;
  error: string;
}

export const MAX_QUERY = 200;
const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 90;

/** One short line around the first match, with whitespace collapsed. */
function snippet(text: string, at: number, length: number): string {
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(text.length, at + length + SNIPPET_AFTER);
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/** The searchable texts of a record, with the title a hit shows. */
function texts(kind: Kind, r: RecordOf[Kind]): { title: string; parts: string[] } {
  switch (kind) {
    case "conversations": {
      const c = r as Conversation;
      // Messages first: a snippet of the text says more than the title again.
      return { title: c.title, parts: [...c.messages.map((m) => m.text), c.title] };
    }
    case "projects": {
      const p = r as RecordOf["projects"];
      return { title: p.name, parts: [p.name, p.instructions ?? ""] };
    }
    case "memories":
      return { title: (r as RecordOf["memories"]).text.slice(0, 80), parts: [(r as RecordOf["memories"]).text] };
    case "preferences":
      return { title: (r as RecordOf["preferences"]).kind, parts: [(r as RecordOf["preferences"]).text] };
    case "library":
      return { title: (r as RecordOf["library"]).name, parts: [(r as RecordOf["library"]).name] };
  }
}

export function createStore(backend: Backend) {
  /** The valid records of a kind. A record that fails its check is skipped (ST3). */
  async function all<K extends Kind>(kind: K, filter: { provider?: ProviderId } = {}): Promise<RecordOf[K][]> {
    const out: RecordOf[K][] = [];
    for (const [, value] of await backend.entries(kind)) {
      let record: RecordOf[K];
      try {
        record = check(kind, value);
      } catch {
        continue;
      }
      if (!filter.provider || record.provider === filter.provider) out.push(record);
    }
    return out;
  }

  return {
    backend,
    all,

    /** Check and store one record. A conversation keeps the copy with the newer updatedAt (ST1). */
    async put<K extends Kind>(kind: K, input: unknown): Promise<PutResult> {
      const record = check(kind, input);
      const key = recordKey(kind, record);
      const stored = await backend.get(kind, key);
      // A stored copy that fails its check counts as absent, so a good copy replaces it (ST3).
      let valid: RecordOf[K] | undefined;
      try {
        valid = stored === undefined ? undefined : check(kind, stored);
      } catch {
        valid = undefined;
      }
      if (valid !== undefined) {
        if (kind === "conversations") {
          if ((valid as Conversation).updatedAt >= (record as Conversation).updatedAt) return "same";
        } else if (JSON.stringify(valid) === JSON.stringify(record)) return "same";
      }
      await backend.put(kind, key, record);
      return stored === undefined ? "added" : "updated";
    },

    async get<K extends Kind>(kind: K, key: string): Promise<RecordOf[K] | undefined> {
      const value = await backend.get(kind, key);
      return value === undefined ? undefined : check(kind, value);
    },

    /** id -> updatedAt of the stored conversations of one provider, for an incremental capture (C8). */
    async stamps(provider: ProviderId): Promise<Record<string, string>> {
      return Object.fromEntries((await all("conversations", { provider })).map((c) => [c.id, c.updatedAt]));
    },

    async counts(): Promise<Counts> {
      const out: Counts = {};
      for (const kind of KINDS) for (const r of await all(kind)) {
        const p = (out[r.provider] ??= {});
        p[kind] = (p[kind] ?? 0) + 1;
      }
      return out;
    },

    /** Every stored record that fails its check. Reads skip them; nothing deletes them (ST3). */
    async problems(): Promise<Problem[]> {
      const out: Problem[] = [];
      for (const kind of KINDS) for (const [key, value] of await backend.entries(kind)) {
        try {
          check(kind, value);
        } catch (error) {
          out.push({ kind, key, error: error instanceof FoxcacheError ? `${error.code}: ${error.message}` : String(error) });
        }
      }
      return out;
    },

    /** Case-insensitive text search over titles and texts, in store order (ST5, ST6). */
    async search(query: string, opts: SearchOptions = {}): Promise<Hit[]> {
      const q = query.trim().toLowerCase();
      if (!q) throw new FoxcacheError("bad-query", "The search text is empty.");
      if (q.length > MAX_QUERY) throw new FoxcacheError("bad-query", `The search text is longer than ${MAX_QUERY} characters.`);
      const limit = opts.limit ?? 50;
      const hits: Hit[] = [];
      for (const kind of opts.kind ? [opts.kind] : KINDS) {
        for (const r of await all(kind, { provider: opts.provider })) {
          const { title, parts } = texts(kind, r);
          for (const part of parts) {
            const at = part.toLowerCase().indexOf(q);
            if (at < 0) continue;
            hits.push({ kind, key: recordKey(kind, r), provider: r.provider, title, snippet: snippet(part, at, q.length) });
            break;
          }
          if (hits.length >= limit) return hits;
        }
      }
      return hits;
    },

    checkpoint: (provider: ProviderId): Promise<unknown> => backend.get("checkpoints", provider),
    setCheckpoint: (provider: ProviderId, value: unknown): Promise<void> => backend.put("checkpoints", provider, value),
    clearCheckpoint: (provider: ProviderId): Promise<void> => backend.delete("checkpoints", provider),

    /** Delete every record and checkpoint (ST4). */
    deleteAll: (): Promise<void> => backend.clear(),
  };
}
export type Store = ReturnType<typeof createStore>;
