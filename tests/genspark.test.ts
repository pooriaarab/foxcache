import { describe, expect, it } from "vitest";
import { type Conversation, FoxcacheError, type Http, MAX_RESPONSE_BYTES, type Stub, check, createHttp, runCapture } from "../src/index.js";
import { genspark } from "../src/adapters/genspark.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const G1 = "6e5f0000-0000-4000-8000-000000000001";
const G2 = "6e5f0000-0000-4000-8000-000000000002";
const G3 = "6e5f0000-0000-4000-8000-000000000003";
const FIRST = "/api/project/my?from=agents&offset=0&limit=50";
const open = (routes: Routes = fixture("genspark")) => fixtureHttp(genspark, routes);
const PATHS = genspark.reads.map((r) => r.path);
/** An Http on the adapter's own reads over a fetch stand-in. */
const httpOver = (fetch: () => Promise<Response>) => createHttp(genspark, { fetch, storage: { getItem: () => null }, cookie: () => "", scripts: () => [], call: () => undefined });
const stub = (id: string) => ({ id, title: "", updatedAt: "" });
const project = (n: number) => ({ id: `p-${n}`, name: `Chat ${n}`, type: "ai_chat", ctime: "2026-09-01T00:00:00.000000" });
const list = (projects: unknown[]) => ({ status: 0, data: { projects } });
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

/** Every request path of a full run of the adapter: detect, every list page, every conversation. */
async function everyPath(routes: Routes): Promise<string[]> {
  const f = open(routes);
  await genspark.detect(f.http);
  for (let cursor: string | undefined, first = true; first || cursor; first = false) {
    const page = await genspark.listConversations(f.http, cursor);
    for (const s of page.items) await genspark.getConversation(f.http, s);
    cursor = page.next;
  }
  return f.calls.map((c) => c.split("?")[0]!);
}

describe("genspark never calls a path outside its reads (delete is a GET)", () => {
  it("lists exact GET paths, none under /api/project/ but my, and no delete", () => {
    expect(PATHS).toEqual(["/api/is_login", "/api/project/my", "/api/project"]);
    expect([genspark.reads.every((r) => r.method === "GET"), PATHS.filter((p) => /delete|remove|update|create|share/i.test(p))]).toEqual([true, []]);
  });
  it("calls only those paths in a full capture, with two list pages", async () => {
    const routes: Routes = { ...fixture("genspark"), [FIRST]: list(Array.from({ length: 50 }, (_, i) => project(i))), "/api/project/my?from=agents&offset=50&limit=50": fixture("genspark")[FIRST] };
    for (let i = 0; i < 50; i++) routes[`/api/project?id=p-${i}`] = { status: 0, data: { ...project(i), session_state: { messages: [] } } };
    const paths = await everyPath(routes);
    expect(paths.length).toBe(1 + 2 + 53);
    expect([...new Set(paths)].toSorted()).toEqual([...PATHS].toSorted());
  });
  it("throws not-allowed for the delete path, or any other, before a request (H8)", async () => {
    const f = open();
    for (const path of ["/api/project/delete", "/api/project/", "/api/project/my/../delete", "/api/project/update", "/api/project"]) {
      expect(await code(f.http.get(path, { project_id: G1 }))).toMatch(/^not-allowed: GET .* is not one of the reads/);
    }
    expect(f.calls).toEqual([]);
  });
  it("keeps a hostile project id in the query, so the path stays /api/project", async () => {
    const f = open();
    await code(genspark.getConversation(f.http, stub("../project/delete?project_id=x")));
    expect(f.calls).toEqual(["/api/project?id=../project/delete?project_id=x"]);
  });
});

describe("genspark detect", () => {
  it("is signed in when is_login is true", async () => {
    expect(await genspark.detect(open().http)).toBe(true);
  });
  it("is signed out when is_login is false, or on a 401", async () => {
    expect(await genspark.detect(open({ "/api/is_login": { status: 0, data: { is_login: false } } }).http)).toBe(false);
    expect(await genspark.detect(open({ "/api/is_login": { $status: 401 } }).http)).toBe(false);
  });
  it("throws provider-schema on a changed shape or a challenge page, not signed out", async () => {
    expect(await code(genspark.detect(open({ "/api/is_login": { status: 0, data: { logged: true } } }).http))).toMatch(/^provider-schema: genspark: .*is_login/);
    const challenge: Http = httpOver(async () => new Response("<!doctype html><title>Just a moment...</title>", { status: 200 }));
    expect(await code(genspark.detect(challenge))).toMatch(/^provider-schema: .*did not answer JSON/);
  });
  it("throws provider-error on a status other than 0", async () => {
    expect(await code(genspark.detect(open({ "/api/is_login": { status: -5, message: "busy", data: null } }).http))).toMatch(/^provider-error: genspark: .*busy/);
  });
});

