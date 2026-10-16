// H5, H7 and H14 in docs/failure-modes.md: each auth kind keeps its token
// in the tab, inside http, and sends it only with a read.
import { describe, expect, it } from "vitest";
import { type Auth, FoxcacheError, type Read, chatgpt, cookie, cookieBearer, createHttp, defineReads, localStorageBearer, pageSession } from "../src/index.js";

const ORIGIN = "https://chat.example";
const TOKEN = "eyJ-synthetic-secret-token";
const SOURCE = "https://example.test/docs";
const READS = defineReads([
  { method: "GET", path: "/api/me", source: SOURCE },
  { method: "GET", path: "/api/fail", source: SOURCE },
  { method: "POST", path: "/api/list", body: { type: "form", match: {} }, source: SOURCE },
  { method: "POST", path: "/api/graph", body: { type: "json", match: {} }, source: SOURCE },
]);

interface Call {
  url: string;
  init: RequestInit;
}
/** A fetch stand-in: answers by path with a body or fn(n), records every call. */
function fakeFetch(routes: Record<string, string | { status: number; body?: string } | ((n: number) => string | { status: number })>) {
  const calls: Call[] = [];
  const counts = new Map<string, number>();
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const n = (counts.get(path) ?? 0) + 1;
    counts.set(path, n);
    const route = routes[path];
    const r = typeof route === "function" ? route(n) : (route ?? { status: 404 });
    return typeof r === "string" ? new Response(r) : new Response((r as { body?: string }).body ?? "{}", { status: r.status });
  };
  return { fetch, calls };
}
const bearerOf = (c: Call | undefined) => new Headers(c?.init.headers).get("authorization");

