// Poe (docs/providers/poe.md): persisted GraphQL reads over POST
// /api/gql_POST, signed with the page's formkey (auth page-formkey).
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { type Conversation, FoxcacheError, type Http, MAX_RESPONSE_BYTES, check, createHttp, poe, runCapture } from "../src/index.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const LIST = "6ce01455b0201e625489da90c65f87a2809d212ea41ab6e39412b6913990e81f";
const MESSAGES = "c1a8fd96dd6e0a4679814182951b1e256e175587513c81b223addf931833a692";
const FORMKEY = "0123456789abcdef0123456789abcdef";
// The page's own script, as poe.com sets it: the function name changes per build.
const PAGE = { scripts: ['window.ereNdsRqhp2Rd3LEW=function(){return window._a+window._b};'], globals: { ereNdsRqhp2Rd3LEW: () => `${FORMKEY}extra` } };
const C1 = "Q2hhdDoxMDE=";
const C2 = "Q2hhdDoxMDI=";
/** The fixture key of one GraphQL operation, by its exact body. */
const op = (queryName: string, hash: string, variables: Record<string, unknown>) => `POST /api/gql_POST ${JSON.stringify({ queryName, variables, extensions: { hash } })}`;
const list = (cursor: string | null, count = 50) => op("ChatHistoryListPaginationQuery", LIST, { count, cursor });
const messages = (id: string, cursor: string | null) => op("ChatListPaginationQuery", MESSAGES, { count: 100, cursor, id });
const open = (routes: Routes = fixture("poe")) => fixtureHttp(poe, routes, undefined, PAGE);
const stub = (id: string, title = "Lisbon in three days") => ({ id, title, updatedAt: "2026-10-15T00:00:00.000Z" });
const chat = (id: string, edges: unknown[], pageInfo: unknown = { hasNextPage: false, startCursor: "s0" }) => ({ data: { node: { id, messagesConnection: { edges, pageInfo } } } });
const msg = (messageId: number, author: string, text: string, creationTime: number) => ({ node: { messageId, author, text, contentType: "text_markdown", creationTime, state: "complete" } });
const page = (ids: string[], hasNextPage: boolean, endCursor: string) => ({ data: { chats: { edges: ids.map((id) => ({ node: { id, chatId: 1, chatCode: id, title: `t ${id}`, defaultBotObject: { displayName: "Assistant" } } })), pageInfo: { hasNextPage, endCursor } } } });
/** An Http on poe whose fetch is given, on a page with the formkey. */
const raw = (fetch: (url: string, init: RequestInit) => Promise<Response>) => createHttp(poe, { fetch, storage: { getItem: () => null }, scripts: () => PAGE.scripts, call: (n) => (n === "ereNdsRqhp2Rd3LEW" ? PAGE.globals.ereNdsRqhp2Rd3LEW() : undefined) });
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

