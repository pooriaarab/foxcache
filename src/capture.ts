// The capture runner. It runs in the provider tab (the agent), calls the
// adapter, and hands each record to a sink (the event page). It is polite:
// one request at a time, a delay between requests, and a backoff on 429.
// Its checkpoint lets a stopped or failed capture resume. The rows C1-C9
// in docs/failure-modes.md are what it must get right.
import type { Adapter, Stub } from "./adapters/types.js";
import { FoxcacheError } from "./errors.js";
import type { Http, Query } from "./http.js";
import { type Kind, type ProviderId, check, recordKey } from "./schema.js";

export type CaptureStatus = "running" | "done" | "stopped" | "failed" | "interrupted";
export interface CaptureCounts {
  conversations: number;
  skipped: number;
  errors: number;
  projects: number;
  memories: number;
  preferences: number;
  library: number;
}
export interface Checkpoint {
  provider: ProviderId;
  status: CaptureStatus;
  startedAt: string;
  updatedAt: string;
  /** True when projects, memories, preferences and library are done in this capture. */
  extrasDone: boolean;
  /** The cursor of the next list page to read. Undefined: the first page. */
  cursor?: string;
  pages: number;
  counts: CaptureCounts;
  /** The last few per-item errors, newest last. */
  lastErrors: string[];
  error?: { code: string; message: string };
}
export interface Sink {
  /** Store one record. The answer says whether the user asked to stop. */
  put(kind: Kind, record: unknown): Promise<{ stop: boolean }>;
  checkpoint(checkpoint: Checkpoint): Promise<{ stop: boolean }>;
  /** The kind was read in full: delete the stored records of this provider and kind whose key is not in keys (C11). */
  keep(kind: Kind, keys: string[]): Promise<{ stop: boolean }>;
}
export interface CaptureOptions {
  adapter: Adapter;
  http: Http;
  sink: Sink;
  /** id -> updatedAt of the stored conversations of this provider. */
  stamps: Record<string, string>;
  /** A checkpoint to resume from. */
  resume?: Checkpoint;
  /**
   * Allow the stop at the first page with no change (newest-first lists only).
   * It is safe only when the last capture of this provider read everything:
   * it ended done, with no error. A resumed run never stops early (C10).
   */
  earlyStop?: boolean;
  delayMs?: number;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  signal?: AbortSignal;
}

export const DEFAULT_DELAY_MS = 1500;
export const MAX_PAGES = 2000;
export const MAX_TRIES = 6;
export const MAX_BACKOFF_MS = 60_000;
/** A Retry-After longer than this ends the capture instead of waiting. */
export const MAX_RETRY_AFTER_S = 600;
const MAX_BAD_IN_A_ROW = 3;
const KEEP_ERRORS = 10;
const EXTRAS = ["projects", "memories", "preferences", "library"] as const;

/** Thrown inside the runner when the user stops the capture. */
class Stopped extends Error {}

const describe = (error: unknown) => (error instanceof FoxcacheError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : String(error));
const codeOf = (error: unknown) => (error instanceof FoxcacheError ? error.code : "error");

