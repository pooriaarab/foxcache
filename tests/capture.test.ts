import { describe, expect, it } from "vitest";
import { type Adapter, type Checkpoint, type Conversation, FoxcacheError, type Http, type Kind, type Stub, runCapture } from "../src/index.js";

const T = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString();
const conv = (s: Stub): Conversation => ({ provider: "chatgpt", id: s.id, title: s.title, createdAt: T(0), updatedAt: s.updatedAt, messages: [{ role: "user", text: `text of ${s.id}`, attachments: [] }] });

/**
 * A fake provider. Each list page and each conversation is one http.get, so
 * the test sees the real request order through the Http the runner gives it.
 */
function provider(opts: { stubs?: Stub[]; pageSize?: number; reply?: (path: string, n: number) => unknown; extras?: Partial<Adapter> } = {}) {
  const stubs = opts.stubs ?? Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}`, updatedAt: T(100 - i) }));
  const size = opts.pageSize ?? 2;
  const log: string[] = [];
  const counts = new Map<string, number>();
  const http: Http = {
    async get(path) {
      log.push(path);
      const n = (counts.get(path) ?? 0) + 1;
      counts.set(path, n);
      const r = opts.reply?.(path, n);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const adapter: Adapter = {
    id: "chatgpt",
    label: "ChatGPT",
    origin: "https://chatgpt.com",
    newestFirst: true,
    async detect(h) {
      await h.get("/me");
      return true;
    },
    async listConversations(h, cursor) {
      const at = Number(cursor ?? 0);
      const r = await h.get(`/list?${at}`);
      if (r !== undefined) return r as never;
      const items = stubs.slice(at, at + size);
      return { items, next: at + size < stubs.length ? String(at + size) : undefined };
    },
    async getConversation(h, stub) {
      const r = await h.get(`/c/${stub.id}`);
      if (r !== undefined) return r as never;
      return conv(stub);
    },
    ...opts.extras,
  };
  return { adapter, http, log };
}

function sink(stopAfter = Infinity) {
  const records: Array<[Kind, unknown]> = [];
  const checkpoints: Checkpoint[] = [];
  return {
    records,
    checkpoints,
    async put(kind: Kind, record: unknown) {
      records.push([kind, record]);
      return { stop: records.length >= stopAfter };
    },
    async checkpoint(cp: Checkpoint) {
      checkpoints.push(structuredClone(cp));
      return { stop: false };
    },
  };
}

const sleeps: number[] = [];
const sleep = async (ms: number) => void sleeps.push(ms);
const run = (p: ReturnType<typeof provider>, s: ReturnType<typeof sink>, more: Partial<Parameters<typeof runCapture>[0]> = {}) => {
  sleeps.length = 0;
  return runCapture({ adapter: p.adapter, http: p.http, sink: s, stamps: {}, delayMs: 1500, sleep, ...more });
};
const err = (code: string, extra = {}) => new FoxcacheError(code as never, code, extra);

describe("C1 signed out", () => {
  it("ends with logged-out and sends nothing else", async () => {
    const p = provider({ reply: (path) => (path === "/me" ? err("logged-out", { status: 401 }) : undefined) });
    const cp = await run(p, sink());
    expect([cp.status, cp.error?.code]).toEqual(["failed", "logged-out"]);
    expect(p.log).toEqual(["/me"]);
  });
  it("ends with logged-out when detect says no", async () => {
    const p = provider({ extras: { detect: async () => false } });
    expect((await run(p, sink())).error?.code).toBe("logged-out");
    expect(p.log).toEqual([]);
  });
});

describe("C2 polite order", () => {
  it("sends one request at a time, with the delay before every request after the first", async () => {
    const p = provider();
    const s = sink();
    const cp = await run(p, s);
    expect(cp.status).toBe("done");
    expect(p.log).toEqual(["/me", "/list?0", "/c/c0", "/c/c1", "/list?2", "/c/c2", "/c/c3", "/list?4", "/c/c4"]);
    expect(sleeps).toEqual(Array(p.log.length - 1).fill(1500));
    expect(s.records.map(([k]) => k)).toEqual(Array(5).fill("conversations"));
    expect(cp.counts).toMatchObject({ conversations: 5, skipped: 0, errors: 0 });
  });
});

describe("C3 429 storm", () => {
  it("backs off 2, 4, 8, 16, 32 s and stops with rate-limited after 6 tries", async () => {
    const p = provider({ reply: (path) => (path === "/list?0" ? err("rate-limited", { status: 429 }) : undefined) });
    const cp = await run(p, sink());
    expect([cp.status, cp.error?.code]).toEqual(["failed", "rate-limited"]);
    expect(p.log.filter((x) => x === "/list?0")).toHaveLength(6);
    expect(sleeps.filter((ms) => ms !== 1500)).toEqual([2000, 4000, 8000, 16000, 32000]);
    expect(cp.cursor).toBeUndefined();
  });
  it("waits Retry-After, then goes on", async () => {
    const p = provider({ reply: (path, n) => (path === "/c/c1" && n === 1 ? err("rate-limited", { status: 429, retryAfter: 7 }) : undefined) });
    const cp = await run(p, sink());
    expect(cp.status).toBe("done");
    expect(sleeps).toContain(7000);
  });
  it("stops at once when Retry-After is over 10 minutes", async () => {
    const p = provider({ reply: (path) => (path === "/c/c0" ? err("rate-limited", { status: 429, retryAfter: 3600 }) : undefined) });
    const cp = await run(p, sink());
    expect(cp.error?.code).toBe("rate-limited");
    expect(p.log.filter((x) => x === "/c/c0")).toHaveLength(1);
  });
});

describe("C4 endless list", () => {
  it("stops when a cursor comes again", async () => {
    const p = provider({ reply: (path) => (path.startsWith("/list") ? { items: [{ id: `x${path}`, title: "x", updatedAt: T(1) }], next: "0" } : undefined) });
    expect((await run(p, sink())).error?.code).toBe("pagination-loop");
  });
  it("stops when a page has only ids it has seen", async () => {
    let page = 0;
    const p = provider({ reply: (path) => (path.startsWith("/list") ? { items: [{ id: "same", title: "x", updatedAt: T(1) }], next: String(++page) } : undefined) });
    expect((await run(p, sink())).error?.code).toBe("pagination-loop");
  });
  it("stops after the page limit", async () => {
    let page = 0;
    const p = provider({ reply: (path) => (path.startsWith("/list") ? { items: [{ id: `id${page}`, title: "x", updatedAt: T(1) }], next: String(++page) } : path.startsWith("/c/") ? undefined : undefined) });
    const cp = await run(p, sink(), { maxPages: 30 });
    expect(cp.error?.code).toBe("pagination-loop");
    expect(cp.pages).toBe(30);
  });
});

describe("C5 changed provider schema", () => {
  it("ends the capture when a list page has an unknown shape", async () => {
    const p = provider({ reply: (path) => (path === "/list?2" ? err("provider-schema") : undefined) });
    const cp = await run(p, sink());
    expect([cp.status, cp.error?.code, cp.counts.conversations]).toEqual(["failed", "provider-schema", 2]);
  });
  it("skips one bad conversation and counts it", async () => {
    const p = provider({ reply: (path) => (path === "/c/c1" ? err("provider-schema") : undefined) });
    const cp = await run(p, sink());
    expect([cp.status, cp.counts.conversations, cp.counts.errors]).toEqual(["done", 4, 1]);
    expect(cp.lastErrors[0]).toMatch(/c1: provider-schema/);
  });
  it("counts a record the store refuses as an error", async () => {
    const p = provider({ reply: (path) => (path === "/c/c2" ? { ...conv({ id: "c2", title: "x", updatedAt: T(1) }), messages: "nope" } : undefined) });
    const cp = await run(p, sink());
    expect([cp.status, cp.counts.conversations, cp.counts.errors]).toEqual(["done", 4, 1]);
  });
  it("ends after three bad conversations in a row", async () => {
    const p = provider({ reply: (path) => (path.startsWith("/c/") ? err("provider-schema") : undefined) });
    const cp = await run(p, sink());
    expect([cp.status, cp.error?.code, cp.counts.errors]).toEqual(["failed", "provider-schema", 3]);
  });
});

describe("C6 Stop", () => {
  it("ends after the request in flight", async () => {
    const p = provider();
    const s = sink(2);
    const cp = await run(p, s);
    expect(cp.status).toBe("stopped");
    expect(s.records).toHaveLength(2);
    expect(p.log.at(-1)).toBe("/c/c1");
  });
  it("stops through the signal too", async () => {
    const p = provider();
    const ctl = new AbortController();
    ctl.abort();
    expect((await run(p, sink(), { signal: ctl.signal })).status).toBe("stopped");
    expect(p.log).toEqual([]);
  });
});

describe("C7 resume", () => {
  it("starts at the saved cursor and skips stored conversations", async () => {
    const first = provider();
    const s = sink(3);
    const stopped = await run(first, s);
    expect([stopped.status, stopped.cursor]).toEqual(["stopped", "2"]);
    const stamps = Object.fromEntries(s.records.map(([, r]) => [(r as Conversation).id, (r as Conversation).updatedAt]));
    const again = provider();
    const s2 = sink();
    const cp = await run(again, s2, { stamps, resume: stopped });
    expect(cp.status).toBe("done");
    expect(again.log).toEqual(["/me", "/list?2", "/c/c3", "/list?4", "/c/c4"]);
    expect(cp.counts).toMatchObject({ conversations: 5, skipped: 1 });
  });
});

describe("C8 incremental", () => {
  it("fetches only newer conversations, and stops at a page with no change", async () => {
    const p = provider();
    const stamps = { c0: T(99), c1: T(99), c2: T(98), c3: T(97) };
    const cp = await run(p, sink(), { stamps });
    expect(p.log).toEqual(["/me", "/list?0", "/c/c0", "/list?2"]);
    expect(cp.counts).toMatchObject({ conversations: 1, skipped: 3 });
  });
  it("reads the whole list when the order is not by update", async () => {
    const p = provider({ extras: { newestFirst: false } });
    const stamps = { c0: T(100), c1: T(99), c2: T(98), c3: T(97) };
    await run(p, sink(), { stamps });
    expect(p.log).toEqual(["/me", "/list?0", "/list?2", "/list?4", "/c/c4"]);
  });
});

describe("C9 optional kinds", () => {
  it("counts a failed kind and still captures the conversations", async () => {
    const p = provider({
      extras: {
        memories: async () => {
          throw err("not-found");
        },
        preferences: async () => [{ provider: "chatgpt", kind: "about-me", text: "I teach" }],
      },
    });
    const s = sink();
    const cp = await run(p, s);
    expect(cp.status).toBe("done");
    expect(cp.counts).toMatchObject({ conversations: 5, preferences: 1, errors: 1 });
    expect(cp.lastErrors[0]).toMatch(/memories: not-found/);
  });
  it("ends on logged-out in a kind", async () => {
    const p = provider({ extras: { projects: async () => Promise.reject(err("logged-out")) } });
    expect((await run(p, sink())).error?.code).toBe("logged-out");
  });
});
