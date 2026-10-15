// docs/providers/grok.md: GR1-GR7, through the adapter's own reads.
import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_MESSAGES, check } from "../src/index.js";
import { grok } from "../src/adapters/grok.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const G1 = "6b0c0000-0000-4000-8000-000000000001";
const G2 = "6b0c0000-0000-4000-8000-000000000002";
const LIST = "/rest/app-chat/conversations?pageSize=60";
const NODES = (id: string) => `/rest/app-chat/conversations/${id}/response-node?includeThreads=true`;
const LOAD = (id: string) => `POST /rest/app-chat/conversations/${id}/load-responses`;
const open = (routes = fixture("grok")) => fixtureHttp(grok, routes);
const stub = (id: string) => ({ id, title: "", updatedAt: "" });
const node = (responseId: string, sender: string, parentResponseId?: string) => ({ responseId, sender, ...(parentResponseId ? { parentResponseId } : {}) });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("grok detect", () => {
  it("is signed in when the list answers", async () => {
    expect(await grok.detect(open().http)).toBe(true);
  });
  it("GR2 is signed out on a 401 or a 403", async () => {
    expect(await grok.detect(open({ "/rest/app-chat/conversations?pageSize=1": { $status: 401 } }).http)).toBe(false);
    expect(await grok.detect(open({ "/rest/app-chat/conversations?pageSize=1": { $status: 403 } }).http)).toBe(false);
  });
  it("GR1 throws provider-schema when the list has no conversations", async () => {
    expect(await code(grok.detect(open({ "/rest/app-chat/conversations?pageSize=1": { items: [] } }).http))).toMatch(/^provider-schema: grok: .*conversations/);
  });
});

describe("grok list", () => {
  it("pages by nextPageToken and ends when it is gone", async () => {
    const f = open();
    const first = await grok.listConversations(f.http);
    expect(first).toEqual({ items: [{ id: G1, title: "Porto weekend", updatedAt: "2026-09-02T08:00:00.000Z" }], next: "tok-2" });
    const second = await grok.listConversations(f.http, first.next);
    expect(second).toEqual({ items: [{ id: G2, title: "<img src=x onerror=alert(1)>", updatedAt: "2026-08-01T09:05:00.000Z" }], next: undefined });
    expect(f.calls).toEqual([LIST, `${LIST}&pageToken=tok-2`]);
  });
  it("GR40 pages past an empty page that still has a token", async () => {
    const f = open({ ...fixture("grok"), [LIST]: { conversations: [], nextPageToken: "tok-2" } });
    const first = await grok.listConversations(f.http);
    expect(first).toEqual({ items: [], next: "tok-2" });
    expect((await grok.listConversations(f.http, first.next)).items.map((s) => s.id)).toEqual([G2]);
  });
  it("GR1 names the field when a row changed", async () => {
    const routes = { [LIST]: { conversations: [{ id: G1, title: "x", modifyTime: "2026-09-02T08:00:00Z" }] } };
    expect(await code(grok.listConversations(open(routes).http))).toMatch(/^provider-schema: grok: conversations\[0\].conversationId is not text/);
  });
  it("GR3 passes a 429 on as rate-limited", async () => {
    expect(await code(grok.listConversations(open({ [LIST]: { $status: 429 } }).http))).toMatch(/^rate-limited: /);
  });
  it("GR4 throws pagination-loop when the token comes back", async () => {
    const routes = { [`${LIST}&pageToken=tok-2`]: { conversations: [], nextPageToken: "tok-2" } };
    expect(await code(grok.listConversations(open(routes).http, "tok-2"))).toMatch(/^pagination-loop: grok: /);
  });
});