export async function runCapture(o: CaptureOptions): Promise<Checkpoint> {
  // The default sleep ends early on Stop, so a long backoff does not hold it (C6).
  const sleep =
    o.sleep ??
    ((ms: number) =>
      new Promise<void>((done) => {
        const timer = setTimeout(done, ms);
        o.signal?.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
      }));
  const now = () => (o.now ?? (() => new Date()))().toISOString();
  const delayMs = o.delayMs ?? DEFAULT_DELAY_MS;
  const maxPages = o.maxPages ?? MAX_PAGES;
  const stamps = { ...o.stamps };
  const resumable = o.resume && o.resume.status !== "done" && o.resume.status !== "running";
  const earlyStop = o.earlyStop === true && o.adapter.newestFirst && !resumable;
  const cp: Checkpoint = resumable
    ? { ...structuredClone(o.resume!), status: "running", updatedAt: now(), error: undefined }
    : {
        provider: o.adapter.id,
        status: "running",
        startedAt: now(),
        updatedAt: now(),
        extrasDone: false,
        pages: 0,
        counts: { conversations: 0, skipped: 0, errors: 0, projects: 0, memories: 0, preferences: 0, library: 0 },
        lastErrors: [],
      };
  let stop = false;
  let sent = 0;
  const halt = () => {
    if (stop || o.signal?.aborted) throw new Stopped();
  };

  // The Http the adapter gets: in order, with the delay, and with the 429 backoff (C2, C3).
  const polite: Http = {
    async get(path: string, query?: Query) {
      for (let tries = 1; ; tries++) {
        halt();
        if (sent++ > 0 && tries === 1) await sleep(delayMs);
        halt();
        try {
          return await o.http.get(path, query);
        } catch (error) {
          if (!(error instanceof FoxcacheError) || error.code !== "rate-limited" || tries >= MAX_TRIES) throw error;
          if (error.retryAfter !== undefined && error.retryAfter > MAX_RETRY_AFTER_S) throw error;
          await sleep(error.retryAfter !== undefined ? error.retryAfter * 1000 : Math.min(MAX_BACKOFF_MS, 1000 * 2 ** tries));
          halt();
        }
      }
    },
  };

  const noteError = (what: string, error: unknown) => {
    cp.counts.errors += 1;
    cp.lastErrors = [...cp.lastErrors, `${what}: ${describe(error)}`].slice(-KEEP_ERRORS);
  };
  /** Send one checked record to the sink and return its store key. */
  async function put(kind: Kind, record: unknown): Promise<string> {
    const checked = check(kind, record);
    const answer = await o.sink.put(kind, checked);
    if (answer.stop) stop = true;
    return recordKey(kind, checked);
  }
  async function save() {
    cp.updatedAt = now();
    const answer = await o.sink.checkpoint(cp);
    if (answer.stop) stop = true;
  }

  try {
    halt();
    if (!(await o.adapter.detect(polite))) throw new FoxcacheError("logged-out", `Sign in to ${o.adapter.origin} first.`);

    if (!cp.extrasDone) {
      for (const kind of EXTRAS) {
        if (!o.adapter[kind]) continue;
        try {
          const records: unknown[] = await o.adapter[kind]!(polite);
          const keys: string[] = [];
          for (const record of records) {
            keys.push(await put(kind, record));
            cp.counts[kind] += 1;
          }
          // A stopped kind may be partial, so it deletes nothing.
          halt();
          if ((await o.sink.keep(kind, keys)).stop) stop = true;
        } catch (error) {
          if (error instanceof Stopped || codeOf(error) === "logged-out" || codeOf(error) === "rate-limited") throw error;
          noteError(kind, error);
        }
        halt();
      }
      cp.extrasDone = true;
      await save();
    }

    const seenCursors = new Set<string>([cp.cursor ?? ""]);
    const seenIds = new Set<string>();
    let badInARow = 0;
    for (;;) {
      halt();
      if (cp.pages >= maxPages) throw new FoxcacheError("pagination-loop", `The list did not end after ${maxPages} pages.`);
      const page = await o.adapter.listConversations(polite, cp.cursor);
      cp.pages += 1;
      if (page.items.length > 0 && page.items.every((s) => seenIds.has(s.id))) throw new FoxcacheError("pagination-loop", "The list gave the same page again.");
      let changed = false;
      for (const stub of page.items as Stub[]) {
        seenIds.add(stub.id);
        if (stamps[stub.id] !== undefined && stamps[stub.id]! >= stub.updatedAt) {
          cp.counts.skipped += 1;
          continue;
        }
        changed = true;
        halt();
        try {
          const conversation = await o.adapter.getConversation(polite, stub);
          await put("conversations", conversation);
          stamps[stub.id] = conversation.updatedAt;
          cp.counts.conversations += 1;
          badInARow = 0;
        } catch (error) {
          if (error instanceof Stopped || ["logged-out", "rate-limited"].includes(codeOf(error))) throw error;
          noteError(stub.id, error);
          if (codeOf(error) !== "not-found" && ++badInARow >= MAX_BAD_IN_A_ROW) {
            throw new FoxcacheError(codeOf(error) === "provider-schema" ? "provider-schema" : "provider-error", `${MAX_BAD_IN_A_ROW} conversations in a row failed. The last: ${describe(error)}`);
          }
        }
      }
      if (page.next === undefined || (earlyStop && !changed && page.items.length > 0)) break;
      if (seenCursors.has(page.next)) throw new FoxcacheError("pagination-loop", "The list gave a cursor it gave before.");
      seenCursors.add(page.next);
      cp.cursor = page.next;
      await save();
    }
    cp.status = "done";
    cp.cursor = undefined;
  } catch (error) {
    if (error instanceof Stopped) cp.status = "stopped";
    else {
      cp.status = "failed";
      cp.error = { code: codeOf(error), message: describe(error) };
    }
  }
  await save().catch(() => undefined);
  return cp;
}
