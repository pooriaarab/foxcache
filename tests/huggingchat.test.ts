import { describe, expect, it } from "vitest";
import { check, createHttp } from "../src/index.js";
import { huggingchat } from "../src/adapters/huggingchat.js";
import { captureAll, code, hugeFetch } from "./adapter-kit.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const H1 = "6710aa00000000000000a001";
const H2 = "6710aa00000000000000a002";
const H3 = "6710aa00000000000000a003";
const open = (routes: Routes = fixture("huggingchat")) => fixtureHttp(huggingchat, routes);
const swap = (key: string, body: unknown) => ({ ...fixture("huggingchat"), [key]: body });
const stub = (id: string) => ({ id, title: "", updatedAt: "" });
const ONE = `/chat/api/v2/conversations/${H1}`;
type Conv = { json: { messages: Array<Record<string, unknown>> } };
const h1 = () => structuredClone(fixture("huggingchat")[ONE]) as Conv;

describe("huggingchat detect", () => {
  it("is signed in when the user answer has a user", async () => {
    expect(await huggingchat.detect(open().http)).toBe(true);
  });
  it("is signed out when the user is null, or on a 401", async () => {
    expect(await huggingchat.detect(open(swap("/chat/api/v2/user", { json: null })).http)).toBe(false);
    expect(await huggingchat.detect(open(swap("/chat/api/v2/user", { $status: 401 })).http)).toBe(false);
  });
  it("throws provider-schema when the answer is not superjson", async () => {
    expect(await code(huggingchat.detect(open(swap("/chat/api/v2/user", { id: "x" })).http))).toMatch(/^provider-schema: huggingchat: .*not a superjson answer/);
  });
});

describe("huggingchat list", () => {
  it("pages p from 0 while hasMore", async () => {
    const f = open();
    const first = await huggingchat.listConversations(f.http);
    expect(first.items).toEqual([{ id: H1, title: "Lisbon pastry", updatedAt: "2026-08-06T07:08:10.000Z" }, { id: H2, title: "<b>Hostile</b> title", updatedAt: "2026-07-25T17:00:02.000Z" }]);
    const second = await huggingchat.listConversations(f.http, first.next);
    expect([second.items.map((s) => s.id), second.next]).toEqual([[H3], undefined]);
  });
  it("throws provider-schema on schema drift and rate-limited on a 429", async () => {
    const key = `/chat/api/v2/conversations?p=0`;
    expect(await code(huggingchat.listConversations(open(swap(key, { json: { conversations: [] } })).http))).toMatch(/^provider-schema: huggingchat: conversations.hasMore/);
    expect(await code(huggingchat.listConversations(open(swap(key, { $status: 429 })).http))).toMatch(/^rate-limited: /);
  });
  it("ends a capture with pagination-loop when a page comes again", async () => {
    const routes = fixture("huggingchat");
    const key = `/chat/api/v2/conversations?p=`;
    const { checkpoint } = await captureAll(huggingchat, open({ ...routes, [`${key}1`]: routes[`${key}0`] }).http);
    expect([checkpoint.status, checkpoint.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
});

describe("huggingchat conversations", () => {
  it("shows the thread the site shows: the last message, its ancestors and its last children (P4, P5)", async () => {
    const c = await huggingchat.getConversation(open().http, stub(H1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "huggingchat", id: H1, title: "Lisbon pastry", model: "omni", createdAt: "2026-08-06T07:06:41.000Z", updatedAt: "2026-08-06T07:08:10.000Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([["user", "Best pastry in Lisbon?"], ["assistant", "Pastel de nata in Belem."], ["user", "And coffee?"], ["assistant", "A bica."]]);
    expect(c.messages[0]!.attachments).toEqual([{ name: "menu.jpg", mimeType: "image/jpeg" }]);
    expect(JSON.stringify(c)).not.toMatch(/aGVsbG8|not kept/);
  });
  it("keeps a system prompt and hostile text as text, and reads an empty chat", async () => {
    const h = await huggingchat.getConversation(open().http, stub(H2));
    expect(h.messages.map((m) => [m.role, m.text])).toEqual([["system", "Answer as a pirate."], ["user", "<img src=x onerror=\"document.title='pwned'\">"], ["assistant", "[x](javascript:alert(1))"]]);
    expect(await huggingchat.getConversation(open().http, stub(H3))).toMatchObject({ messages: [], createdAt: "2026-07-01T00:00:00.000Z" });
  });
  it("throws provider-schema on a missing ancestor, a child cycle or an unknown role (P7)", async () => {
    const gap = h1();
    gap.json.messages.at(-1)!.ancestors = ["nope"];
    expect(await code(huggingchat.getConversation(open(swap(ONE, gap)).http, stub(H1)))).toMatch(/ancestors\[0\] names nope, which is not in the conversation/);
    const loop = h1();
    loop.json.messages.at(-1)!.children = [loop.json.messages[1]!.id];
    expect(await code(huggingchat.getConversation(open(swap(ONE, loop)).http, stub(H1)))).toMatch(/is in a child cycle/);
    const role = h1();
    role.json.messages[1]!.from = "tool";
    expect(await code(huggingchat.getConversation(open(swap(ONE, role)).http, stub(H1)))).toMatch(/^provider-schema: huggingchat: .*from is "tool"/);
  });
  it("refuses an id that is not an ObjectId before any request: a 7-character id is a shared link", async () => {
    const f = open();
    expect(await code(huggingchat.getConversation(f.http, stub("abc1234")))).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
  it("never sends the settings GET, which can write the active model back", async () => {
    const f = open();
    expect(await code(f.http.get("/chat/api/v2/user/settings"))).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
  it("throws too-large on a huge answer", async () => {
    expect(await code(huggingchat.getConversation(createHttp(huggingchat, { fetch: hugeFetch, storage: { getItem: () => null }, scripts: () => [], call: () => undefined }), stub(H1)))).toMatch(/^too-large: /);
  });
});
