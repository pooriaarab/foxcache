import { describe, expect, it } from "vitest";
import { type Auth, FoxcacheError, MAX_RESPONSE_BYTES, type Read, cookie, createHttp, defineReads, localStorageBearer } from "../src/index.js";
import { reader } from "../src/adapters/read.js";

const ORIGIN = "https://chatgpt.com";
const SOURCE = "https://example.test/docs";
const get = (path: string, query?: string[]): Read => ({ method: "GET", path, ...(query ? { query } : {}), source: SOURCE });
/** A page with no storage, no scripts and no globals. */
const NO_PAGE = { storage: { getItem: () => null }, scripts: () => [], call: () => undefined };
const schema = reader("test");
/** A decoder that finds a changed shape. */
const strict = (): never => {
  throw schema.fail("thread", "is not a list");
};
/** The reads these tests send. */
const READS = defineReads([
  ...["/a", "/b", "/big", "/missing", "/api/me", "/backend-api/me", "/backend-api/fail"].map((p) => get(p)),
  get("/backend-api/conversations", ["offset", "limit", "skip"]),
  get("/backend-api/conversation/{id}"),
  { method: "GET", path: "/stream", decode: (text) => text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown), source: SOURCE },
  { method: "GET", path: "/strict", decode: strict, source: SOURCE },
  { method: "POST", path: "/graphql", body: { type: "json", match: { queryName: "ThreadList", "extensions.persistedQuery.sha256Hash": "abc" }, keys: ["queryName", "variables", "extensions"] }, source: SOURCE },
  { method: "POST", path: "/im/chain", body: { type: "form", match: { cmd: "list" } }, source: SOURCE },
  { method: "POST", path: "/_/BardChatUi/data/batchexecute", query: ["rpcids", "rt"], body: { type: "batchexecute", rpcids: ["MaZiqc", "hNvQHb"] }, source: SOURCE },
]);
const THREADS = { queryName: "ThreadList", variables: { first: 20 }, extensions: { persistedQuery: { sha256Hash: "abc" } } };
const BATCH = "/_/BardChatUi/data/batchexecute";
/** A batchexecute f.req that calls these rpc ids. */
const fReq = (...ids: string[]) => JSON.stringify([ids.map((id) => [id, "[]", null, "generic"])]);
/** A batchexecute read that decodes its answer. */
const BATCH_READS = defineReads([{ method: "POST", path: "/batch", body: { type: "batchexecute", rpcids: ["MaZiqc"] }, query: ["rpcids"], decode: (text) => batchexecute(text), source: SOURCE }]);
/** An Http on ORIGIN with BATCH_READS. */
const openBatch = (fetch: (url: string, init: RequestInit) => Promise<Response>) => createHttp({ origin: ORIGIN, auth: cookie, reads: BATCH_READS }, { fetch, ...NO_PAGE });
/** One batchexecute call of MaZiqc. */
const call = (http: ReturnType<typeof openBatch>) => http.post("/batch", { "f.req": JSON.stringify([[["MaZiqc", "[]", null, "generic"]]]) }, { rpcids: "MaZiqc" });
/** Google's batchexecute answer: a )]}' line, then length-prefixed JSON chunks. This decoder reads the first chunk. */
const batchexecute = (text: string): unknown => {
  if (!text.startsWith(")]}'\n")) throw new Error(`no XSSI prefix in ${text}`);
  return JSON.parse(text.slice(5).trim().split("\n")[1]!);
};
/** An Http on ORIGIN with READS and cookie auth. */
const open = (fetch: (url: string, init: RequestInit) => Promise<Response>) => createHttp({ origin: ORIGIN, reads: READS, auth: cookie }, { fetch, ...NO_PAGE });

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

