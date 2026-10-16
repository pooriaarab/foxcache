// SCENT v0.1 for foxcache: the "cache" namespace that foxscope reads. The
// types are a structural copy of foxscope's; foxcache does not depend on it.
// foxscope owns consent. This resolver still never returns a private field,
// and conversations are private (SC2).
import { FoxcacheError } from "./errors.js";
import type { Store } from "./store.js";

export type Sensitivity = "public" | "ask" | "private";
export interface ScentField {
  name: string;
  label: string;
  sensitivity: Sensitivity;
  derivable?: boolean;
}
export interface ScentResolver {
  namespace: string;
  list(): Promise<ScentField[]>;
  read(fields: string[], opts: { derive: boolean }): Promise<Record<string, unknown>>;
}

export const NAMESPACE = "cache";
/** The only extension that gets an answer over onMessageExternal. */
export const FOXSCOPE_ID = "foxscope@pooriaarab";
export const MAX_READ_FIELDS = 100;

const FIELDS: ScentField[] = [
  { name: "cache.memories", label: "Memories captured from AI chat sites", sensitivity: "ask" },
  { name: "cache.preferences", label: "Custom instructions and response style", sensitivity: "ask" },
  { name: "cache.projects", label: "Project names", sensitivity: "ask" },
  { name: "cache.conversations", label: "Conversations", sensitivity: "private" },
];

export function cacheResolver(store: Store): ScentResolver {
  const values: Record<string, () => Promise<unknown>> = {
    "cache.memories": async () => (await store.all("memories")).map((m) => ({ provider: m.provider, text: m.text })),
    "cache.preferences": async () => (await store.all("preferences")).map((p) => ({ provider: p.provider, kind: p.kind, text: p.text })),
    // Names only: instructions and files stay in the store (SC3).
    "cache.projects": async () => (await store.all("projects")).map((p) => ({ provider: p.provider, name: p.name })),
  };
  return Object.freeze({
    namespace: NAMESPACE,
    list: async () => FIELDS.map((f) => ({ ...f })),
    async read(fields: string[]) {
      const out: Record<string, unknown> = {};
      for (const f of FIELDS) {
        if (f.sensitivity === "private" || !fields.includes(f.name)) continue;
        out[f.name] = await values[f.name]!();
      }
      return out;
    },
  });
}

/** The parts of a WebExtension MessageSender that the check reads. */
export interface SenderLike {
  id?: string;
}

/**
 * The answer to one onMessageExternal message. Undefined means "no answer":
 * the event page then rejects as if foxcache were not installed (SC1).
 *   {type: "scent.list"}                 -> ScentField[]
 *   {type: "scent.read", fields, derive} -> { "cache.x": value }
 *   a bad scent.read                     -> { error }
 */
export function answerScent(resolver: ScentResolver, sender: SenderLike, message: unknown): Promise<unknown> | undefined {
  // Synchronous on purpose: a listener that returns a promise answers the sender.
  if (sender?.id !== FOXSCOPE_ID) return undefined;
  const m = message as { type?: unknown; fields?: unknown; derive?: unknown } | null;
  if (typeof m !== "object" || m === null) return undefined;
  if (m.type === "scent.list") return resolver.list();
  if (m.type !== "scent.read") return undefined;
  return readFor(resolver, m);
}

async function readFor(resolver: ScentResolver, m: { fields?: unknown; derive?: unknown }): Promise<unknown> {
  try {
    if (!Array.isArray(m.fields) || m.fields.length > MAX_READ_FIELDS || !m.fields.every((f) => typeof f === "string")) {
      throw new FoxcacheError("bad-request", `fields must be a list of at most ${MAX_READ_FIELDS} field names.`);
    }
    if (m.derive !== undefined && typeof m.derive !== "boolean") throw new FoxcacheError("bad-request", "derive must be true or false.");
    return await resolver.read(m.fields, { derive: m.derive === true });
  } catch (error) {
    return { error: error instanceof FoxcacheError ? `${error.code}: ${error.message}` : "foxcache could not read the cache." };
  }
}