describe("grok conversations", () => {
  it("keeps the branch of the newest response, with the model of the last answer", async () => {
    const f = open();
    const c = await grok.getConversation(f.http, stub(G1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "grok", id: G1, title: "Porto weekend", createdAt: "2026-09-01T10:00:00.123Z", updatedAt: "2026-09-02T08:00:00.000Z", model: "grok-4" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Plan a weekend in Porto", "2026-09-01T10:00:01.000Z"],
      ["assistant", "Day 1: Ribeira. Day 2: Serralves.", "2026-09-02T07:59:58.250Z"],
    ]);
    expect(f.calls.filter((k) => k.startsWith("POST"))).toEqual([LOAD(G1)]);
  });
  it("GR7 keeps hostile text as text", async () => {
    const c = await grok.getConversation(open().http, stub(G2));
    expect([c.title, c.messages[0]!.text]).toEqual(["<img src=x onerror=alert(1)>", "<script>alert(1)</script>"]);
  });
  it("asks load-responses for 50 ids at a time", async () => {
    const nodes = Array.from({ length: 120 }, (_, i) => node(`n${i}`, i % 2 ? "assistant" : "human", i ? `n${i - 1}` : undefined));
    const body = (from: number, to: number) => JSON.stringify({ responseIds: nodes.slice(from, to).map((n) => n.responseId) });
    const reply = (from: number, to: number) => ({ responses: nodes.slice(from, to).map((n, i) => ({ responseId: n.responseId, sender: n.sender, message: `m${from + i}`, createTime: new Date(Date.UTC(2026, 8, 1, 0, 0, from + i)).toISOString() })) });
    const routes = { ...fixture("grok"), [NODES(G1)]: { responseNodes: nodes }, [`${LOAD(G1)} ${body(0, 50)}`]: reply(0, 50), [`${LOAD(G1)} ${body(50, 100)}`]: reply(50, 100), [`${LOAD(G1)} ${body(100, 120)}`]: reply(100, 120) };
    const c = await grok.getConversation(open(routes).http, stub(G1));
    expect([c.messages.length, c.messages[0]!.text, c.messages[119]!.text]).toEqual([120, "m0", "m119"]);
  });
  it("GR5 throws too-large before it loads a chat with too many responses", async () => {
    const nodes = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => node(`n${i}`, "human"));
    const f = open({ ...fixture("grok"), [NODES(G1)]: { responseNodes: nodes } });
    expect(await code(grok.getConversation(f.http, stub(G1)))).toMatch(/^too-large: grok: /);
    expect(f.calls.some((k) => k.startsWith("POST"))).toBe(false);
  });
  it("GR6 throws provider-schema when a response in the tree has no body", async () => {
    const routes = { ...fixture("grok"), [LOAD(G1)]: { responses: [{ responseId: "r3", sender: "assistant", createTime: "2026-09-02T07:59:58Z", message: "x" }] } };
    expect(await code(grok.getConversation(open(routes).http, stub(G1)))).toMatch(/^provider-schema: grok: response r[12] is in the tree, but load-responses did not send it/);
  });
  it("GR6 throws provider-schema on a parent that is not in the tree, and on a cycle (P7)", async () => {
    const gap = { ...fixture("grok"), [NODES(G1)]: { responseNodes: [node("r1", "human"), node("r3", "assistant", "r9")] } };
    expect(await code(grok.getConversation(open(gap).http, stub(G1)))).toMatch(/^provider-schema: grok: message r3 has the parent r9, which is not in the conversation/);
    const cycle = { ...fixture("grok"), [NODES(G1)]: { responseNodes: [node("r1", "human", "r3"), node("r3", "assistant", "r1")] } };
    expect(await code(grok.getConversation(open(cycle).http, stub(G1)))).toMatch(/^provider-schema: grok: message .* is in a parent cycle/);
  });
  it("GR1 throws provider-schema on a sender it does not know", async () => {
    const routes = fixture("grok");
    const bad = structuredClone(routes[LOAD(G2)]) as { responses: Array<{ sender: string }> };
    bad.responses[1]!.sender = "robot";
    expect(await code(grok.getConversation(open({ ...routes, [LOAD(G2)]: bad }).http, stub(G2)))).toMatch(/^provider-schema: grok: response h2.sender is "robot"/);
  });
  it("reads an empty chat with no load-responses call", async () => {
    const f = open({ ...fixture("grok"), [NODES(G2)]: { responseNodes: [] } });
    expect((await grok.getConversation(f.http, stub(G2))).messages).toEqual([]);
    expect(f.calls.some((k) => k.startsWith("POST"))).toBe(false);
  });
});
