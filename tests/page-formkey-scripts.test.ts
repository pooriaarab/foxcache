// H31 in docs/failure-modes.md: page-formkey reads only the page's
// JavaScript, and calls a function only when exactly one script names it.
import { describe, expect, it } from "vitest";
import { FoxcacheError, createHttp, defineReads, inlineScripts, pageFormkey } from "../src/index.js";

const ORIGIN = "https://poe.com";
const KEY = "0123456789abcdef0123456789abcdef";
const REAL = "window.realKey=function(){return window._k};";
const DECOY = '{"bot":{"description":"window.print=function(){return window"}}';
const kind = pageFormkey({ fn: /window\.([a-zA-Z0-9]+)=function\(\)\{return window/, length: 32, header: "poe-formkey", tag: { header: "poe-tag-id", salt: "s" } });
const el = (text: string, type = "", src = "") => ({ text, type, src });
const reads = defineReads([{ method: "GET", path: "/api/me", source: "https://example.test/docs" }]);

async function run(scripts: string[]) {
  const called: string[] = [];
  const sent: Headers[] = [];
  const fetch = async (_url: string, init: RequestInit) => (sent.push(new Headers(init.headers)), Response.json({}));
  const http = createHttp({ origin: ORIGIN, reads, auth: kind }, { fetch, storage: { getItem: () => null }, scripts: () => scripts, call: (name) => (called.push(name), name === "realKey" ? KEY : "") });
  const error = await http.get("/api/me").then(() => undefined, (e: unknown) => e);
  return { called, sent, error };
}

describe("H31 the scripts page-formkey reads", () => {
  it("keeps inline scripts with no type or text/javascript, and drops data blocks and src scripts", () => {
    const list = [el("a"), el("b", "text/javascript"), el("c", " Text/JavaScript "), el(DECOY, "application/json"), el("d", "module"), el("e", "text/x-template"), el("f", "", "https://poe.com/x.js")];
    expect(inlineScripts(list)).toEqual(["a", "b", "c"]);
  });
  it("calls the one function the page's script names", async () => {
    const r = await run(["var x=1;", REAL]);
    expect([r.error, r.called, r.sent[0]?.get("poe-formkey")]).toEqual([undefined, ["realKey"], KEY]);
  });
  it.each([
    ["two scripts name a function", [DECOY, REAL]],
    ["one script names two", [`${REAL}${REAL.replace("realKey", "other")}`]],
    ["one name twice", [REAL, REAL]],
  ])("throws provider-schema and calls nothing when %s", async (_, scripts) => {
    const r = await run(scripts);
    expect(r.error).toBeInstanceOf(FoxcacheError);
    expect([(r.error as FoxcacheError).code, r.called, r.sent.length]).toEqual(["provider-schema", [], 0]);
  });
});
