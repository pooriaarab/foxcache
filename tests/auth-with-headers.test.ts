// H19 in docs/failure-modes.md: the with-headers kind adds the site's
// fixed headers to every read, next to the token of the kind it wraps.
import { describe, expect, it } from "vitest";
import { FoxcacheError, createHttp, defineReads, localStorageBearer } from "../src/index.js";
import { withHeaders } from "../src/auth/with-headers.js";

const TOKEN = "eyJ-synthetic-secret-token";
const auth = withHeaders(localStorageBearer({ key: "token" }), { source: "web" });
const reads = defineReads([{ method: "GET", path: "/api/v1/auths/", source: "https://example.test/docs" }]);

function open(token: string | null) {
  const sent: Headers[] = [];
  const fetch = async (_url: string, init: RequestInit) => (sent.push(new Headers(init.headers)), new Response("{}"));
  const http = createHttp({ origin: "https://chat.qwen.ai", reads, auth }, { fetch, storage: { getItem: (k) => (k === "token" ? token : null) }, scripts: () => [], call: () => undefined });
  return { http, sent };
}

describe("with-headers auth (H19)", () => {
  it("sends the fixed header with the bearer of the kind it wraps", async () => {
    const { http, sent } = open(TOKEN);
    await http.get("/api/v1/auths/");
    expect([sent[0]!.get("source"), sent[0]!.get("authorization"), sent[0]!.get("accept")]).toEqual(["web", `Bearer ${TOKEN}`, "application/json"]);
    expect([auth.kind, auth.tokenPaths, auth.renews]).toEqual(["with-headers", [], false]);
  });
  it("is signed out with no token, and sends nothing", async () => {
    const { http, sent } = open(null);
    const e = (await http.get("/api/v1/auths/").catch((x: unknown) => x)) as FoxcacheError;
    expect([e.code, sent.length]).toEqual(["logged-out", 0]);
  });
  it.each([["Authorization"], ["accept"], ["Cookie"], ["content-type"]])("refuses to set %s, which http or the token kind sets", (name) => {
    expect(() => withHeaders(localStorageBearer({ key: "token" }), { [name]: "x" })).toThrow(/may not set/);
  });
});