describe("poe reads", () => {
  it("sends each read with the formkey and the md5 tag of its body", async () => {
    const sent: RequestInit[] = [];
    const http = raw(async (_, init) => (sent.push(init), new Response(JSON.stringify(fixture("poe")["POST /api/gql_POST"]))));
    await poe.listConversations(http);
    const h = new Headers(sent[0]!.headers);
    expect([h.get("poe-formkey"), h.get("poe-tag-id")]).toEqual([FORMKEY, createHash("md5").update(`${String(sent[0]!.body)}${FORMKEY}4LxgHM6KpFqokX0Ox`).digest("hex")]);
  });
  it.each([
    ["a mutation (SendMessageMutation)", { queryName: "SendMessageMutation", variables: {}, extensions: { hash: "f1486efc974a214dac6586c46b81bf631a95e58eab1d27b215f622859d74a23e" } }],
    ["DeleteChat, a write whose name does not end in Mutation", { queryName: "DeleteChat", variables: { chatId: 101 }, extensions: { hash: "5df4cb75c0c06e086b8949890b1871a9f8b9e431a930d5894d08ca86e9260a18" } }],
    ["a read name with a write's hash", { queryName: "ChatListPaginationQuery", variables: {}, extensions: { hash: "5df4cb75c0c06e086b8949890b1871a9f8b9e431a930d5894d08ca86e9260a18" } }],
    ["a write's name with a read's hash", { queryName: "DeleteUserMessagesMutation", variables: {}, extensions: { hash: LIST } }],
  ])("refuses %s before any request", async (_, body) => {
    const f = open();
    expect(await code(f.http.post("/api/gql_POST", body))).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
  it("gives provider-schema, not a guess, when the page names no formkey function", async () => {
    const f = fixtureHttp(poe, fixture("poe"), undefined, { scripts: ["var x=1;"], globals: PAGE.globals });
    expect(await code(poe.listConversations(f.http))).toMatch(/^provider-schema: The page of https:\/\/poe.com names no formkey function/);
    expect(f.calls).toEqual([]);
  });
});

describe("poe detect", () => {
  it("is signed in when the list answers", async () => {
    expect(await poe.detect(open({ [list(null, 1)]: page([C1], true, "c1") }).http)).toBe(true);
  });
  it("is signed out on a 401, a 403 or a redirect", async () => {
    expect(await poe.detect(open({ "POST /api/gql_POST": { $status: 403 } }).http)).toBe(false);
    expect(await poe.detect(raw(async () => Response.redirect("https://poe.com/login", 302)))).toBe(false);
  });
});

describe("poe list", () => {
  it("pages by the Relay end cursor until hasNextPage is false", async () => {
    const f = open({ [list(null)]: page([C1], true, "c1"), [list("c1")]: page([C2], false, "c2") });
    const first = await poe.listConversations(f.http);
    expect(first).toEqual({ items: [{ id: C1, title: `t ${C1}`, updatedAt: expect.any(String) }], next: "c1" });
    const second = await poe.listConversations(f.http, first.next);
    expect([second.items.map((s) => s.id), second.next]).toEqual([[C2], undefined]);
  });
  it("gives every stub the time of the capture, so each chat is read again: the list has no time", async () => {
    const before = new Date().toISOString();
    const [s] = (await poe.listConversations(open().http)).items;
    expect(s!.updatedAt >= before).toBe(true);
  });
  it("P1 names the field when the list shape changed", async () => {
    expect(await code(poe.listConversations(open({ [list(null)]: { data: { chatList: [] } } }).http))).toMatch(/^provider-schema: poe: data.chats is not an object/);
    expect(await code(poe.listConversations(open({ [list(null)]: { data: { chats: { edges: [{ node: { id: 7 } }], pageInfo: { hasNextPage: false, endCursor: null } } } } }).http))).toMatch(/^provider-schema: poe: chats.edges\[0\].node.id is not text/);
  });
  it("gives provider-schema when the persisted hash has changed (GraphQL errors, no data)", async () => {
    const drift = { data: null, errors: [{ message: "PersistedQueryNotFound <script>" }] };
    expect(await code(poe.listConversations(open({ [list(null)]: drift }).http))).toMatch(/^provider-schema: poe: ChatHistoryListPaginationQuery answered GraphQL errors/);
  });
  it("throws rate-limited with Retry-After on a 429", async () => {
    const error = await poe.listConversations(raw(async () => new Response("{}", { status: 429, headers: { "retry-after": "10" } }))).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "rate-limited", retryAfter: 10 });
  });
  it("ends in pagination-loop when the list gives the same cursor again", async () => {
    const loop = page([C1], true, "same");
    const http: Http = { get: async () => ({}), post: async (_, body) => ((body.variables as { cursor: unknown }).cursor === null ? loop : page([C2], true, "same")) };
    const cp = await runCapture({ adapter: { ...poe, detect: async () => true, getConversation: async (_, s) => ({ provider: "poe", id: s.id, title: s.title, createdAt: s.updatedAt, updatedAt: s.updatedAt, messages: [] }) }, http, sink: { put: go, checkpoint: go, keep: go }, stamps: {}, delayMs: 0, sleep: async () => undefined });
    expect([cp.status, cp.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
  it("throws too-large on a list answer over the size limit", async () => {
    expect(await code(poe.listConversations(raw(async () => new Response("{}", { headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }))))).toMatch(/^too-large: /);
  });
});

describe("poe conversations", () => {
  it("reads a chat that passes the foxcache/v1 check, with times from epoch microseconds (P4)", async () => {
    const f = open();
    const c = await poe.getConversation(f.http, stub(C1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "poe", id: C1, title: "Lisbon in three days", createdAt: "2025-10-01T10:00:00.000Z", updatedAt: "2025-10-01T10:00:05.123Z", model: "assistant" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Plan three days in Lisbon", "2025-10-01T10:00:00.000Z"],
      ["assistant", "Day 1: Alfama and the castle.", "2025-10-01T10:00:05.123Z"],
    ]);
  });
  it("pages older messages back by startCursor and keeps the order oldest first", async () => {
    const routes = {
      [messages(C1, null)]: chat(C1, [msg(3, "human", "third", 3e15), msg(4, "gpt4_o", "fourth", 4e15)], { hasNextPage: true, startCursor: "s3" }),
      [messages(C1, "s3")]: chat(C1, [msg(1, "human", "first", 1e15), msg(2, "gpt4_o", "second", 2e15)]),
    };
    const c = await poe.getConversation(open(routes).http, stub(C1));
    expect([c.messages.map((m) => m.text), c.model]).toEqual([["first", "second", "third", "fourth"], "gpt4_o"]);
  });
  it("ends in pagination-loop when the message pages repeat a cursor", async () => {
    const routes = { [messages(C1, null)]: chat(C1, [msg(3, "human", "x", 3e15)], { hasNextPage: true, startCursor: "s3" }), [messages(C1, "s3")]: chat(C1, [msg(2, "human", "y", 2e15)], { hasNextPage: true, startCursor: "s3" }) };
    expect(await code(poe.getConversation(open(routes).http, stub(C1)))).toMatch(/^provider-schema: poe: .*startCursor came again/);
  });
  it("keeps hostile text as text", async () => {
    const hostile = `<img src=x onerror="document.title='owned'"><script>alert(1)</script>`;
    const c: Conversation = await poe.getConversation(open({ [messages(C2, null)]: chat(C2, [msg(1, "human", hostile, 1e15)]) }).http, stub(C2, "<b>t</b>"));
    expect([check("conversations", c).messages[0]!.text, c.title]).toEqual([hostile, "<b>t</b>"]);
  });
  it("P1 names the field when a message changed, and refuses a chat with no messages", async () => {
    expect(await code(poe.getConversation(open({ [messages(C1, null)]: chat(C1, [msg(1, "human", "x", "soon" as unknown as number)]) }).http, stub(C1)))).toMatch(/^provider-schema: poe: messages\[0\].creationTime is not a number/);
    expect(await code(poe.getConversation(open({ [messages(C1, null)]: chat(C1, [{ node: { author: "human", creationTime: 1e15 } }]) }).http, stub(C1)))).toMatch(/^provider-schema: poe: messages\[0\].text is not text/);
    expect(await code(poe.getConversation(open({ [messages(C1, null)]: chat(C1, []) }).http, stub(C1)))).toMatch(/^not-found: poe: chat .* has no messages/);
  });
  it("PO40 goes on past three empty chats in a row", async () => {
    const empty = ["RTE=", "RTI=", "RTM="];
    const routes = { ...fixture("poe"), [list(null)]: page([...empty, C1], false, "e"), ...Object.fromEntries(empty.map((id) => [messages(id, null), chat(id, [])])) };
    const cp = await runCapture({ adapter: poe, http: open(routes).http, sink: { put: go, checkpoint: go, keep: go }, stamps: {}, delayMs: 0 });
    expect([cp.status, cp.counts.conversations, cp.counts.errors]).toEqual(["done", 1, 3]);
  });
  it("throws too-large on a chat answer that streams past the size limit", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) });
    expect(await code(poe.getConversation(raw(async () => new Response(body)), stub(C1)))).toMatch(/^too-large: /);
  });
});
