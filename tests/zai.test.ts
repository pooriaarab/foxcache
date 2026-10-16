import { describe, expect, it } from "vitest";
import { check, createHttp } from "../src/index.js";
import { zai } from "../src/adapters/zai.js";
import { captureAll, code, hugeFetch } from "./adapter-kit.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const Z1 = "2a1e0000-0000-4000-8000-000000000001";
const Z2 = "2a1e0000-0000-4000-8000-000000000002";
const Z3 = "2a1e0000-0000-4000-8000-000000000003";
const LIST = "/api/v1/chats/?page=1&type=default&include_pinned=true&include_folders=true";
const storage = { getItem: (k: string) => (k === "token" ? "synthetic-token" : null) };
const open = (routes: Routes = fixture("zai")) => fixtureHttp(zai, routes, storage);
const swap = (key: string, body: unknown) => ({ ...fixture("zai"), [key]: body });
const stub = (id: string) => ({ id, title: "", updatedAt: "" });
type Chat = { chat: { history: { messages: Record<string, Record<string, unknown>> } } };

describe("zai detect", () => {
  it("is signed in with a token and a user", async () => {
    expect(await zai.detect(open().http)).toBe(true);
  });
  it("is signed out with no token, on a 401, or with a guest token", async () => {
    expect(await zai.detect(fixtureHttp(zai, fixture("zai")).http)).toBe(false);
    expect(await zai.detect(open(swap("/api/v1/auths/", { $status: 401 })).http)).toBe(false);
    expect(await zai.detect(open(swap("/api/v1/auths/", { id: "guest-1", email: "guest@example.invalid", role: "guest" })).http)).toBe(false);
  });
  it("throws provider-schema when the user has no id", async () => {
    expect(await code(zai.detect(open(swap("/api/v1/auths/", { detail: "changed" })).http))).toMatch(/^provider-schema: zai: auths.id/);
  });
});

describe("zai deleted chat (ZAI41)", () => {
  it("passes a chat that answers 401 while the session still holds", async () => {
    const { checkpoint } = await captureAll(zai, open(swap(`/api/v1/chats/${Z1}`, { $status: 401 })).http);
    expect([checkpoint.status, checkpoint.counts.conversations, checkpoint.counts.errors]).toEqual(["done", 2, 1]);
    expect(checkpoint.lastErrors).toEqual([expect.stringMatching(new RegExp(`^${Z1}: not-found: zai: `))]);
  });
  it("ends with logged-out when the session is gone too", async () => {
    const routes = swap(`/api/v1/chats/${Z1}`, { $status: 401 });
    const f = open(routes);
    expect(await code(zai.getConversation(fixtureHttp(zai, { ...routes, "/api/v1/auths/": { $status: 401 } }, storage).http, stub(Z1)))).toMatch(/^logged-out: /);
    expect(await code(zai.getConversation(f.http, stub(Z1)))).toMatch(/^not-found: /);
  });
});

describe("zai list", () => {
  it("pages from 1 to an empty page, with pinned and folder chats asked for", async () => {
    const f = open();
    const first = await zai.listConversations(f.http);
    expect(first.items).toEqual([{ id: Z1, title: "Lisbon tram", updatedAt: "2026-08-06T07:11:40.000Z" }, { id: Z2, title: "<b>Hostile</b> title", updatedAt: "2026-07-25T17:23:20.000Z" }]);
    const second = await zai.listConversations(f.http, first.next);
    expect(second.items).toEqual([]);
  });
  it("ZAI40 reads the archived chats after the main list, to an empty page", async () => {
    const f = open();
    const ids: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await zai.listConversations(f.http, cursor);
      ids.push(page.items.map((s) => s.id));
      cursor = page.next;
    } while (cursor);
    expect(ids).toEqual([[Z1, Z2], [], [Z3], []]);
    expect(f.calls.slice(2)).toEqual(["/api/v1/chats/archived?page=1", "/api/v1/chats/archived?page=2"]);
    expect(zai.newestFirst).toBe(false);
  });
  it("throws provider-schema on schema drift and rate-limited on a 429", async () => {
    expect(await code(zai.listConversations(open(swap(LIST, { items: [] })).http))).toMatch(/^provider-schema: zai: chats is not a list/);
    expect(await code(zai.listConversations(open(swap(LIST, [{ id: Z1, title: "x", updated_at: "yesterday" }])).http))).toMatch(/^provider-schema: zai: chats\[0\].updated_at/);
    expect(await code(zai.listConversations(open(swap(LIST, { $status: 429 })).http))).toMatch(/^rate-limited: /);
  });
  it("ends a capture with pagination-loop when a page comes again", async () => {
    const routes = fixture("zai");
    const { checkpoint } = await captureAll(zai, open({ ...routes, [LIST.replace("page=1", "page=2")]: routes[LIST] }).http);
    expect([checkpoint.status, checkpoint.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
});

describe("zai conversations", () => {
  it("follows currentId to the root, without the reasoning block or file contents (P4, P5)", async () => {
    const c = await zai.getConversation(open().http, stub(Z1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "zai", id: Z1, title: "Lisbon tram", createdAt: "2026-08-06T07:06:40.000Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([["user", "Which tram goes to Belem?"], ["assistant", "Tram 15 goes to Belem."]]);
    expect(c.messages[0]!.attachments).toEqual([{ name: "map.png", id: "file-9", size: 4096 }]);
    expect(JSON.stringify(c)).not.toMatch(/not kept/);
  });
  it("keeps hostile text as text", async () => {
    const h = await zai.getConversation(open().http, stub(Z2));
    expect(h.messages.map((m) => m.text)).toEqual(["<img src=x onerror=\"document.title='pwned'\">", "<script>alert(1)</script>"]);
  });
  it("throws provider-schema on a message stub that only the batch POST would fill in", async () => {
    const key = `/api/v1/chats/${Z1}`;
    const chat = structuredClone(fixture("zai")[key]) as Chat;
    delete chat.chat.history.messages.a2!.content;
    expect(await code(zai.getConversation(open(swap(key, chat)).http, stub(Z1)))).toMatch(/^provider-schema: zai: message a2.content is missing/);
  });
  it("sends only its reads: no id that leaves the chat path, no empty id, no guest sign-in", async () => {
    const f = open();
    for (const p of [zai.getConversation(f.http, stub("../auths/")), zai.getConversation(f.http, stub("")), f.http.get("/api/v1/auths/guest")]) expect(await code(p)).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
  it("throws too-large on a huge answer", async () => {
    expect(await code(zai.getConversation(createHttp(zai, { fetch: hugeFetch, storage, scripts: () => [], call: () => undefined }), stub(Z1)))).toMatch(/^too-large: /);
  });
});

describe("zai preferences", () => {
  it("reads the system prompt, and nothing when the user never saved settings", async () => {
    expect(await zai.preferences!(open().http)).toEqual([{ provider: "zai", kind: "instructions", text: "Answer in British English." }]);
    expect(await zai.preferences!(open(swap("/api/v1/users/user/settings", null)).http)).toEqual([]);
    expect(await zai.preferences!(open(swap("/api/v1/users/user/settings", { ui: {} })).http)).toEqual([]);
  });
});
