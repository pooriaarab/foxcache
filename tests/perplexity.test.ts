// docs/providers/perplexity.md: PX1-PX7, through the adapter's own reads.
import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_MESSAGES, check } from "../src/index.js";
import { MAX_SUBPAGES } from "../src/adapters/read.js";
import { perplexity } from "../src/adapters/perplexity.js";
import { captureAll } from "./adapter-kit.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const T1 = "9e7a0000-0000-4000-8000-000000000001";
const T2 = "9e7a0000-0000-4000-8000-000000000002";
const V = "version=2.18&source=default";
const SESSION = `/api/auth/session?${V}`;
const PINNED = `POST /rest/thread/list_pinned_ask_threads?${V}`;
const LIST = `POST /rest/thread/list_ask_threads?${V}`;
const THREAD = (id: string) => `/rest/thread/${id}?with_schematized_response=true&${V}&limit=100&offset=0&from_first=true`;
const MEMORY = "POST /rest/perplexity_ask/graphql";
const open = (routes = fixture("perplexity")) => fixtureHttp(perplexity, routes);
const stub = (id: string, updatedAt = "") => ({ id, title: "", updatedAt });
const listBody = (offset: number) => JSON.stringify({ limit: 50, ascending: false, offset, search_term: "", exclude_asi: false });
const row = (i: number) => ({ uuid: `t${i}`, title: `T${i}`, last_query_datetime: "2026-09-01T00:00:00" });
const loopPage = (n: number) => ({ entries: [{ uuid: `e${n}`, query_str: "q", entry_created_datetime: "2026-08-01T09:00:00", blocks: [] }], has_next_page: true, next_cursor: "same" });
const block = (usage: string, answer: string) => ({ intended_usage: usage, markdown_block: { answer } });
const entry = (blocks: unknown[]) => ({ entries: [{ uuid: "e3", query_str: "q", entry_created_datetime: "2026-08-01T09:00:00", blocks }], has_next_page: false });
const memoryNode = (id: string) => ({ node: { id, displayValue: id } });
const memoryBody = (after: string | null) => JSON.stringify({ operationName: "KnowledgeContextKnowledgeRelayQuery", variables: { knowledgeFirst: null, knowledgeAfter: null, memoriesFirst: 100, memoriesAfter: after, includeKnowledgePage: false, includeMemoriesPage: true, includeContent: true, includeOutboundLinks: true }, extensions: { persistedQuery: { version: 1, sha256Hash: "2884580667156294c2dfab80de32b737ef7bdf1d2c765a1f37e45e0207afcc50" } } });
const memories = (edges: unknown[], pageInfo: unknown, status = "OK") => ({ data: { viewer: { knowledgeContext: { scopeByKind: { id: "s", memoryCategories: [{ id: "individual:memories", items: { status, edges, pageInfo } }] } } } } });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("perplexity detect", () => {
  it("is signed in when the session has a user", async () => {
    expect(await perplexity.detect(open().http)).toBe(true);
  });
  it("PX2 is signed out on a 401, a 403, or a half-valid session with an empty user", async () => {
    expect(await perplexity.detect(open({ [SESSION]: { $status: 401 } }).http)).toBe(false);
    expect(await perplexity.detect(open({ [SESSION]: { $status: 403 } }).http)).toBe(false);
    expect(await perplexity.detect(open({ [SESSION]: { user: { id: "", email: "" } } }).http)).toBe(false);
    expect(await perplexity.detect(open({ [SESSION]: {} }).http)).toBe(false);
  });
});

describe("perplexity list", () => {
  it("reads the pinned threads with list offset 0, and ends at a short page", async () => {
    const f = open();
    expect(await perplexity.listConversations(f.http)).toEqual({
      items: [
        { id: T1, title: "Lisbon trams", updatedAt: "2026-09-03T10:00:00.250Z" },
        { id: T2, title: "<img src=x onerror=alert(1)>", updatedAt: "2026-08-01T09:00:03.000Z" },
      ],
      next: undefined,
    });
    expect(f.calls).toEqual([PINNED, LIST]);
  });
  it("PX41 reads a pinned list that equals main page 0 once, with no pagination-loop", async () => {
    const base = fixture("perplexity");
    const routes = { ...base, [LIST]: base[PINNED], [`${LIST} ${listBody(0)}`]: base[PINNED] };
    const { checkpoint, records } = await captureAll(perplexity, open(routes).http);
    expect([checkpoint.status, checkpoint.error?.code]).toEqual(["done", undefined]);
    expect(records.filter(([kind]) => kind === "conversations").map(([, c]) => (c as { id: string }).id)).toEqual([T1]);
  });
  it("asks for the next offset after a full page", async () => {
    const routes = { [`${LIST} ${listBody(0)}`]: Array.from({ length: 50 }, (_, i) => row(i)), [`${LIST} ${listBody(50)}`]: [row(50)] };
    const f = open(routes);
    expect((await perplexity.listConversations(f.http, "0")).next).toBe("50");
    expect((await perplexity.listConversations(f.http, "50")).items.map((s) => s.id)).toEqual(["t50"]);
  });
  it("PX1 names the field when the list changed", async () => {
    expect(await code(perplexity.listConversations(open({ [LIST]: { threads: [] } }).http, "0"))).toMatch(/^provider-schema: perplexity: list_ask_threads is not a list/);
    expect(await code(perplexity.listConversations(open({ [LIST]: [{ title: "x" }] }).http, "0"))).toMatch(/^provider-schema: perplexity: list_ask_threads\[0\].uuid is not text/);
  });
  it("PX3 passes a 429 on as rate-limited", async () => {
    expect(await code(perplexity.listConversations(open({ [PINNED]: { $status: 429 } }).http))).toMatch(/^rate-limited: /);
  });
});

