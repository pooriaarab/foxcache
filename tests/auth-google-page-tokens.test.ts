// H5, H7, H14 and H21 in docs/failure-modes.md: the Google page-token kind
// reads at, bl and f.sid from the page it names, and sends them only with
// a batchexecute read.
import { describe, expect, it } from "vitest";
import { FoxcacheError, createHttp, defineReads, googlePageTokens } from "../src/index.js";
import { batchRead, callBatch } from "../src/batchexecute.js";
import { batchWire } from "./fixture-http.js";

const ORIGIN = "https://gemini.google.com";
const PATH = "/_/BardChatUi/data/batchexecute";
const AT = "AJpMQsynthetic-xsrf-token:1760000000000";
const page = (wiz: Record<string, string>) => `<!doctype html><script>window.WIZ_global_data = ${JSON.stringify({ Qzxixc: "x", ...wiz })};</script><p>Gemini</p>`;
const SIGNED_IN = page({ SNlM0e: AT, cfb2h: "boq_assistant-bard-web-server_20261001.00_p0", FdrFJe: "-1234567890" });
const site = (path = "/app") => ({ origin: ORIGIN, auth: googlePageTokens({ path }), reads: defineReads([batchRead({ path: PATH, rpcid: "MaZiqc", source: "https://example.test/src" })]) });

interface Call {
  url: string;
  init: RequestInit;
}
/** Answers the token page with html(n) and the batchexecute path with read(n). */
function open(html: (n: number) => string | { status: number }, read: (n: number) => { status: number } | string = () => batchWire({ MaZiqc: ["ok"] })) {
  const calls: Call[] = [];
  let pages = 0;
  let reads = 0;
  const fetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = new URL(url).pathname === PATH ? read(++reads) : html(++pages);
    return typeof r === "string" ? new Response(r) : new Response("", { status: r.status });
  };
  return { http: createHttp(site(), { fetch, storage: { getItem: () => null }, scripts: () => [], call: () => undefined }), calls };
}
const list = (http: ReturnType<typeof open>["http"]) => callBatch(http, PATH, "MaZiqc", [13, null, [0, null, 1]], "/app");
async function err(p: Promise<unknown>): Promise<FoxcacheError> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return error;
    throw error;
  }
  throw new Error("no error");
}
const leaks = (e: Error) => `${e.message} ${e.stack} ${JSON.stringify(e)}`.includes(AT);

describe("google-page-tokens", () => {
  it("reads the page once, then sends at in the form, bl and f.sid in the query, and X-Same-Domain", async () => {
    const f = open(() => SIGNED_IN);
    expect(await list(f.http)).toEqual(["ok"]);
    await list(f.http);
    expect(f.calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual(["GET /app", `POST ${PATH}`, `POST ${PATH}`]);
    const u = new URL(f.calls[1]!.url);
    expect([u.searchParams.get("bl"), u.searchParams.get("f.sid")]).toEqual(["boq_assistant-bard-web-server_20261001.00_p0", "-1234567890"]);
    expect(new URLSearchParams(String(f.calls[1]!.init.body)).get("at")).toBe(AT);
    expect(new Headers(f.calls[1]!.init.headers).get("x-same-domain")).toBe("1");
    expect(f.calls[0]!.init.credentials).toBe("include");
  });
  it("H5 keeps the token out of results and errors", async () => {
    const f = open(() => SIGNED_IN, () => ({ status: 500 }));
    const e = await err(list(f.http));
    expect([e.code, leaks(e), JSON.stringify(f.http).includes(AT)]).toEqual(["provider-error", false, false]);
  });
  it.each([
    ["a guest page with no SNlM0e", page({ cfb2h: "bl", FdrFJe: "1" })],
    ["an empty SNlM0e", page({ SNlM0e: "", cfb2h: "bl", FdrFJe: "1" })],
  ])("H14 throws logged-out on %s and sends no read", async (_, html) => {
    const f = open(() => html);
    const e = await err(list(f.http));
    expect([e.code, f.calls.length]).toEqual(["logged-out", 1]);
  });
  it("H14 throws logged-out when the page redirects to a sign-in page", async () => {
    const f = open(() => ({ status: 302 }));
    expect((await err(list(f.http))).code).toBe("logged-out");
  });
  it.each([["cfb2h"], ["FdrFJe"]])("H21 throws provider-schema when the page has at but no %s, and names no value", async (key) => {
    const tokens: Record<string, string> = { SNlM0e: AT, cfb2h: "bl", FdrFJe: "1" };
    delete tokens[key];
    const f = open(() => page(tokens));
    const e = await err(list(f.http));
    expect([e.code, leaks(e), f.calls.length]).toEqual(["provider-schema", false, 1]);
    expect(e.message).toContain(key);
  });
  it("reads the page again once after a 401, and sends the new token", async () => {
    const f = open((n) => page({ SNlM0e: `${AT}-${n}`, cfb2h: "bl", FdrFJe: "1" }), (n) => (n === 1 ? { status: 401 } : batchWire({ MaZiqc: ["ok"] })));
    expect(await list(f.http)).toEqual(["ok"]);
    expect(f.calls.filter((c) => c.init.method === "POST").map((c) => new URLSearchParams(String(c.init.body)).get("at"))).toEqual([`${AT}-1`, `${AT}-2`]);
  });
  it("H7 refuses a reads table that names the token page", () => {
    const reads = defineReads([{ method: "GET", path: "/app", source: "https://example.test/src" }]);
    expect(() => createHttp({ origin: ORIGIN, reads, auth: googlePageTokens({ path: "/app" }) }, { fetch: async () => new Response(""), storage: { getItem: () => null }, scripts: () => [], call: () => undefined })).toThrow(/token/);
  });
});
