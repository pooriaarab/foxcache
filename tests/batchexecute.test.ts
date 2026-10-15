// H9, H15 and H20 in docs/failure-modes.md: a batchexecute read sends only
// its rpc id, and its answer decodes to the result or fails loudly.
import { describe, expect, it } from "vitest";
import { FoxcacheError, cookie, createHttp, defineReads } from "../src/index.js";
import { batchRead, callBatch, decodeBatch } from "../src/batchexecute.js";
import { batchWire } from "./fixture-http.js";

const PATH = "/_/BardChatUi/data/batchexecute";
const SOURCE = "https://example.test/batchexecute";
/** Frames as Google sends them, each after its length line. */
const frames = (...lines: unknown[]) => `)]}'\n${lines.map((l) => `\n${JSON.stringify(l).length}\n${JSON.stringify(l)}`).join("")}`;
const wrb = (id: string, result: string | null, status?: unknown) => ["wrb.fr", id, result, null, null, status ?? null, "generic"];
const TRAILER = [["di", 52], ["af.httprm", 51, "-1234567890", 4]];

function code(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("H20 decodeBatch", () => {
  it("returns the inner result and skips the length lines and the trailer frames", () => {
    expect(decodeBatch(frames([wrb("MaZiqc", '[null,"next",[["c_1","Trip"]]]')], TRAILER, ["e", 4, null, null, 140]), "MaZiqc")).toEqual([null, "next", [["c_1", "Trip"]]]);
  });
  it("reads the frames that fixture-http writes", () => {
    expect(decodeBatch(batchWire({ hNvQHb: [[["t1"]]] }), "hNvQHb")).toEqual([[["t1"]]]);
  });
  it("takes the last frame with a result, after a placeholder", () => {
    expect(decodeBatch(frames([wrb("khqZz", null)], [wrb("khqZz", "[1]")]), "khqZz")).toEqual([1]);
  });
  it("gives null for a frame with no result and no status", () => {
    expect(decodeBatch(frames([wrb("wXbhsf", null)]), "wXbhsf")).toBeNull();
  });
  it("throws provider-schema when no frame answers the rpc id, or only another id does", () => {
    expect(code(() => decodeBatch(frames(TRAILER), "MaZiqc"))).toMatch(/^provider-schema: batchexecute MaZiqc: no frame answers this rpc id/);
    expect(code(() => decodeBatch(frames([wrb("GzXR5e", "[]")]), "MaZiqc"))).toMatch(/^provider-schema: .*no frame/);
  });
  it.each([
    ["no )]}' line", '[["wrb.fr","MaZiqc","[]"]]', /does not start/],
    ["a frame that is not JSON", ")]}'\n\n12\n<html>login</html>", /a frame is not JSON/],
    ["a frame that is not a list", ")]}'\n\n2\n{}", /not a list/],
    ["a result that is not JSON", frames([wrb("MaZiqc", "{oops")]), /result is not JSON/],
    ["a result that is not text", frames(["wrb.fr", "MaZiqc", 5]), /result is not text/],
  ])("throws provider-schema for %s, without quoting the answer", (_, text, why) => {
    const message = code(() => decodeBatch(text, "MaZiqc"));
    expect(message).toMatch(/^provider-schema: /);
    expect(message).toMatch(why);
    expect(message).not.toMatch(/login|oops/);
  });
  it.each([
    [[16], "logged-out"],
    [[8], "rate-limited"],
    [[8, null, [["type.googleapis.com/google.internal.UserDisplayableError", [1]]]], "rate-limited"],
    [[null, null, ["UserDisplayableError"]], "rate-limited"],
    [[5], "not-found"],
    [[3], "provider-error"],
    ["odd", "provider-error"],
  ])("maps the status %j of a frame with no result to %s", (status, want) => {
    expect(code(() => decodeBatch(frames([wrb("MaZiqc", null, status)]), "MaZiqc"))).toMatch(new RegExp(`^${want}: batchexecute MaZiqc`));
  });
  it.each([
    [401, "logged-out"],
    [429, "rate-limited"],
    [500, "provider-error"],
  ])("maps an er frame with %i to %s", (n, want) => {
    expect(code(() => decodeBatch(frames([["er", "MaZiqc", n]]), "MaZiqc"))).toMatch(new RegExp(`^${want}: `));
  });
  it("keeps hostile text in the result as text", () => {
    const hostile = ')]}\'\n42\n[["wrb.fr","x"]]</script><img src=x onerror=alert(1)>';
    expect(decodeBatch(frames([wrb("MaZiqc", JSON.stringify([hostile]))]), "MaZiqc")).toEqual([hostile]);
  });
});

describe("H9 a batchexecute read through http", () => {
  const site = { origin: "https://gemini.google.com", auth: cookie, reads: defineReads([batchRead({ path: PATH, rpcid: "MaZiqc", source: SOURCE })]) };
  function open() {
    const calls: { url: string; body: string }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(frames([wrb("MaZiqc", '["ok"]')]));
    };
    return { http: createHttp(site, { fetch, storage: { getItem: () => null }, scripts: () => [], call: () => undefined }), calls };
  }
  it("sends the rpc id in the query and the three-level f.req in compact JSON, and decodes the answer", async () => {
    const f = open();
    expect(await callBatch(f.http, PATH, "MaZiqc", [13, null, [0, null, 1]], "/app")).toEqual(["ok"]);
    const u = new URL(f.calls[0]!.url);
    expect([u.pathname, u.searchParams.get("rpcids"), u.searchParams.get("source-path"), u.searchParams.get("hl"), u.searchParams.get("rt")]).toEqual([PATH, "MaZiqc", "/app", "en", "c"]);
    expect(new URLSearchParams(f.calls[0]!.body).get("f.req")).toBe('[[["MaZiqc","[13,null,[0,null,1]]",null,"generic"]]]');
  });
  it("refuses an rpc id the reads do not list, such as a delete, before any request", async () => {
    const f = open();
    await expect(callBatch(f.http, PATH, "GzXR5e", ["c_1"], "/app")).rejects.toMatchObject({ code: "not-allowed" });
    expect(f.calls).toEqual([]);
  });
});