describe("perplexity threads", () => {
  it("follows next_cursor, drops the repeated entry, and keeps the markdown answer", async () => {
    const c = await perplexity.getConversation(open().http, stub(T1, "2026-09-03T10:00:00.250Z"));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "perplexity", id: T1, title: "Lisbon trams", createdAt: "2026-09-03T09:59:00.000Z", updatedAt: "2026-09-03T10:00:00.250Z", model: "pplx_pro" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Which tram goes to Belem?"],
      ["assistant", "Tram **15E** goes to Belem."],
      ["user", "And back?"],
      ["assistant", "Take the 15E back."],
    ]);
  });
  it("PX42 skips an empty markdown answer for the real one", async () => {
    const real = await perplexity.getConversation(open({ [THREAD(T2)]: entry([block("ask_text_0_markdown", ""), block("ask_text", "The real answer.")]) }).http, stub(T2));
    expect(real.messages.map((m) => [m.role, m.text])).toEqual([["user", "q"], ["assistant", "The real answer."]]);
    const none = await perplexity.getConversation(open({ [THREAD(T2)]: entry([block("ask_text_0_markdown", "")]) }).http, stub(T2));
    expect(none.messages.map((m) => m.role)).toEqual(["user"]);
  });
  it("PX7 keeps hostile text as text", async () => {
    const c = await perplexity.getConversation(open().http, stub(T2));
    expect([c.title, c.messages[0]!.text, c.updatedAt]).toEqual(["<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "2026-08-01T09:00:00.000Z"]);
  });
  it("PX1 names the field when an entry changed", async () => {
    const routes = { [THREAD(T2)]: { entries: [{ uuid: "e3", query: "x", entry_created_datetime: "2026-08-01T09:00:00" }], has_next_page: false } };
    expect(await code(perplexity.getConversation(open(routes).http, stub(T2)))).toMatch(/^provider-schema: perplexity: entries\[0\].query_str is not text/);
  });
  it("PX4 throws pagination-loop when next_cursor comes again", async () => {
    const routes = { [THREAD(T2)]: loopPage(1), [`${THREAD(T2)}&cursor=same`]: loopPage(2) };
    expect(await code(perplexity.getConversation(open(routes).http, stub(T2)))).toMatch(/^pagination-loop: perplexity: /);
  });
  it("PX5 throws too-large while it reads a thread with too many entries", async () => {
    const entries = Array.from({ length: MAX_MESSAGES / 2 + 1 }, (_, i) => ({ uuid: `e${i}`, query_str: "q", entry_created_datetime: "2026-08-01T09:00:00", blocks: [{ intended_usage: "ask_text", markdown_block: { answer: "a" } }] }));
    expect(await code(perplexity.getConversation(open({ [THREAD(T2)]: { entries, has_next_page: true, next_cursor: "more" } }).http, stub(T2)))).toMatch(/^too-large: perplexity: /);
  });
});

describe("perplexity memories", () => {
  it("reads each memory's text and id", async () => {
    const list = await perplexity.memories!(open().http);
    expect(list).toEqual([{ provider: "perplexity", id: "mem-1", text: "Prefers trains to planes" }]);
    expect(check("memories", list[0])).toEqual(list[0]);
  });
  it("follows endCursor to the next page", async () => {
    const routes = { [`${MEMORY} ${memoryBody(null)}`]: memories([memoryNode("a")], { hasNextPage: true, endCursor: "c1" }), [`${MEMORY} ${memoryBody("c1")}`]: memories([memoryNode("b")], { hasNextPage: false, endCursor: "c2" }) };
    expect((await perplexity.memories!(open(routes).http)).map((m) => m.id)).toEqual(["a", "b"]);
  });
  it("PX6 throws provider-schema on GraphQL errors (a stale hash) or a category that is not OK", async () => {
    expect(await code(perplexity.memories!(open({ [MEMORY]: { errors: [{ message: "PersistedQueryNotFound" }] } }).http))).toMatch(/^provider-schema: perplexity: memory query answered errors/);
    expect(await code(perplexity.memories!(open({ [MEMORY]: memories([], { hasNextPage: false }, "PARTIAL") }).http))).toMatch(/^provider-schema: perplexity: memoryCategories\[0\].items.status is "PARTIAL"/);
  });
  it("PX40 throws provider-schema on an empty category list, so no stored memory is deleted", async () => {
    const empty = { data: { viewer: { knowledgeContext: { scopeByKind: { id: "s", memoryCategories: [] } } } } };
    expect(await code(perplexity.memories!(open({ [MEMORY]: empty }).http))).toMatch(/^provider-schema: perplexity: memoryCategories is empty/);
  });
  it("PX4 throws pagination-loop when endCursor comes again, or never ends", async () => {
    const again = memories([], { hasNextPage: true, endCursor: "c1" });
    expect(await code(perplexity.memories!(open({ [MEMORY]: again }).http))).toMatch(/^pagination-loop: perplexity: /);
    let n = 0;
    const endless = fixtureHttp(perplexity, new Proxy({}, { has: () => true, get: () => memories([], { hasNextPage: true, endCursor: `c${n++}` }) }));
    expect(await code(perplexity.memories!(endless.http))).toMatch(new RegExp(`^pagination-loop: perplexity: .*${MAX_SUBPAGES} pages`));
  });
});
