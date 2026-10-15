import { describe, expect, it } from "vitest";
import { check, createHttp } from "../src/index.js";
import { qwen } from "../src/adapters/qwen.js";
import { captureAll, code, hugeFetch } from "./adapter-kit.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const Q1 = "7a1e0000-0000-4000-8000-000000000001";
const Q2 = "7a1e0000-0000-4000-8000-000000000002";
const Q3 = "7a1e0000-0000-4000-8000-000000000003";
const Q4 = "7a1e0000-0000-4000-8000-000000000004";
const storage = { getItem: (k: string) => (k === "token" ? "synthetic-token" : null) };
const open = (routes: Routes = fixture("qwen")) => fixtureHttp(qwen, routes, storage);
const stub = (id: string) => ({ id, title: "", updatedAt: "" });
const swap = (key: string, body: unknown) => ({ ...fixture("qwen"), [key]: body });
const fail = (data: unknown) => ({ success: false, request_id: "r", data });

describe("qwen detect and sign-in", () => {
  it("is signed in with a token and a user", async () => {
    expect(await qwen.detect(open().http)).toBe(true);
  });
  it("is signed out with no token, on a 401, or when the envelope says unauthorized with HTTP 200", async () => {
    expect(await qwen.detect(fixtureHttp(qwen, fixture("qwen")).http)).toBe(false);
    expect(await qwen.detect(open(swap("/api/v1/auths/", { $status: 401 })).http)).toBe(false);
    expect(await qwen.detect(open(swap("/api/v1/auths/", fail({ code: "Unauthorized", details: "token expired" }))).http)).toBe(false);
    expect(await code(qwen.listConversations(open(swap("/api/v2/chats/?page=1", fail({ code: "Unauthorized" }))).http))).toMatch(/^logged-out: qwen: /);
  });
  it("sends the page's source header with the bearer", async () => {
    const seen: Headers[] = [];
    const http = createHttp(qwen, { storage, scripts: () => [], call: () => undefined, fetch: async (_u, init) => (seen.push(new Headers(init.headers)), new Response("{}")) });
    await http.get("/api/v1/auths/");
    expect([seen[0]!.get("source"), seen[0]!.get("authorization")]).toEqual(["web", "Bearer synthetic-token"]);
  });
  it("sends only its reads: no other path, and no id that leaves the chat path", async () => {
    const f = open();
    for (const p of [qwen.getConversation(f.http, stub("../../v1/auths")), qwen.getConversation(f.http, stub("")), f.http.get("/api/v2/chats/x/delete")]) expect(await code(p)).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
});

describe("qwen errors (QWEN41)", () => {
  it("keeps the site's text out of a provider-error", async () => {
    const message = await code(qwen.listConversations(open(swap("/api/v2/chats/?page=1", fail({ details: "SECRET chat text" }))).http));
    expect(message).toMatch(/^provider-error: qwen: \/api\/v2\/chats\/ /);
    expect(message).not.toContain("SECRET");
  });
});

describe("qwen list", () => {
  it("reads the main list, then each project's list, each to an empty page", async () => {
    const f = open();
    const ids: string[][] = [];
    let cursor: string | undefined;
    do {
      const page = await qwen.listConversations(f.http, cursor);
      ids.push(page.items.map((s) => s.id));
      cursor = page.next;
    } while (cursor);
    expect(ids).toEqual([[Q4, Q1, Q2], [], [Q3], []]);
    expect(f.calls.filter((c) => c.startsWith("/api/v2/chats/"))).toEqual(["/api/v2/chats/pinned", "/api/v2/chats/?page=1", "/api/v2/chats/?page=2", "/api/v2/chats/?page=1&project_id=proj-7a1e-0001", "/api/v2/chats/?page=2&project_id=proj-7a1e-0001"]);
  });
  it("QWEN40 reads the pinned chats once, also when the main list holds them", async () => {
    const base = fixture("qwen");
    const apart = await captureAll(qwen, open(base).http);
    expect([apart.checkpoint.status, apart.checkpoint.counts.conversations]).toEqual(["done", 4]);
    const page1 = base["/api/v2/chats/?page=1"] as { data: unknown[] };
    const pinned = base["/api/v2/chats/pinned"] as { data: unknown[] };
    const both = await captureAll(qwen, open({ ...base, "/api/v2/chats/?page=1": { ...page1, data: [...pinned.data, ...page1.data] } }).http);
    expect([both.checkpoint.status, both.checkpoint.counts.conversations]).toEqual(["done", 4]);
    const same = await captureAll(qwen, open({ ...base, "/api/v2/chats/?page=1": pinned }).http);
    expect([same.checkpoint.status, same.checkpoint.error?.code]).toEqual(["done", undefined]);
  });
  it("throws provider-schema when the list shape drifts", async () => {
    expect(await code(qwen.listConversations(open(swap("/api/v2/chats/?page=1", { success: true, data: { chats: [] } })).http))).toMatch(/^provider-schema: qwen: chats is not a list/);
    expect(await code(qwen.listConversations(open(swap("/api/v2/chats/?page=1", { data: [] })).http))).toMatch(/^provider-schema: qwen: .*success/);
  });
  it("throws rate-limited on a 429", async () => {
    expect(await code(qwen.listConversations(open(swap("/api/v2/chats/?page=1", { $status: 429 })).http))).toMatch(/^rate-limited: /);
  });
  it("ends a capture with pagination-loop when a page comes again", async () => {
    const routes = fixture("qwen");
    const { checkpoint } = await captureAll(qwen, open({ ...routes, "/api/v2/chats/?page=2": routes["/api/v2/chats/?page=1"], "/api/v2/chats/?page=3": routes["/api/v2/chats/?page=1"] }).http);
    expect([checkpoint.status, checkpoint.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
});

describe("qwen conversations", () => {
  it("follows currentId to the root, with content_list text and file names only (P4, P5)", async () => {
    const c = await qwen.getConversation(open().http, stub(Q1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "qwen", id: Q1, title: "Lisbon trip", createdAt: "2026-08-06T07:06:40.000Z", updatedAt: "2026-08-06T07:11:40.000Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([["user", "Plan a Lisbon trip"], ["assistant", "Day 1: Alfama.\n\nDay 2: Belem."]]);
    expect(c.messages[0]!.attachments).toEqual([{ name: "budget.xlsx", id: "file-1", size: 2048 }]);
    expect(JSON.stringify(c)).not.toMatch(/presigned|thinking/);
  });
  it("keeps hostile text as text, and names the project of a project chat", async () => {
    const h = await qwen.getConversation(open().http, stub(Q2));
    expect([h.title, h.messages[0]!.text]).toEqual(["<b>Hostile</b> title", "<img src=x onerror=\"document.title='pwned'\"> and \u001b[31mred"]);
    expect((await qwen.getConversation(open().http, stub(Q3))).projectId).toBe("proj-7a1e-0001");
  });
  it("throws provider-schema when the chat has no history", async () => {
    expect(await code(qwen.getConversation(open(swap(`/api/v2/chats/${Q1}`, { success: true, data: { id: Q1, chat: {} } })).http, stub(Q1)))).toMatch(/^provider-schema: qwen: chat.chat.history/);
  });
  it("throws too-large on a huge answer, and the check refuses a chat over the message limit", async () => {
    expect(await code(qwen.getConversation(createHttp(qwen, { fetch: hugeFetch, storage, scripts: () => [], call: () => undefined }), stub(Q1)))).toMatch(/^too-large: /);
    const messages = Object.fromEntries(Array.from({ length: 20_001 }, (_, i) => [`m${i}`, { id: `m${i}`, parentId: i ? `m${i - 1}` : null, role: i % 2 ? "assistant" : "user", content: "x" }]));
    const big = { success: true, data: { id: Q1, title: "big", created_at: 1, updated_at: 2, currentId: "m20000", chat: { history: { messages } } } };
    expect(await code(qwen.getConversation(open(swap(`/api/v2/chats/${Q1}`, big)).http, stub(Q1)).then((c) => check("conversations", c)))).toMatch(/^too-large: /);
  });
});

describe("qwen projects, memories and personalization", () => {
  it("reads project names and instructions, the memory pages and the set personalization fields", async () => {
    const f = open();
    expect(await qwen.projects!(f.http)).toEqual([{ provider: "qwen", id: "proj-7a1e-0001", name: "Travel", instructions: "Answer in short lists.", files: [] }]);
    expect((await qwen.memories!(f.http)).map((m) => [m.id, m.text, m.createdAt])).toEqual([["mem-1", "Lives in Porto.", "2026-07-02T13:46:40.000Z"], ["mem-2", "Prefers trains.", "2026-07-02T13:48:20.000Z"]]);
    expect(await qwen.preferences!(f.http)).toEqual([{ provider: "qwen", kind: "name", text: "Sam" }, { provider: "qwen", kind: "instructions", text: "Be brief." }]);
    expect(await qwen.preferences!(open(swap("/api/v2/users/user/settings", { success: true, data: { personalization: null } })).http)).toEqual([]);
  });
  it("throws pagination-loop when a memory page repeats", async () => {
    const routes = fixture("qwen");
    const page = structuredClone(routes["/api/v2/memories/?page_size=50&page_num=1"]) as { data: { total: number } };
    page.data.total = 99;
    const loop = { ...routes, "/api/v2/memories/?page_size=50&page_num=1": page, "/api/v2/memories/?page_size=50&page_num=2": page };
    expect(await code(qwen.memories!(open(loop).http))).toMatch(/^pagination-loop: qwen: memories page 2/);
  });
});
