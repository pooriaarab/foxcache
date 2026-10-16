// Small helpers for the adapter tests: the error of a promise as
// "<code>: <message>", a full capture into memory with no pauses, and a
// fetch that answers with a body larger than http allows.
import { type Adapter, type Checkpoint, FoxcacheError, type Http, type Kind, MAX_RESPONSE_BYTES, runCapture } from "../src/index.js";

export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

const go = async () => ({ stop: false });

/** Run a whole capture and keep what it stores. */
export async function captureAll(adapter: Adapter, http: Http): Promise<{ checkpoint: Checkpoint; records: Array<[Kind, unknown]> }> {
  const records: Array<[Kind, unknown]> = [];
  const sink = { put: async (kind: Kind, record: unknown) => (records.push([kind, record]), { stop: false }), checkpoint: go, keep: go };
  const checkpoint = await runCapture({ adapter, http, sink, stamps: {}, sleep: async () => undefined });
  return { checkpoint, records };
}

/** A fetch whose every answer says it is larger than MAX_RESPONSE_BYTES. */
export const hugeFetch = async () => new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } });
