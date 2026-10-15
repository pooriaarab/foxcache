// docs/providers/github-copilot.md: GC1-GC7, through the adapter's own reads.
import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_MESSAGES, check } from "../src/index.js";
import { githubCopilot } from "../src/adapters/github-copilot.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const C1 = "5c0d0000-0000-4000-8000-000000000001";
const C2 = "5c0d0000-0000-4000-8000-000000000002";
const API = "https://api.individual.githubcopilot.com";
const TOKEN = "synthetic-copilot-token";
const LIST = "/github/chat/threads";
const THREAD = (id: string) => `/github/chat/threads/${id}/messages`;
const storage = { getItem: (k: string) => (k === "COPILOT_AUTH_TOKEN" ? JSON.stringify({ value: TOKEN, expiration: "2026-10-15T12:00:00Z" }) : null) };
const open = (routes = fixture("github-copilot")) => fixtureHttp(githubCopilot, routes, storage);
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

describe("github-copilot detect", () => {
  it("is signed in with the cached token, and reads only the API origin", async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const fetch = async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response('{"threads":[]}');
    };
    const { createHttp } = await import("../src/index.js");
    expect(await githubCopilot.detect(createHttp(githubCopilot, { fetch, storage, cookie: () => "" }))).toBe(true);
    expect(seen).toEqual({ url: `${API}${LIST}`, auth: `GitHub-Bearer ${TOKEN}` });
  });
  it("GC2 is signed out with no token, or when the API answers 401 (an expired token)", async () => {
    expect(await githubCopilot.detect(fixtureHttp(githubCopilot, fixture("github-copilot")).http)).toBe(false);
    expect(await githubCopilot.detect(open({ [LIST]: { $status: 401 } }).http)).toBe(false);
  });
});

describe("github-copilot list", () => {
  it("GC4 reads every thread in one call, with no next page", async () => {
    const f = open();
    expect(await githubCopilot.listConversations(f.http)).toEqual({
      items: [
        { id: C1, title: "Fix the flaky test", updatedAt: "2026-10-01T09:05:00.000Z" },
        { id: C2, title: "<img src=x onerror=alert(1)>", updatedAt: "2026-09-20T12:01:00.000Z" },
      ],
      next: undefined,
    });
    expect(f.calls).toEqual([LIST]);
  });
  it("GC1 names the field when the list changed", async () => {
    expect(await code(githubCopilot.listConversations(open({ [LIST]: { items: [] } }).http))).toMatch(/^provider-schema: github-copilot: threads is not a list/);
    expect(await code(githubCopilot.listConversations(open({ [LIST]: { threads: [{ id: C1, name: "x" }] } }).http))).toMatch(/^provider-schema: github-copilot: threads\[0\].updatedAt is not a time/);
  });
  it("GC3 passes a 429 on as rate-limited", async () => {
    expect(await code(githubCopilot.listConversations(open({ [LIST]: { $status: 429 } }).http))).toMatch(/^rate-limited: /);
  });
});

describe("github-copilot threads", () => {
  it("reads a thread that passes the foxcache/v1 check", async () => {
    const c = await githubCopilot.getConversation(open().http, stub(C1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "github-copilot", id: C1, title: "Fix the flaky test", createdAt: "2026-10-01T09:00:00.123Z", updatedAt: "2026-10-01T09:05:00.000Z" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Why does this test fail on CI only?", "2026-10-01T09:00:01.000Z"],
      ["assistant", "It depends on the time zone. Set TZ=UTC.", "2026-10-01T09:00:09.500Z"],
    ]);
  });
  it("GC7 keeps hostile text as text, and a message with no content as empty", async () => {
    const c = await githubCopilot.getConversation(open().http, stub(C2));
    expect([c.title, ...c.messages.map((m) => m.text)]).toEqual(["<img src=x onerror=alert(1)>", "<script>alert(1)</script>", ""]);
  });
  it("GC1 throws provider-schema on a role it does not know", async () => {
    const routes = fixture("github-copilot");
    const bad = structuredClone(routes[THREAD(C1)]) as { messages: Array<{ role: string }> };
    bad.messages[1]!.role = "robot";
    expect(await code(githubCopilot.getConversation(open({ ...routes, [THREAD(C1)]: bad }).http, stub(C1)))).toMatch(/^provider-schema: github-copilot: messages\[1\].role is "robot"/);
  });
  it("GC5 throws too-large on a thread with too many messages", async () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => ({ id: `m${i}`, role: "user", content: "x", createdAt: "2026-10-01T09:00:00Z" }));
    const routes = { ...fixture("github-copilot"), [THREAD(C1)]: { thread: { id: C1, name: "big", createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z" }, messages } };
    expect(await code(githubCopilot.getConversation(open(routes).http, stub(C1)))).toMatch(/^too-large: github-copilot: /);
  });
  it("GC6 keeps the token out of every record and error", async () => {
    const f = open();
    const c = await githubCopilot.getConversation(f.http, stub(C1));
    const e = await githubCopilot.getConversation(open({ [THREAD(C1)]: { $status: 500 } }).http, stub(C1)).catch((x: Error) => x);
    expect(`${JSON.stringify(c)} ${String(e)} ${JSON.stringify(e)}`.includes(TOKEN)).toBe(false);
  });
});