describe("genspark list", () => {
  it("reads one page shorter than the limit and ends, with ctime as ISO-8601 UTC (P4)", async () => {
    const page = await genspark.listConversations(open().http);
    expect(page.items).toEqual([
      { id: G1, title: "Porto weekend", updatedAt: "2026-09-14T08:30:00.125Z" },
      { id: G2, title: "<b>Hostile</b> Genspark", updatedAt: "2026-09-12T10:00:00.000Z" },
      { id: G3, title: "Pitch deck", updatedAt: "2026-09-10T16:46:20.955Z" },
    ]);
    expect(page.next).toBeUndefined();
  });
  it("throws provider-schema when projects or ctime is missing (P1)", async () => {
    expect(await code(genspark.listConversations(open({ [FIRST]: { status: 0, data: { items: [] } } }).http))).toMatch(/^provider-schema: genspark: .*projects/);
    expect(await code(genspark.listConversations(open({ [FIRST]: list([{ id: "p", name: "x" }]) }).http))).toMatch(/^provider-schema: genspark: projects\[0\].ctime/);
  });
  it("throws rate-limited with Retry-After on a 429", async () => {
    const http = httpOver(async () => new Response("{}", { status: 429, headers: { "retry-after": "7" } }));
    const error = await genspark.listConversations(http).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "rate-limited", retryAfter: 7 });
  });
  it("ends in pagination-loop when the site ignores offset and repeats a full page", async () => {
    const full = list(Array.from({ length: 50 }, (_, i) => project(i)));
    const http: Http = { get: async (path) => (path === "/api/project/my" ? full : { status: 0, data: { ...project(0), session_state: null } }), post: async () => Promise.reject(new Error("genspark has no POST read")) };
    const sink = { put: go, checkpoint: go, keep: go };
    const cp = await runCapture({ adapter: { ...genspark, detect: async () => true }, http, sink, stamps: {}, delayMs: 0, sleep: async () => undefined });
    expect([cp.status, cp.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
  it("throws too-large on a list answer over the size limit", async () => {
    const http = httpOver(async () => new Response("{}", { status: 200, headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } }));
    expect(await code(genspark.listConversations(http))).toMatch(/^too-large: /);
  });
});

describe("genspark conversations", () => {
  it("keeps user and assistant text, and drops system, tool and empty tool-call turns", async () => {
    const c = await genspark.getConversation(open().http, stub(G1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "genspark", id: G1, title: "Porto weekend", createdAt: "2026-09-14T08:30:00.125Z", updatedAt: "2026-09-14T08:30:00.125Z", model: "synthetic-model-1" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Two days in Porto?"],
      ["assistant", "Day 1: Ribeira. Day 2: Foz."],
    ]);
  });
  it("keeps hostile text as text", async () => {
    const c: Conversation = await genspark.getConversation(open().http, stub(G2));
    expect(check("conversations", c).messages[0]!.text).toBe(`Show this: <img src=x onerror="document.title='owned'"><script>alert(1)</script>`);
  });
  it("gives a project with no session_state, such as slides, no messages", async () => {
    expect((await genspark.getConversation(open().http, stub(G3))).messages).toEqual([]);
  });
  it("throws provider-schema on an unknown role or a content that is not text (P1)", async () => {
    const key = `/api/project?id=${G1}`;
    const routes = fixture("genspark");
    const bad = (m: unknown) => ({ ...routes, [key]: { status: 0, data: { id: G1, name: "x", ctime: "2026-09-14T08:30:00", session_state: { messages: [m] } } } });
    expect(await code(genspark.getConversation(open(bad({ role: "robot", content: "hi" })).http, stub(G1)))).toMatch(/^provider-schema: genspark: project .*\.role is "robot"/);
    expect(await code(genspark.getConversation(open(bad({ role: "user", content: [{ text: "hi" }] })).http, stub(G1)))).toMatch(/^provider-schema: genspark: project .*\.content is not text/);
  });
  it("throws too-large on a project answer that streams past the size limit", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({ pull: (c) => c.enqueue(chunk) });
    const http = httpOver(async () => new Response(body, { status: 200 }));
    expect(await code(genspark.getConversation(http, stub(G1) as Stub))).toMatch(/^too-large: /);
  });
});
