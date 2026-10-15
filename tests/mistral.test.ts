import { describe, expect, it } from "vitest";
import { FoxcacheError, type Http, MAX_MESSAGES, check, mistral } from "../src/index.js";
import { MAX_SUBPAGES } from "../src/adapters/read.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const ORIGIN = "https://chat.mistral.ai";
const C1 = "0b6f0000-0000-4000-8000-000000000001";
const C2 = "0b6f0000-0000-4000-8000-000000000002";
const SESSION = '/api/trpc/user.session?batch=1&input={"0":{"json":{}}}';
const LIST = '/api/trpc/chat.last?batch=1&input={"0":{"json":{}}}';
const open = (routes = fixture("mistral")) => fixtureHttp(ORIGIN, routes);
const stub = (id: string) => ({ id, title: "", updatedAt: "" });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("mistral detect", () => {
  it("is signed in when the session has a user", async () => {
    expect(await mistral.detect(open().http)).toBe(true);
  });
  it("is signed out on a 401, a tRPC UNAUTHORIZED, or a session with no user", async () => {
    expect(await mistral.detect(open({ [SESSION]: { $status: 401 } }).http)).toBe(false);
    expect(await mistral.detect(open({ [SESSION]: [{ error: { json: { message: "no", data: { code: "UNAUTHORIZED", httpStatus: 401 } } } }] }).http)).toBe(false);
    expect(await mistral.detect(open({ [SESSION]: [{ result: { data: { json: { user: null } } } }] }).http)).toBe(false);
  });
  it("throws provider-error on another tRPC error", async () => {
    expect(await code(mistral.detect(open({ [SESSION]: [{ error: { json: { message: "boom", data: { code: "INTERNAL_SERVER_ERROR" } } } }] }).http))).toMatch(/^provider-error: mistral: .*boom/);
  });
});

describe("mistral list", () => {
  it("pages by cursor and uses the title the user sees", async () => {
    const f = open();
    const first = await mistral.listConversations(f.http);
    expect(first).toEqual({ items: [{ id: C1, title: "Kyoto in autumn", updatedAt: "2026-09-01T10:05:00.000Z" }], next: "cursor-2" });
    const second = await mistral.listConversations(f.http, first.next);
    expect(second).toEqual({ items: [{ id: C2, title: "My own title", updatedAt: "2026-08-01T10:05:00.000Z" }], next: undefined });
  });
  it("throws provider-schema when the answer is not a tRPC batch", async () => {
    expect(await code(mistral.listConversations(open({ [LIST]: { items: [] } }).http))).toMatch(/^provider-schema: mistral: chat.last/);
  });
});

describe("mistral conversations", () => {
  it("follows the message cursor and keeps the latest version of each turn", async () => {
    const f = open();
    const c = await mistral.getConversation(f.http, stub(C1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "mistral", id: C1, title: "Kyoto in autumn", model: "mistral-medium-latest", createdAt: "2026-09-01T10:00:00.000Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Kyoto in autumn?"],
      ["assistant", "Go in November. The maples turn red."],
      ["user", "Thanks!"],
    ]);
    expect(f.calls).toHaveLength(2);
  });
  it("keeps the project id and hostile text as text", async () => {
    const c = await mistral.getConversation(open().http, stub(C2));
    expect([c.projectId, c.title, c.messages[0]!.text]).toEqual(["proj-1", "My own title", "<script>alert(1)</script>"]);
  });
  it("throws provider-schema on an unknown role", async () => {
    const routes = fixture("mistral");
    const key = Object.keys(routes).find((k) => k.includes(`"id":"${C2}"`))!;
    const bad = structuredClone(routes[key]) as Array<{ result: { data: { json: { items: Array<{ role: string }> } } } }>;
    bad[1]!.result.data.json.items[0]!.role = "robot";
    expect(await code(mistral.getConversation(open({ ...routes, [key]: bad }).http, stub(C2)))).toMatch(/^provider-schema: mistral: .*role/);
  });
  it("throws provider-schema when a message has no turn, and does not reorder the thread", async () => {
    const routes = fixture("mistral");
    const key = Object.keys(routes).find((k) => k.includes(`"id":"${C2}"`))!;
    const bad = structuredClone(routes[key]) as Array<{ result: { data: { json: { items: Array<Record<string, unknown>> } } } }>;
    bad[1]!.result.data.json.items = ["user", "assistant", "user", "assistant"].map((role, i) => ({ id: `t${i}`, role, content: `${role} ${i}`, createdAt: `2026-08-01T10:0${i}:00Z`, nextVersion: null }));
    expect(await code(mistral.getConversation(open({ ...routes, [key]: bad }).http, stub(C2)))).toMatch(/^provider-schema: mistral: message t0.turn is not a number/);
  });
});

const ok = (json: unknown) => ({ result: { data: { json } } });
/** Le Chat for one chat: each message.all page has size rows and a new cursor. */
function endless(size: number) {
  let calls = 0;
  const page = () => ok({ items: Array.from({ length: size }, (_, i) => ({ id: `m${calls}-${i}`, role: "user", content: "hi", createdAt: "2026-08-01T10:00:00Z", turn: i })), nextCursor: `c${calls}` });
  const http: Http = {
    async get(path) {
      calls += 1;
      if (path === "/api/trpc/chat.byId,message.all") return [ok({ id: C1, createdAt: "2026-08-01T10:00:00Z", updatedAt: "2026-08-01T10:00:00Z" }), page()];
      return [page()];
    },
  };
  return { http, calls: () => calls };
}

describe("mistral message pages (P9)", () => {
  it("throws pagination-loop when message.all never ends", async () => {
    const f = endless(0);
    expect(await code(mistral.getConversation(f.http, stub(C1)))).toMatch(/^pagination-loop: mistral: message.all did not end after 1000 pages/);
    expect(f.calls()).toBe(MAX_SUBPAGES);
  });
  it("throws too-large while it reads, once the chat passes the message limit", async () => {
    const f = endless(1000);
    expect(await code(mistral.getConversation(f.http, stub(C1)))).toMatch(/^too-large: /);
    expect(f.calls()).toBe(MAX_MESSAGES / 1000 + 1);
  });
});