function open(auth: Auth, fetch: (url: string, init: RequestInit) => Promise<Response>, page: { storage?: Record<string, string>; cookie?: string } = {}) {
  const storage = { getItem: (k: string) => page.storage?.[k] ?? null };
  return createHttp({ origin: ORIGIN, reads: READS, auth }, { fetch, storage, cookie: () => page.cookie ?? "" });
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
const leaks = (e: Error) => `${e.message} ${e.stack} ${JSON.stringify(e)}`.includes(TOKEN);

describe("cookie", () => {
  it("sends the page cookies and no authorization", async () => {
    const f = fakeFetch({ "/api/me": "{}" });
    await open(cookie, f.fetch).get("/api/me");
    expect(f.calls[0]!.init.credentials).toBe("include");
    expect(bearerOf(f.calls[0])).toBeNull();
  });
});

describe("page-session (ChatGPT)", () => {
  const session = pageSession({ path: "/api/auth/session", field: "accessToken" });
  const routes = { "/api/auth/session": JSON.stringify({ user: { id: "u" }, accessToken: TOKEN }), "/api/me": '{"id":"user-1"}', "/api/fail": { status: 500, body: `oops ${TOKEN}` } };

  it("H5 adds the token to its reads and never returns it or puts it in an error", async () => {
    const f = fakeFetch(routes);
    const http = open(session, f.fetch);
    expect(JSON.stringify(await http.get("/api/me"))).not.toContain(TOKEN);
    expect(bearerOf(f.calls[1])).toBe(`Bearer ${TOKEN}`);
    expect(bearerOf(f.calls[0])).toBeNull();
    expect(leaks(await err(http.get("/api/fail")))).toBe(false);
    expect(JSON.stringify(http)).not.toContain(TOKEN);
    expect(f.calls.filter((c) => c.url.endsWith("/api/auth/session"))).toHaveLength(1);
  });
  it("H7 refuses the session answer under every spelling, before any request", async () => {
    const f = fakeFetch(routes);
    const http = createHttp(chatgpt, { fetch: f.fetch, storage: { getItem: () => null }, cookie: () => "" });
    const paths = ["/api/auth/session", "/api/auth/session/", "/api/auth/%73ession", "/api/auth/session;x", "/api/AUTH/session", "/backend-api/..%2Fapi%2Fauth%2Fsession", "/backend-api/%2e%2e/api/auth/session", "/backend-api/x%5C..%5Capi", "/backend-api"];
    for (const path of paths) expect((await err(http.get(path))).code, path).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it.each([["/api/auth/session"], ["/api/auth/{name}"], ["/api/{a}/{b}"]])("H7 refuses a reads table with the read %s", (path) => {
    const reads = defineReads([{ method: "GET", path, source: SOURCE } as Read]);
    expect(() => createHttp({ origin: ORIGIN, reads, auth: session }, { fetch: fakeFetch({}).fetch, storage: { getItem: () => null }, cookie: () => "" })).toThrow(/token/);
  });
  it("H14 throws logged-out when the session has no token, and sends no read", async () => {
    for (const body of ["{}", '{"accessToken":""}', '{"accessToken":5}', "null"]) {
      const f = fakeFetch({ ...routes, "/api/auth/session": body });
      expect((await err(open(session, f.fetch).get("/api/me"))).code).toBe("logged-out");
      expect(f.calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/auth/session"]);
    }
  });
  it("gets a new token once after a 401", async () => {
    let n = 0;
    const f = fakeFetch({ "/api/auth/session": () => JSON.stringify({ accessToken: `${TOKEN}-${++n}` }), "/api/me": (k) => (k === 1 ? { status: 401 } : '{"ok":true}') });
    expect(await open(session, f.fetch).get("/api/me")).toEqual({ ok: true });
    expect(f.calls.map(bearerOf)).toEqual([null, `Bearer ${TOKEN}-1`, null, `Bearer ${TOKEN}-2`]);
  });
});

describe("localStorage-bearer", () => {
  it("reads a field of a JSON value (DeepSeek userToken), fresh for each read", async () => {
    const f = fakeFetch({ "/api/me": "{}" });
    const storage = { userToken: JSON.stringify({ value: TOKEN }) };
    const http = open(localStorageBearer({ key: "userToken", field: "value" }), f.fetch, { storage });
    await http.get("/api/me");
    storage.userToken = JSON.stringify({ value: `${TOKEN}-2` });
    await http.get("/api/me");
    expect(f.calls.map(bearerOf)).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}-2`]);
  });
  it("reads a plain value (Kimi access_token) and keeps it out of errors", async () => {
    const f = fakeFetch({ "/api/me": "{}", "/api/fail": { status: 500, body: TOKEN } });
    const http = open(localStorageBearer({ key: "access_token" }), f.fetch, { storage: { access_token: TOKEN } });
    await http.get("/api/me");
    expect(bearerOf(f.calls[0])).toBe(`Bearer ${TOKEN}`);
    expect(leaks(await err(http.get("/api/fail")))).toBe(false);
  });
  it.each([
    ["no value", {}, "value"],
    ["a value that is not JSON", { userToken: `x${TOKEN}` }, "value"],
    ["no field", { userToken: '{"other":"x"}' }, "value"],
    ["an empty field", { userToken: '{"value":""}' }, "value"],
    ["an empty plain value", { userToken: "" }, undefined],
  ])("H14 throws logged-out on %s, sends nothing, and names no value", async (_, storage, field) => {
    const f = fakeFetch({ "/api/me": "{}" });
    const e = await err(open(localStorageBearer({ key: "userToken", ...(field ? { field } : {}) }), f.fetch, { storage }).get("/api/me"));
    expect([e.code, leaks(e), f.calls.length]).toEqual(["logged-out", false, 0]);
  });
});

describe("cookie-bearer", () => {
  it("reads the named cookie (Manus session_id), decoded", async () => {
    const f = fakeFetch({ "/api/me": "{}" });
    await open(cookieBearer({ name: "session_id" }), f.fetch, { cookie: `xsession_id=evil; session_id=${encodeURIComponent(`${TOKEN}+/=`)}; b=2` }).get("/api/me");
    expect(bearerOf(f.calls[0])).toBe(`Bearer ${TOKEN}+/=`);
  });
  it("reads a field of a JSON cookie", async () => {
    const f = fakeFetch({ "/api/me": "{}" });
    await open(cookieBearer({ name: "sb-auth-token", field: "access_token" }), f.fetch, { cookie: `sb-auth-token=${encodeURIComponent(JSON.stringify({ access_token: TOKEN }))}` }).get("/api/me");
    expect(bearerOf(f.calls[0])).toBe(`Bearer ${TOKEN}`);
  });
  it.each([["no cookie", ""], ["another cookie that ends with the name", `xsession_id=${TOKEN}`], ["an empty cookie", "session_id="], ["a broken escape", `session_id=%ZZ${TOKEN}`]])("H14 throws logged-out on %s", async (_, jar) => {
    const f = fakeFetch({ "/api/me": "{}" });
    const e = await err(open(cookieBearer({ name: "session_id" }), f.fetch, { cookie: jar }).get("/api/me"));
    expect([e.code, leaks(e), f.calls.length]).toEqual(["logged-out", false, 0]);
  });
});

describe("an auth kind of its own", () => {
  // A stand-in for a page-token kind (Google batchexecute): a header, a query value and a form field.
  const signed: Auth = { kind: "test-signed", tokenPaths: [], renews: false, open: () => async (request) => ({ headers: { "x-sig": `${request.method} ${new URL(request.url).pathname} ${request.body ?? ""}` }, query: { at: TOKEN }, ...(request.body === undefined ? {} : { form: { at: TOKEN } }) }) };
  it("adds headers, query values and form fields that the read did not list", async () => {
    const f = fakeFetch({ "/api/list": "{}" });
    await open(signed, f.fetch).post("/api/list", { cursor: "0" });
    expect(new URL(f.calls[0]!.url).searchParams.get("at")).toBe(TOKEN);
    expect(f.calls[0]!.init.body).toBe(`cursor=0&at=${TOKEN}`);
    expect(new Headers(f.calls[0]!.init.headers).get("x-sig")).toBe("POST /api/list cursor=0");
  });
  it("keeps its query value out of an error", async () => {
    const e = await err(open(signed, fakeFetch({ "/api/fail": { status: 500 } }).fetch).get("/api/fail"));
    expect([e.code, leaks(e)]).toEqual(["provider-error", false]);
  });
  it("cannot add form fields to a JSON body", async () => {
    await expect(open(signed, fakeFetch({ "/api/graph": "{}" }).fetch).post("/api/graph", {})).rejects.toThrow(/form/);
  });
});