/** What Firefox's fetch does on a network error or a CORS refusal. */
const refused = async (): Promise<Response> => {
  throw new TypeError("NetworkError when attempting to fetch resource.");
};

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
  it.each([["https://evil.example/x"], ["https://evil.example/a"], ["//evil.example/a"], ["x/y"], ["/\\evil.example"], ["javascript:alert(1)"]])("refuses %s before any request", async (path) => {
    const f = fakeFetch({});
    const http = open(f.fetch);
    expect((await err(http.get(path))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("sends GET with the page cookies, no body, and the query", async () => {
    const f = fakeFetch({ "/backend-api/conversations": { body: '{"items":[]}' } });
    const http = open(f.fetch);
    expect(await http.get("/backend-api/conversations", { offset: 0, limit: 28, skip: undefined })).toEqual({ items: [] });
    expect(f.calls[0]!.url).toBe("https://chatgpt.com/backend-api/conversations?offset=0&limit=28");
    expect(f.calls[0]!.init).toMatchObject({ method: "GET", credentials: "include", redirect: "manual" });
    expect(f.calls[0]!.init.body).toBeUndefined();
  });
  it("has no method other than get and post", () => {
    const http = open(fakeFetch({}).fetch);
    expect(Object.keys(http)).toEqual(["get", "post"]);
  });
});

describe("H8 a GET that is not a read", () => {
  it.each([["/api/project/delete"], ["/a/b"], ["/A"], ["/backend-api/conversation"], ["/backend-api/conversation/x/y"]])("refuses %s before any request", async (path) => {
    const f = fakeFetch({});
    expect((await err(open(f.fetch).get(path))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("refuses a query key the read does not list, and sends one it lists", async () => {
    const f = fakeFetch({ "/backend-api/conversations": { body: "[]" }, "/a": { body: "[]" } });
    const http = open(f.fetch);
    expect((await err(http.get("/backend-api/conversations", { offset: 0, project_id: "p" }))).code).toBe("not-allowed");
    expect((await err(http.get("/a", { x: 1 }))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
    expect(await http.get("/a", { x: undefined })).toEqual([]);
    expect(await http.get("/backend-api/conversations", { offset: 0 })).toEqual([]);
  });
});

describe("H9 a POST that is not a read", () => {
  const routes = { "/graphql": { body: '{"data":{}}' }, "/im/chain": { body: "{}" }, [BATCH]: { body: "[]" } };
  it("sends a listed JSON operation with the page cookies", async () => {
    const f = fakeFetch(routes);
    expect(await open(f.fetch).post("/graphql", THREADS)).toEqual({ data: {} });
    expect(f.calls[0]!.init).toMatchObject({ method: "POST", credentials: "include", redirect: "manual", body: JSON.stringify(THREADS) });
    expect(new Headers(f.calls[0]!.init.headers).get("content-type")).toBe("application/json");
  });
  it.each([
    ["another operation", { ...THREADS, queryName: "DeleteThread" }],
    ["another persisted query", { ...THREADS, extensions: { persistedQuery: { sha256Hash: "def" } } }],
    ["no persisted query", { queryName: "ThreadList" }],
    ["a list", [THREADS]],
  ])("refuses a JSON body with %s", async (_, body) => {
    const f = fakeFetch(routes);
    expect((await err(open(f.fetch).post("/graphql", body as never))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("refuses a POST to a GET read, a GET to a POST read, and a path no read names", async () => {
    const f = fakeFetch(routes);
    const http = open(f.fetch);
    for (const p of [http.post("/a", {}), http.get("/graphql"), http.post("/graphql/x", THREADS), http.post("/graphql", THREADS, { x: 1 })]) expect((await err(p)).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("sends a form with the listed field, and refuses another value or a field that is not text", async () => {
    const f = fakeFetch(routes);
    const http = open(f.fetch);
    expect(await http.post("/im/chain", { cmd: "list", cursor: "0" })).toEqual({});
    expect(f.calls[0]!.init.body).toBe("cmd=list&cursor=0");
    expect(new Headers(f.calls[0]!.init.headers).get("content-type")).toBe("application/x-www-form-urlencoded;charset=UTF-8");
    expect((await err(http.post("/im/chain", { cmd: "delete" }))).code).toBe("not-allowed");
    expect((await err(http.post("/im/chain", { cmd: "list", n: 1 }))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(1);
  });
  it("sends batchexecute calls of listed rpc ids", async () => {
    const f = fakeFetch(routes);
    expect(await open(f.fetch).post(BATCH, { "f.req": fReq("MaZiqc", "hNvQHb", "MaZiqc") }, { rpcids: "MaZiqc,hNvQHb", rt: "c" })).toEqual([]);
    expect(f.calls[0]!.url).toBe(`${ORIGIN}${BATCH}?rpcids=MaZiqc%2ChNvQHb&rt=c`);
    expect(new URLSearchParams(f.calls[0]!.init.body as string).get("f.req")).toBe(fReq("MaZiqc", "hNvQHb", "MaZiqc"));
  });
  it.each([
    ["a write id (NotebookLM J7Gthc)", fReq("J7Gthc"), "J7Gthc"],
    ["a write id next to a listed one", fReq("MaZiqc", "J7Gthc"), "MaZiqc,J7Gthc"],
    ["an rpcids query that hides an id", fReq("MaZiqc", "J7Gthc"), "MaZiqc"],
    ["an rpcids query with an id f.req does not call", fReq("MaZiqc"), "MaZiqc,hNvQHb"],
    ["an f.req that is not JSON", "[[[", "MaZiqc"],
    ["an f.req with no call", "[[]]", ""],
    ["no rpcids query", fReq("MaZiqc"), undefined],
  ])("refuses %s", async (_, req, rpcids) => {
    const f = fakeFetch(routes);
    expect((await err(open(f.fetch).post(BATCH, { "f.req": req }, { rpcids }))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
});

describe("H16 the fixed headers of a read", () => {
  // Doubao's page sends these on its IM reads (docs/providers/doubao.md).
  const IM = { "content-type": "application/json; encoding=utf-8", "agw-js-conv": "str" };
  const reads = defineReads([
    { method: "POST", path: "/im/pull", body: { type: "json", match: { cmd: 3100 }, keys: ["cmd"] }, headers: IM, source: SOURCE },
    { method: "POST", path: "/im/other", body: { type: "json", match: {}, keys: ["cmd"] }, source: SOURCE },
  ]);
  const site = (auth = cookie) => ({ origin: ORIGIN, reads, auth });
  it("sends them on that read only, with its content-type in place of the body rule's", async () => {
    const f = fakeFetch({ "/im/pull": { body: "{}" }, "/im/other": { body: "{}" } });
    const http = createHttp(site(), { fetch: f.fetch, ...NO_PAGE });
    await http.post("/im/pull", { cmd: 3100 });
    await http.post("/im/other", { cmd: 3100 });
    const [pull, other] = f.calls.map((c) => new Headers(c.init.headers));
    expect([pull!.get("content-type"), pull!.get("agw-js-conv")]).toEqual(["application/json; encoding=utf-8", "str"]);
    expect([other!.get("content-type"), other!.get("agw-js-conv")]).toEqual(["application/json", null]);
  });
  it("keeps the auth header next to them", async () => {
    const f = fakeFetch({ "/im/pull": { body: "{}" } });
    const http = createHttp(site(localStorageBearer({ key: "t" })), { fetch: f.fetch, ...NO_PAGE, storage: { getItem: () => "synthetic-token" } });
    await http.post("/im/pull", { cmd: 3100 });
    expect(new Headers(f.calls[0]!.init.headers).get("authorization")).toBe("Bearer synthetic-token");
  });
  it("sends the auth kind's value when a read fixes the same header", async () => {
    const fixed = defineReads([{ method: "GET", path: "/api/me", headers: { "poe-formkey": "from-read", "x-same-domain": "0" }, source: SOURCE }]);
    const auth: Auth = { kind: "test", tokenPaths: [], renews: false, open: () => async () => ({ headers: { "poe-formkey": "from-auth", "x-same-domain": "1" } }) };
    const f = fakeFetch({ "/api/me": { body: "{}" } });
    await createHttp({ origin: ORIGIN, reads: fixed, auth }, { fetch: f.fetch, ...NO_PAGE }).get("/api/me");
    const sent = new Headers(f.calls[0]!.init.headers);
    expect([sent.get("poe-formkey"), sent.get("x-same-domain")]).toEqual(["from-auth", "1"]);
  });
});

describe("H10 a placeholder holds one plain segment", () => {
  it.each([["/backend-api/conversation/a%2Fb"], ["/backend-api/conversation/.."], ["/backend-api/conversation/."], ["/backend-api/conversation/%2e%2e"], ["/backend-api/conversation/%41"], ["/backend-api/conversation/"], ["/backend-api/conversation/a;b"], ["/backend-api/x/../conversation/a"], ["/backend-api/./conversation/a"], ["/backend-api/conversation/a?b=1"], ["/backend-api/conversation/a#b"]])("refuses %s before any request", async (path) => {
    const f = fakeFetch({});
    expect((await err(open(f.fetch).get(path))).code).toBe("not-allowed");
    expect(f.calls).toHaveLength(0);
  });
  it("sends an id of letters, digits and - _ . ~ : @", async () => {
    const f = fakeFetch({ "/backend-api/conversation/g-p-0a_b.c~d:e@f": { body: "{}" } });
    expect(await open(f.fetch).get("/backend-api/conversation/g-p-0a_b.c~d:e@f")).toEqual({});
  });
});

describe("H12 a read on an API origin", () => {
  const API = "https://api.copilot.example";
  const NEO = "https://neo.chatgpt.com";
  const site = { origin: ORIGIN, apiOrigins: [API, NEO], auth: cookie, reads: defineReads([{ method: "GET", origin: API, path: "/github/chat/threads", query: ["limit"], source: SOURCE }, { method: "GET", origin: NEO, path: "/chats/{id}", source: SOURCE }, get("/a")]) };
  const answer = async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response('{"ok":true}'));
  let calls: Call[] = [];
  it("sends it from the tab with the page cookies", async () => {
    calls = [];
    const http = createHttp(site, { fetch: answer, ...NO_PAGE });
    expect(await http.get(`${API}/github/chat/threads`, { limit: 5 })).toEqual({ ok: true });
    expect(await http.get(`${NEO}/chats/c1`)).toEqual({ ok: true });
    expect(calls.map((c) => c.url)).toEqual([`${API}/github/chat/threads?limit=5`, `${NEO}/chats/c1`]);
    expect(calls[0]!.init).toMatchObject({ method: "GET", credentials: "include" });
  });
  it.each([
    ["an origin it does not list", "https://api.other.example/github/chat/threads"],
    ["a read of another origin", `${API}/a`],
    ["the API path on the page origin", "/github/chat/threads"],
    ["http", "http://api.copilot.example/github/chat/threads"],
    ["another port", "https://api.copilot.example:8443/github/chat/threads"],
    ["a user name", "https://me@api.copilot.example/github/chat/threads"],
    ["a query in the path", `${API}/github/chat/threads?limit=5`],
    ["a double slash", `${API}//github/chat/threads`],
    ["a dot segment", `${NEO}/chats/../chats/c1`],
  ])("refuses %s before any request", async (_, target) => {
    calls = [];
    expect((await err(createHttp(site, { fetch: answer, ...NO_PAGE }).get(target))).code).toBe("not-allowed");
    expect(calls).toHaveLength(0);
  });
});

describe("H13 fetch itself fails", () => {
  it("throws provider-error with the origin and path, for a network error or a CORS refusal", async () => {
    const e = await err(open(refused).get("/a"));
    expect([e.code, e.message]).toEqual(["provider-error", "Could not reach https://chatgpt.com/a: the network failed, or the site does not let this page read it (CORS)."]);
  });
});

describe("H2 signed out", () => {
  it.each([[401], [403]])("throws logged-out on %i", async (status) => {
    const http = open(fakeFetch({ "/api/me": { status } }).fetch);
    expect((await err(http.get("/api/me"))).code).toBe("logged-out");
  });
  it("throws logged-out on a redirect", async () => {
    const http = open(fakeFetch({ "/api/me": { type: "opaqueredirect" } }).fetch);
    expect((await err(http.get("/api/me"))).code).toBe("logged-out");
  });
});

describe("H3 429", () => {
  it("throws rate-limited with the Retry-After seconds", async () => {
    const http = open(fakeFetch({ "/a": { status: 429, headers: { "retry-after": "7" } }, "/b": { status: 429 } }).fetch);
    const a = await err(http.get("/a"));
    expect([a.code, a.retryAfter]).toEqual(["rate-limited", 7]);
    expect((await err(http.get("/b"))).retryAfter).toBeUndefined();
  });
});

describe("H4 not JSON or too big", () => {
  it("throws provider-schema on an HTML page", async () => {
    const http = open(fakeFetch({ "/a": { body: "<!doctype html><title>Just a moment...</title>", headers: { "content-type": "text/html" } } }).fetch);
    expect((await err(http.get("/a"))).code).toBe("provider-schema");
  });
  it("throws too-large on a big answer", async () => {
    const http = open(fakeFetch({ "/a": { body: "[]", headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } } }).fetch);
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
    const http = open(fetch);
    expect((await err(http.get("/big"))).code).toBe("too-large");
    expect(pulled).toBeLessThanOrEqual(MAX_RESPONSE_BYTES / chunk.length + 2);
  });
  it("counts bytes, not characters", async () => {
    // 26 Mi characters of two bytes each: 52 MiB, over the limit, though the character count is under it.
    const big = "é".repeat(26 * 1024 * 1024);
    const fetch = async () => new Response(`"${big}"`, { status: 200 });
    expect((await err(open(fetch).get("/big"))).code).toBe("too-large");
  });
});

describe("H15 an answer that is not JSON", () => {
  const SECRET = "sk-user-api-key-in-the-answer";
  it("gives the answer text to the read's decoder, and asks for any type", async () => {
    const f = fakeFetch({ "/batch": { body: ')]}\'\n\n52\n[["wrb.fr","MaZiqc","[[\\"c_1\\",\\"Trip\\"]]",null,"generic"]]\n25\n[["di",42]]\n' } });
    expect(await call(openBatch(f.fetch))).toEqual([["wrb.fr", "MaZiqc", '[["c_1","Trip"]]', null, "generic"]]);
    expect(new Headers(f.calls[0]!.init.headers).get("accept")).toBe("*/*");
  });
  it("decodes stream frames on a GET read", async () => {
    const f = fakeFetch({ "/stream": { body: '{"t":"a"}\n{"t":"b"}\n', headers: { "content-type": "text/event-stream" } } });
    expect(await open(f.fetch).get("/stream")).toEqual([{ t: "a" }, { t: "b" }]);
  });
  it("passes a FoxcacheError of the decoder on as it is", async () => {
    const e = await err(open(fakeFetch({ "/strict": { body: "x" } }).fetch).get("/strict"));
    expect([e.code, e.message]).toEqual(["provider-schema", "test: thread is not a list. The site may have changed; foxcache needs an update."]);
  });
  it("turns any other throw into provider-schema, with no answer text", async () => {
    const e = await err(call(openBatch(fakeFetch({ "/batch": { body: `<html>${SECRET}</html>` } }).fetch)));
    expect(e.code).toBe("provider-schema");
    expect(`${e.message} ${e.stack} ${JSON.stringify(e)}`).not.toContain(SECRET);
  });
  it("keeps the size cap", async () => {
    let decoded = false;
    const http = createHttp({ origin: ORIGIN, auth: cookie, reads: defineReads([{ method: "GET", path: "/a", decode: () => (decoded = true), source: SOURCE }]) }, { fetch: fakeFetch({ "/a": { body: "x", headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) } } }).fetch, ...NO_PAGE });
    expect([(await err(http.get("/a"))).code, decoded]).toEqual(["too-large", false]);
  });
});

describe("H6 server errors", () => {
  it("throws provider-error with the status", async () => {
    const http = open(fakeFetch({ "/a": { status: 503 } }).fetch);
    const e = await err(http.get("/a"));
    expect([e.code, e.status]).toEqual(["provider-error", 503]);
  });
  it("throws not-found on 404", async () => {
    const http = open(fakeFetch({}).fetch);
    expect((await err(http.get("/missing"))).code).toBe("not-found");
  });
});
