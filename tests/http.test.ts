import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_RESPONSE_BYTES, createHttp } from "../src/index.js";

const ORIGIN = "https://chatgpt.com";
const TOKEN = "eyJ-synthetic-secret-token";

interface Call {
  url: string;
  init: RequestInit;
}
type Reply = { status?: number; body?: string; headers?: Record<string, string>; type?: ResponseType };

/** A fetch stand-in: answers by path, records every call. */
function fakeFetch(routes: Record<string, Reply | ((n: number) => Reply)>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const n = (counts.get(path) ?? 0) + 1;
    counts.set(path, n);
    const route = routes[path];
    const r = typeof route === "function" ? route(n) : (route ?? { status: 404, body: "not here" });
    if (r.type === "opaqueredirect") return { status: 0, type: "opaqueredirect", headers: new Headers(), text: async () => "" } as unknown as Response;
    return new Response(r.body ?? "{}", { status: r.status ?? 200, headers: { "content-type": "application/json", ...r.headers } });
  };
  return { fetch, calls };
}

async function err(p: Promise<unknown>): Promise<FoxcacheError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return error;
    throw error;
  }
  throw new Error("no error");
}

describe("H1 GET on the own origin only", () => {
  it.each([["https://evil.example/x"], ["//evil.example/x"], ["x/y"], ["/\\evil.example"], ["javascript:alert(1)"]])("refuses %s before any request", async (path) => {
    const f = fakeFetch({});
    const http = createHttp({ origin: ORIGIN, fetch: f.fetch });
    expect((await err(http.get(path))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("sends GET with the page cookies, no body, and the query", async () => {
    const f = fakeFetch({ "/backend-api/conversations": { body: '{"items":[]}' } });
    const http = createHttp({ origin: ORIGIN, fetch: f.fetch });
    expect(await http.get("/backend-api/conversations", { offset: 0, limit: 28, skip: undefined })).toEqual({ items: [] });
    expect(f.calls[0]!.url).toBe("https://chatgpt.com/backend-api/conversations?offset=0&limit=28");
    expect(f.calls[0]!.init).toMatchObject({ method: "GET", credentials: "include", redirect: "manual" });
    expect(f.calls[0]!.init.body).toBeUndefined();
  });
  it("has no method other than get", () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({}).fetch });
    expect(Object.keys(http)).toEqual(["get"]);
  });
});

describe("H2 signed out", () => {
  it.each([[401], [403]])("throws logged-out on %i", async (status) => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/api/me": { status } }).fetch });
    expect((await err(http.get("/api/me"))).code).toBe("logged-out");
  });
  it("throws logged-out on a redirect", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/api/me": { type: "opaqueredirect" } }).fetch });
    expect((await err(http.get("/api/me"))).code).toBe("logged-out");
  });
});

describe("H3 429", () => {
  it("throws rate-limited with the Retry-After seconds", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/a": { status: 429, headers: { "retry-after": "7" } }, "/b": { status: 429 } }).fetch });
    const a = await err(http.get("/a"));
    expect([a.code, a.retryAfter]).toEqual(["rate-limited", 7]);
    expect((await err(http.get("/b"))).retryAfter).toBeUndefined();
  });
});

describe("H4 not JSON or too big", () => {
  it("throws provider-schema on an HTML page", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/a": { body: "<!doctype html><title>Just a moment...</title>", headers: { "content-type": "text/html" } } }).fetch });
    expect((await err(http.get("/a"))).code).toBe("provider-schema");
  });
  it("throws too-large on a big answer", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/a": { body: "[]", headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } } }).fetch });
    expect((await err(http.get("/a"))).code).toBe("too-large");
  });
});

describe("H4 a big answer with no Content-Length", () => {
  it("stops reading once the bytes pass the limit", async () => {
    const chunk = new Uint8Array(1024 * 1024).fill(0x61);
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 80) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const fetch = async () => new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    const http = createHttp({ origin: ORIGIN, fetch });
    expect((await err(http.get("/big"))).code).toBe("too-large");
    expect(pulled).toBeLessThanOrEqual(MAX_RESPONSE_BYTES / chunk.length + 2);
  });
  it("counts bytes, not characters", async () => {
    // 26 Mi characters of two bytes each: 52 MiB, over the limit, though the character count is under it.
    const big = "é".repeat(26 * 1024 * 1024);
    const fetch = async () => new Response(`"${big}"`, { status: 200 });
    expect((await err(createHttp({ origin: ORIGIN, fetch }).get("/big"))).code).toBe("too-large");
  });
});

