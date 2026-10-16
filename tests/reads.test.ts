// H11 in docs/failure-modes.md: a wrong reads table fails when http is
// created, and every adapter's table passes.
import { describe, expect, it } from "vitest";
import { ADAPTERS, type Read, createHttp, defineReads } from "../src/index.js";

const ORIGIN = "https://chatgpt.com";
const SOURCE = "https://example.test/docs#get";
const page = { fetch: async () => new Response("{}"), storage: { getItem: () => null } };
const open = (reads: readonly Read[]) => () => createHttp({ origin: ORIGIN, reads }, page);
const get = (path: string, extra: Partial<Read> = {}): Read => ({ method: "GET", path, source: SOURCE, ...extra });

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
