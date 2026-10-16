// H11 in docs/failure-modes.md: a wrong reads table fails when http is
// created, and every adapter's table passes.
import { describe, expect, it } from "vitest";
import { ADAPTERS, type Read, createHttp, defineReads } from "../src/index.js";

const ORIGIN = "https://chatgpt.com";
const SOURCE = "https://example.test/docs#get";
const page = { fetch: async () => new Response("{}"), storage: { getItem: () => null } };
const open = (reads: readonly Read[]) => () => createHttp({ origin: ORIGIN, reads }, page);
const get = (path: string, extra: Partial<Read> = {}): Read => ({ method: "GET", path, source: SOURCE, ...extra });
const op = (queryName: string): Read => get("/graphql", { method: "POST", body: { type: "json", match: { queryName } } });

describe("H11 a wrong reads table", () => {
  it("refuses a table that is not frozen", () => {
    expect(open([get("/a")])).toThrow(/frozen/);
    const shallow = Object.freeze([{ ...get("/a"), query: ["x"] }]);
    expect(open(shallow)).toThrow(/frozen/);
  });
  it.each([["http://example.test/x"], ["docs/providers/chatgpt.md"], [""]])("refuses the source %j", (source) => {
    expect(open(defineReads([get("/a", { source })]))).toThrow(/source/);
  });
  it.each([["a"], ["//a"], ["/a/"], ["/a//b"], ["/a/../b"], ["/a/./b"], ["/a?x=1"], ["/a#x"], ["/a%2Fb"], ["/a\\b"], ["/{}"], ["/{a"], ["/a b"]])("refuses the path %j", (path) => {
    expect(open(defineReads([get(path)]))).toThrow(/path/);
  });
  it("refuses two GET reads of one path", () => {
    expect(open(defineReads([get("/a/{id}"), get("/a/{id}", { query: ["x"] })]))).toThrow(/twice/);
  });
  it("refuses a GET with a body rule, and a POST without one", () => {
    expect(open(defineReads([get("/a", { body: { type: "json", match: {} } })]))).toThrow(/body/);
    expect(open(defineReads([get("/a", { method: "POST" })]))).toThrow(/body/);
  });
  it("refuses a body rule it does not know, or one with no match", () => {
    expect(open(defineReads([get("/a", { method: "POST", body: { type: "xml" } as never })]))).toThrow(/body/);
    expect(open(defineReads([get("/a", { method: "POST", body: { type: "json" } as never })]))).toThrow(/match/);
  });
  it("refuses a batchexecute read with no rpc id, or that does not allow the rpcids query", () => {
    expect(open(defineReads([get("/b", { method: "POST", query: ["rpcids"], body: { type: "batchexecute", rpcids: [] } })]))).toThrow(/rpc/);
    expect(open(defineReads([get("/b", { method: "POST", body: { type: "batchexecute", rpcids: ["MaZiqc"] } })]))).toThrow(/rpcids/);
  });
  it("takes POST reads of one path that differ in their body rule", () => {
    expect(open(defineReads([op("ThreadList"), op("Thread")]))).not.toThrow();
  });
  it("refuses a method it does not know", () => {
    expect(open(defineReads([get("/a", { method: "DELETE" as "GET" })]))).toThrow(/method/);
  });
});

describe("every adapter's reads", () => {
  it.each(ADAPTERS.map((a) => [a.id, a]))("%s has a table that http takes, each read with its source", (_, adapter) => {
    expect(() => createHttp(adapter, page)).not.toThrow();
    expect(adapter.reads.length).toBeGreaterThan(0);
    for (const read of adapter.reads) expect(read.source).toMatch(/^https:\/\/\S+$/);
  });
});