describe("H5 the bearer token stays inside http", () => {
  const routes = {
    "/api/auth/session": { body: JSON.stringify({ user: { id: "u" }, accessToken: TOKEN }) },
    "/backend-api/me": { body: '{"id":"user-1"}' },
    "/backend-api/fail": { status: 500, body: `oops ${TOKEN}` },
  };
  it("adds the token to its own requests and never returns it", async () => {
    const f = fakeFetch(routes);
    const http = createHttp({ origin: ORIGIN, fetch: f.fetch, auth: "chatgpt-session" });
    const me = await http.get("/backend-api/me");
    expect(JSON.stringify(me)).not.toContain(TOKEN);
    expect(new Headers(f.calls[1]!.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    const e = await err(http.get("/backend-api/fail"));
    expect(`${e.message} ${e.stack} ${JSON.stringify(e)}`).not.toContain(TOKEN);
    expect(JSON.stringify(http)).not.toContain(TOKEN);
    expect(f.calls.filter((c) => c.url.endsWith("/api/auth/session"))).toHaveLength(1);
  });
  it("refuses to return the session answer itself", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch(routes).fetch, auth: "chatgpt-session" });
    expect((await err(http.get("/api/auth/session"))).code).toBe("not-allowed");
  });
  it("H7 sends the token only under /backend-api/, whatever the spelling", async () => {
    const f = fakeFetch(routes);
    const http = createHttp({ origin: ORIGIN, fetch: f.fetch, auth: "chatgpt-session" });
    const paths = ["/api/auth/session/", "/api/auth/%73ession", "/api/auth/session;x", "/api/AUTH/session", "/backend-api/..%2Fapi%2Fauth%2Fsession", "/backend-api/%2e%2e/api/auth/session", "/backend-api/x%5C..%5Capi", "/backend-api"];
    for (const path of paths) expect((await err(http.get(path))).code, path).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("throws logged-out when the session has no token", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/api/auth/session": { body: "{}" } }).fetch, auth: "chatgpt-session" });
    expect((await err(http.get("/backend-api/me"))).code).toBe("logged-out");
  });
  it("gets a new token once after a 401", async () => {
    let session = 0;
    const f = fakeFetch({
      "/api/auth/session": () => ({ body: JSON.stringify({ accessToken: `${TOKEN}-${++session}` }) }),
      "/backend-api/me": (n) => (n === 1 ? { status: 401 } : { body: '{"ok":true}' }),
    });
    const http = createHttp({ origin: ORIGIN, fetch: f.fetch, auth: "chatgpt-session" });
    expect(await http.get("/backend-api/me")).toEqual({ ok: true });
    expect(session).toBe(2);
  });
});

describe("H5 a token in localStorage (DeepSeek)", () => {
  it("sends it as a bearer and throws logged-out without it", async () => {
    const f = fakeFetch({ "/api/v0/users/current": { body: '{"code":0}' } });
    const storage = { getItem: (k: string) => (k === "userToken" ? JSON.stringify({ value: TOKEN }) : null) };
    const http = createHttp({ origin: "https://chat.deepseek.com", fetch: f.fetch, auth: "deepseek-local", storage });
    expect(await http.get("/api/v0/users/current")).toEqual({ code: 0 });
    expect(new Headers(f.calls[0]!.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    const none = createHttp({ origin: "https://chat.deepseek.com", fetch: f.fetch, auth: "deepseek-local", storage: { getItem: () => null } });
    expect((await err(none.get("/api/v0/users/current"))).code).toBe("logged-out");
  });
});

describe("H6 server errors", () => {
  it("throws provider-error with the status", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({ "/a": { status: 503 } }).fetch });
    const e = await err(http.get("/a"));
    expect([e.code, e.status]).toEqual(["provider-error", 503]);
  });
  it("throws not-found on 404", async () => {
    const http = createHttp({ origin: ORIGIN, fetch: fakeFetch({}).fetch });
    expect((await err(http.get("/missing"))).code).toBe("not-found");
  });
});
