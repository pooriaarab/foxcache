import { describe, expect, it } from "vitest";
import { FoxcacheError, type Http, MAX_RESPONSE_BYTES, check, chatgpt, createHttp, runCapture } from "../src/index.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const T1 = "task_e_0000000000000000000000000000c0d1";
const T2 = "task_e_0000000000000000000000000000c0d2";
const LIST = "/backend-api/wham/tasks/list?limit=20&task_filter=current";
const CODEX = JSON.stringify({ src: "codex" });
const open = (routes: Routes = fixture("chatgpt")) => fixtureHttp(chatgpt, routes);
const stub = (id: string, updatedAt = "2026-09-20T11:26:40.500Z") => ({ id, title: "", updatedAt });
const go = async () => ({ stop: false });
const listWith = (body: unknown) => chatgpt.listConversations(open({ ...fixture("chatgpt"), [LIST]: body }).http, CODEX);
/** A ChatGPT Http whose token comes from the session and whose fetch is fetch. */
const withFetch = (fetch: (url: string) => Promise<Response>) =>
  createHttp(chatgpt, { storage: { getItem: () => null }, cookie: () => "", scripts: () => [], call: () => undefined, fetch: async (url) => (url.endsWith("/api/auth/session") ? Response.json({ accessToken: "synthetic-token" }) : fetch(url)) });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("codex task list", () => {
  it("comes after the projects, pages by cursor and ends with no cursor", async () => {
    const f = open();
    const first = await chatgpt.listConversations(f.http, CODEX);
    expect(first.items).toEqual([{ id: T1, title: "Fix flaky upload test", updatedAt: "2026-09-20T11:26:40.500Z" }]);
    const second = await chatgpt.listConversations(f.http, first.next);
    // A task with no updated_at has its created_at, as the Codex CLI reads it.
    expect(second).toEqual({ items: [{ id: T2, title: "Add retry to uploader", updatedAt: "2026-09-19T06:40:00.000Z" }], next: undefined });
    expect(f.calls.filter((c) => c.startsWith("/backend-api/wham/"))).toEqual([LIST, `${LIST}&cursor=c2`]);
  });
  it("calls only its two reads, the list first", async () => {
    const f = open();
    for (const s of (await chatgpt.listConversations(f.http, CODEX)).items) await chatgpt.getConversation(f.http, s);
    const shapes = f.calls.filter((c) => c.startsWith("/backend-api/wham/")).map((c) => c.split("?")[0]!.replace(/task_[A-Za-z0-9_-]+$/, "{taskId}"));
    expect([...new Set(shapes)].toSorted()).toEqual(["/backend-api/wham/tasks/list", "/backend-api/wham/tasks/{taskId}"]);
    expect(chatgpt.reads.filter((r) => r.path.startsWith("/backend-api/wham/")).map((r) => r.path)).toEqual(["/backend-api/wham/tasks/list", "/backend-api/wham/tasks/{taskId}"]);
  });
  it("has no tasks for an account with no Codex (403 or 404 on the list)", async () => {
    for (const status of [403, 404]) expect(await chatgpt.listConversations(open({ ...fixture("chatgpt"), [LIST]: { $status: status } }).http, CODEX)).toEqual({ items: [] });
  });
  it("throws logged-out on a 401 that a new token does not fix", async () => {
    expect(await code(chatgpt.listConversations(open({ ...fixture("chatgpt"), [LIST]: { $status: 401 } }).http, CODEX))).toMatch(/^logged-out: /);
  });
  it("throws rate-limited with Retry-After on a 429", async () => {
    const http = withFetch(async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } }));
    expect(await chatgpt.listConversations(http, CODEX).catch((e: unknown) => e)).toMatchObject({ code: "rate-limited", retryAfter: 30 });
  });
  it("throws provider-schema on a changed list: no items, no time, or an id that is not a task (P1)", async () => {
    expect(await code(listWith({ tasks: [] }))).toMatch(/^provider-schema: chatgpt codex: tasks\/list.items is not a list/);
    expect(await code(listWith({ items: [{ id: T1, title: "x" }] }))).toMatch(/^provider-schema: chatgpt codex: tasks\/list.items\[0\].updated_at/);
    expect(await code(listWith({ items: [{ id: "6710aa00-1111-4222-8333-444455556666", title: "x", created_at: 1 }] }))).toMatch(/not a task_ id/);
  });
  it("ends in pagination-loop when the list gives the same cursor again", async () => {
    const page = { items: [{ id: T1, title: "x", created_at: 1 }], cursor: "same" };
    const http: Http = { get: async (path) => (path === "/backend-api/wham/tasks/list" ? page : { task: { id: T1, title: "x" } }), post: async () => Promise.reject(new Error("codex has no POST read")) };
    const cp = await runCapture({ adapter: { ...chatgpt, detect: async () => true, projects: undefined, memories: undefined, preferences: undefined }, http, sink: { put: go, checkpoint: go, keep: go }, stamps: {}, delayMs: 0, sleep: async () => undefined, resume: { provider: "chatgpt", status: "stopped", startedAt: "", updatedAt: "", extrasDone: true, pages: 0, counts: { conversations: 0, skipped: 0, errors: 0, projects: 0, memories: 0, preferences: 0, library: 0 }, lastErrors: [], cursor: CODEX } });
    expect([cp.status, cp.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
  it("throws too-large on a list answer over the size limit", async () => {
    const http = withFetch(async () => new Response("{}", { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }));
    expect(await code(chatgpt.listConversations(http, CODEX))).toMatch(/^too-large: /);
  });
});

describe("codex task", () => {
  it("keeps the prompt and the reply text, without diffs, tool log or other parts", async () => {
    const c = await chatgpt.getConversation(open().http, stub(T1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "chatgpt", id: T1, title: "Fix flaky upload test", createdAt: "2026-09-20T10:26:40.250Z", updatedAt: "2026-09-20T11:26:40.500Z" });
    expect(c.messages).toEqual([
      { role: "user", text: "The upload test fails one run in ten.\n\nFind out why.", createdAt: "2026-09-20T10:26:40.500Z", attachments: [] },
      { role: "assistant", text: "The test raced the timer; it now waits for the upload event.\n\nAll 40 tests pass.", attachments: [] },
    ]);
  });
  it("reads plain string parts, and a task with no created_at or diff turn", async () => {
    const c = await chatgpt.getConversation(open().http, stub(T2, "2026-09-19T06:40:00.000Z"));
    expect(c.createdAt).toBe("2026-09-19T06:40:00.000Z");
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Add a retry with backoff to the uploader."],
      ["assistant", "Added three retries with backoff."],
    ]);
  });
  it("keeps hostile text as text", async () => {
    const hostile = `<img src=x onerror="document.title='owned'"><script>alert(1)</script>`;
    const routes = { ...fixture("chatgpt"), [`/backend-api/wham/tasks/${T2}`]: { task: { id: T2, title: hostile }, current_user_turn: { input_items: [{ type: "message", content: [hostile] }] } } };
    const c = check("conversations", await chatgpt.getConversation(open(routes).http, stub(T2)));
    expect([c.title, c.messages[0]!.text]).toEqual([hostile, hostile]);
  });
  it("sends no request for a task id that would leave the task path", async () => {
    const f = open();
    expect(await code(chatgpt.getConversation(f.http, stub("task_../../conversations")))).toMatch(/^not-allowed: /);
    expect(f.calls.filter((c) => c.startsWith("/backend-api/"))).toEqual([]);
  });
  it("throws provider-schema when task is missing or content is not a list (P1)", async () => {
    const at = (body: unknown) => chatgpt.getConversation(open({ ...fixture("chatgpt"), [`/backend-api/wham/tasks/${T2}`]: body }).http, stub(T2));
    expect(await code(at({ current_user_turn: null }))).toMatch(/^provider-schema: chatgpt codex: task .*\.task is not an object/);
    expect(await code(at({ task: { id: T2, title: "x" }, current_user_turn: { input_items: [{ type: "message", content: "text" }] } }))).toMatch(/content is not a list/);
  });
  it("throws too-large on a task answer that streams past the size limit", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const http = withFetch(async () => new Response(new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) }), { status: 200 }));
    expect(await code(chatgpt.getConversation(http, stub(T1)))).toMatch(/^too-large: /);
  });
});
