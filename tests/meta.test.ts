// Meta AI (docs/providers/meta.md): Relay persisted queries over POST
// /api/graphql {doc_id, variables}, with the page's cookies.
import { describe, expect, it } from "vitest";
import { type Conversation, FoxcacheError, type Http, MAX_RESPONSE_BYTES, check, cookie, createHttp, meta, runCapture } from "../src/index.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const LIST = "f9f2f515cf675e127f619401193b6992";
const MORE = "4d89d5db4e7318d2437d24b406f69199";
const PINNED = "28e9d6b1d7fe4b32a62f622dbd33ddc3";
const MESSAGES = "a40d4674ba65ae2760857ff01494762d";
const M1 = "a1b2c3d4-0000-4000-8000-000000000001";
const M2 = "a1b2c3d4-0000-4000-8000-000000000002";
/** The fixture key of one query, by its exact body. */
const op = (docId: string, variables: Record<string, unknown>) => `POST /api/graphql ${JSON.stringify({ doc_id: docId, variables })}`;
const messages = (id: string, before: string | null) => op(MESSAGES, { conversationId: id, before, last: 10 });
const open = (routes: Routes = fixture("meta")) => fixtureHttp(meta, routes);
const raw = (fetch: (url: string, init: RequestInit) => Promise<Response>) => createHttp(meta, { fetch, storage: { getItem: () => null }, cookie: () => "", scripts: () => [], call: () => undefined });
const stub = (id: string, title = "Porto weekend") => ({ id, title, updatedAt: "2026-10-14T09:30:00.000Z" });
const conn = (ids: string[], hasNextPage: boolean, endCursor: string | null) => ({ edges: ids.map((id) => ({ node: { id, updatedAt: "2026-10-01T00:00:00.000Z", title: `t ${id}`, displayTitle: `d ${id}`, __typename: "Conversation" }, cursor: id })), pageInfo: { hasNextPage, endCursor } });
const chat = (edges: unknown[], pageInfo: unknown = { hasPreviousPage: false, startCursor: "s0" }) => ({ data: { conversation: { id: M1, latestBranchPath: "1", messages: { edges, pageInfo } } } });
const msg = (id: string, __typename: string, content: string | null, createdAt: unknown) => ({ node: { id, __typename, turnId: "t", branchPath: "1", content, createdAt }, cursor: id });
const go = async () => ({ stop: false });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("meta reads", () => {
  it("sends the cookies alone, as the signed-in page does", () => {
    expect(meta.auth).toBe(cookie);
  });
  it.each([
    ["the mark-seen mutation", "0b2cb3a499606dfe326807a2b8b7ee20"],
    ["the session-refresh mutation", "954e9b193487fa4af750af87906e4313"],
    ["the delete-conversation mutation", "ad35bda8475e29ba4264ef0d6cc0958a"],
    ["a doc_id that is not listed", "ffffffffffffffffffffffffffffffff"],
  ])("refuses %s before any request", async (_, docId) => {
    const f = open();
    expect(await code(f.http.post("/api/graphql", { doc_id: docId, variables: {} }))).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
});

describe("meta detect", () => {
  it("is signed in when the list answers, and signed out on a 401 or a redirect", async () => {
    expect(await meta.detect(open().http)).toBe(true);
    expect(await meta.detect(open({ "POST /api/graphql": { $status: 401 } }).http)).toBe(false);
    expect(await meta.detect(raw(async () => Response.redirect("https://www.meta.ai/login", 302)))).toBe(false);
  });
});

describe("meta list", () => {
  it("reads the pinned and the first unpinned chats, then pages the pinned, then the unpinned", async () => {
    const f = open({
      [op(LIST, {})]: { data: { pinnedConversations: conn(["p1"], true, "p1"), unpinnedConversations: conn(["u1"], true, "u1") } },
      [op(PINNED, { pinnedAfter: "p1", pinnedFirst: 20 })]: { data: { pinnedConversations: conn(["p2"], false, "p2") } },
      [op(MORE, { unpinnedAfter: "u1", unpinnedFirst: 40 })]: { data: { unpinnedConversations: conn(["u2"], false, "u2") } },
    });
    const pages = [];
    for (let page = await meta.listConversations(f.http); ; page = await meta.listConversations(f.http, page.next)) {
      pages.push(page.items.map((s) => s.id));
      if (page.next === undefined) break;
    }
    expect(pages).toEqual([["p1", "u1"], ["p2"], ["u2"]]);
    expect((await meta.listConversations(f.http)).items[0]).toEqual({ id: "p1", title: "d p1", updatedAt: "2026-10-01T00:00:00.000Z" });
  });
  it("P1 names the field when the list shape changed", async () => {
    expect(await code(meta.listConversations(open({ [op(LIST, {})]: { data: { conversations: [] } } }).http))).toMatch(/^provider-schema: meta: data.pinnedConversations is not an object/);
    const bad = { data: { pinnedConversations: conn([], false, null), unpinnedConversations: { edges: [{ node: { id: "u", updatedAt: 1760000000 } }], pageInfo: { hasNextPage: false, endCursor: null } } } };
    expect(await code(meta.listConversations(open({ [op(LIST, {})]: bad }).http))).toMatch(/^provider-schema: meta: unpinnedConversations.edges\[0\].node.updatedAt is not a time/);
  });
  it("gives provider-schema when a doc_id has changed (GraphQL errors, no data)", async () => {
    expect(await code(meta.listConversations(open({ [op(LIST, {})]: { errors: [{ message: "GRAPHQL_VALIDATION_FAILED <b>" }] } }).http))).toMatch(/^provider-schema: meta: the list query answered GraphQL errors/);
  });
  it("throws rate-limited with Retry-After on a 429", async () => {
    expect(await meta.listConversations(raw(async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }))).catch((e: unknown) => e)).toMatchObject({ code: "rate-limited", retryAfter: 30 });
  });
  it("ends in pagination-loop when the unpinned list repeats its cursor", async () => {
    const http: Http = { get: async () => ({}), post: async (_, body) => (body.doc_id === LIST ? { data: { pinnedConversations: conn([], false, null), unpinnedConversations: conn(["u1"], true, "same") } } : { data: { unpinnedConversations: conn(["u2"], true, "same") } }) };
    const cp = await runCapture({ adapter: { ...meta, detect: async () => true, getConversation: async (_, s) => ({ provider: "meta", id: s.id, title: s.title, createdAt: s.updatedAt, updatedAt: s.updatedAt, messages: [] }) }, http, sink: { put: go, checkpoint: go, keep: go }, stamps: {}, delayMs: 0, sleep: async () => undefined });
    expect([cp.status, cp.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
  it("throws too-large on a list answer over the size limit", async () => {
    expect(await code(meta.listConversations(raw(async () => new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }))))).toMatch(/^too-large: /);
  });
});

describe("meta conversations", () => {
  it("reads a chat that passes the foxcache/v1 check", async () => {
    const c = await meta.getConversation(open().http, stub(M1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "meta", id: M1, title: "Porto weekend", createdAt: "2026-10-14T09:29:00.000Z", updatedAt: "2026-10-14T09:30:00.000Z" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Two days in Porto?", "2026-10-14T09:29:00.000Z"],
      ["assistant", "Day 1: Ribeira. Day 2: Foz.", "2026-10-14T09:30:00.000Z"],
    ]);
  });
  it("pages older messages back by startCursor, oldest first, and keeps an answer with no text (an image)", async () => {
    const routes = {
      [messages(M1, null)]: chat([msg("m3", "UserMessage", "draw a cat", "2026-10-03T00:00:00Z"), msg("m4", "AssistantMessage", null, "2026-10-04T00:00:00Z")], { hasPreviousPage: true, startCursor: "m3" }),
      [messages(M1, "m3")]: chat([msg("m1", "UserMessage", "hi", "2026-10-01T00:00:00Z"), msg("m2", "AssistantMessage", "hello", "2026-10-02T00:00:00Z")]),
    };
    expect((await meta.getConversation(open(routes).http, stub(M1))).messages.map((m) => m.text)).toEqual(["hi", "hello", "draw a cat", ""]);
  });
  it("throws provider-schema when the message pages repeat a cursor", async () => {
    const routes = { [messages(M1, null)]: chat([msg("m3", "UserMessage", "x", "2026-10-03T00:00:00Z")], { hasPreviousPage: true, startCursor: "m3" }), [messages(M1, "m3")]: chat([msg("m2", "UserMessage", "y", "2026-10-02T00:00:00Z")], { hasPreviousPage: true, startCursor: "m3" }) };
    expect(await code(meta.getConversation(open(routes).http, stub(M1)))).toMatch(/^provider-schema: meta: .*startCursor came again/);
  });
  it("keeps hostile text as text", async () => {
    const hostile = `<img src=x onerror="document.title='owned'"><script>alert(1)</script>`;
    const c: Conversation = await meta.getConversation(open({ [messages(M2, null)]: chat([msg("m1", "UserMessage", hostile, "2026-10-01T00:00:00Z")]) }).http, stub(M2, "<b>t</b>"));
    expect([check("conversations", c).messages[0]!.text, c.title]).toEqual([hostile, "<b>t</b>"]);
  });
  it("P1 names the message when its type, text or time changed, and refuses a missing chat", async () => {
    expect(await code(meta.getConversation(open({ [messages(M1, null)]: chat([msg("m1", "SystemMessage", "x", "2026-10-01T00:00:00Z")]) }).http, stub(M1)))).toMatch(/^provider-schema: meta: message m1.__typename is "SystemMessage"/);
    expect(await code(meta.getConversation(open({ [messages(M1, null)]: chat([msg("m1", "UserMessage", 5 as unknown as string, "2026-10-01T00:00:00Z")]) }).http, stub(M1)))).toMatch(/^provider-schema: meta: message m1.content is not text/);
    expect(await code(meta.getConversation(open({ [messages(M1, null)]: chat([msg("m1", "UserMessage", "x", 1760000000000)]) }).http, stub(M1)))).toMatch(/^provider-schema: meta: message m1.createdAt is not a time/);
    expect(await code(meta.getConversation(open({ [messages(M1, null)]: { data: { conversation: null } } }).http, stub(M1)))).toMatch(/^provider-schema: meta: data.conversation is not an object/);
  });
  it("throws too-large on a chat answer that streams past the size limit", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) });
    expect(await code(meta.getConversation(raw(async () => new Response(body)), stub(M1)))).toMatch(/^too-large: /);
  });
});
