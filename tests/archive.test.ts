import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_ARCHIVE_BYTES, createStore, importArchive, memoryBackend, parseArchive, toArchive } from "../src/index.js";

const conv = (id: string, updatedAt: string, text = "hi") => ({
  provider: "claude",
  id,
  title: "Notes",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
  messages: [{ role: "user", text, attachments: [] }],
});
const archive = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ schema: "foxcache/v1", exportedAt: "2026-10-15T00:00:00.000Z", conversations: [], projects: [], memories: [], preferences: [], library: [], ...over });

function fail(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("A1 not an archive", () => {
  it.each([
    ["not JSON", "{oops", /^bad-archive: .*not JSON/],
    ["a list", "[]", /^bad-archive: .*object/],
    ["another schema", JSON.stringify({ schema: "foxprefs/v1" }), /^bad-archive: .*"foxprefs\/v1"/],
    ["a missing list", JSON.stringify({ schema: "foxcache/v1", exportedAt: "2026-10-15T00:00:00.000Z" }), /^bad-archive: .*conversations/],
  ])("refuses %s", (_n, text, want) => {
    expect(fail(() => parseArchive(text))).toMatch(want);
  });
});

describe("A2 oversized", () => {
  it("refuses a file over the limit before it parses it", () => {
    const big = { length: MAX_ARCHIVE_BYTES + 1 } as unknown as string;
    expect(fail(() => parseArchive(big))).toMatch(/^too-large/);
  });
});

describe("A3 one bad record", () => {
  it("fails the whole file, names the record, and writes nothing", async () => {
    const text = archive({ conversations: [conv("ok", "2026-01-02T00:00:00.000Z"), { ...conv("bad", "2026-01-02T00:00:00.000Z"), messages: "x" }] });
    expect(fail(() => parseArchive(text))).toMatch(/^bad-archive: conversations\[1\]: .*messages/);
    const store = createStore(memoryBackend());
    await expect(importArchive(store, text)).rejects.toThrow(FoxcacheError);
    expect(await store.counts()).toEqual({});
  });
});

describe("A4 duplicates in the file", () => {
  it("keeps the newer copy, whatever the order", async () => {
    const store = createStore(memoryBackend());
    const text = archive({ conversations: [conv("c", "2026-01-03T00:00:00.000Z", "new"), conv("c", "2026-01-02T00:00:00.000Z", "old")] });
    expect(await importArchive(store, text)).toEqual({ added: 1, updated: 0, same: 1 });
    expect((await store.all("conversations"))[0]!.messages[0]!.text).toBe("new");
  });
});

describe("A5 round trip", () => {
  it("exports and imports the same records", async () => {
    const a = createStore(memoryBackend());
    await a.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z"));
    await a.put("projects", { provider: "claude", id: "p1", name: "Thesis", instructions: "Cite sources", files: [{ name: "a.pdf", size: 10 }] });
    await a.put("memories", { provider: "chatgpt", id: "m1", text: "Uses metric", createdAt: "2026-02-01T00:00:00.000Z" });
    await a.put("preferences", { provider: "chatgpt", kind: "response-style", text: "Short answers" });
    await a.put("library", { provider: "chatgpt", id: "g-1", name: "Editor", kind: "gpt" });
    const out = await toArchive(a, new Date("2026-10-15T00:00:00.000Z"));
    expect(out.schema).toBe("foxcache/v1");
    expect(out.exportedAt).toBe("2026-10-15T00:00:00.000Z");
    const b = createStore(memoryBackend());
    expect(await importArchive(b, JSON.stringify(out))).toEqual({ added: 5, updated: 0, same: 0 });
    expect(await toArchive(b, new Date("2026-10-15T00:00:00.000Z"))).toEqual(out);
  });
});
