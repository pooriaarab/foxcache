import { describe, expect, it } from "vitest";
import { type Conversation, FoxcacheError, createStore, memoryBackend, recordKey } from "../src/index.js";

const conv = (id: string, updatedAt: string, text = "hello", title = "A chat"): Conversation => ({
  provider: "chatgpt",
  id,
  title,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt,
  messages: [{ role: "user", text, attachments: [] }],
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return error.code;
    throw error;
  }
  return "no error";
}

describe("ST1 duplicate capture", () => {
  it("keeps one record, the newer copy wins, an equal time keeps the stored copy", async () => {
    const store = createStore(memoryBackend());
    expect(await store.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z", "first"))).toBe("added");
    expect(await store.put("conversations", conv("c1", "2026-01-01T00:00:00.000Z", "older"))).toBe("same");
    expect(await store.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z", "same time"))).toBe("same");
    expect(await store.put("conversations", conv("c1", "2026-01-03T00:00:00.000Z", "newer"))).toBe("updated");
    const all = await store.all("conversations");
    expect(all.map((c) => c.messages[0]!.text)).toEqual(["newer"]);
  });
  it("checks every record it stores", async () => {
    const store = createStore(memoryBackend());
    expect(await code(store.put("conversations", { ...conv("c1", "2026-01-02T00:00:00.000Z"), provider: "nope" } as never))).toBe("invalid-record");
  });
  it("gives the stored updatedAt per id, for an incremental capture", async () => {
    const store = createStore(memoryBackend());
    await store.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z"));
    await store.put("conversations", { ...conv("x", "2026-01-05T00:00:00.000Z"), provider: "claude" });
    expect(await store.stamps("chatgpt")).toEqual({ c1: "2026-01-02T00:00:00.000Z" });
  });
});

describe("ST2 memories without ids", () => {
  it("stores the same text once per provider", async () => {
    const store = createStore(memoryBackend());
    await store.put("memories", { provider: "claude", text: "Likes tea" });
    expect(await store.put("memories", { provider: "claude", text: "Likes tea" })).toBe("same");
    await store.put("memories", { provider: "chatgpt", text: "Likes tea" });
    expect(await store.all("memories")).toHaveLength(2);
  });
});

describe("ST3 a broken stored record", () => {
  it("is skipped by reads, counted in problems, and kept", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await store.put("conversations", conv("good", "2026-01-02T00:00:00.000Z"));
    await backend.put("conversations", "chatgpt:bad", { provider: "chatgpt", id: "bad" });
    expect((await store.all("conversations")).map((c) => c.id)).toEqual(["good"]);
    expect(await store.problems()).toEqual([{ kind: "conversations", key: "chatgpt:bad", error: expect.stringMatching(/^invalid-record/) }]);
    expect(await backend.get("conversations", "chatgpt:bad")).toBeDefined();
    expect((await store.counts()).chatgpt?.conversations).toBe(1);
  });
});

describe("ST3 a broken stored record is replaced by a good one", () => {
  it("treats a stored copy that fails its check as absent", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await backend.put("conversations", "chatgpt:c1", { provider: "chatgpt", id: "c1", updatedAt: "2026-02-01T00:00:00.000Z", messages: "broken" });
    expect(await store.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z", "good"))).toBe("updated");
    expect((await store.all("conversations")).map((c) => c.messages[0]!.text)).toEqual(["good"]);
    expect(await store.problems()).toEqual([]);
  });
});

describe("ST4 delete all", () => {
  it("empties every kind and the checkpoints", async () => {
    const store = createStore(memoryBackend());
    await store.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z"));
    await store.put("preferences", { provider: "claude", kind: "about-me", text: "I teach" });
    await store.setCheckpoint("chatgpt", { status: "stopped" });
    await store.deleteAll();
    expect(await store.counts()).toEqual({});
    expect(await store.checkpoint("chatgpt")).toBeUndefined();
  });
});

describe("ST5 bad queries", () => {
  it("refuses an empty or very long query", async () => {
    const store = createStore(memoryBackend());
    expect(await code(store.search("  "))).toBe("bad-query");
    expect(await code(store.search("x".repeat(201)))).toBe("bad-query");
  });
});

describe("ST6 many hits", () => {
  it("returns at most limit hits, each with one short snippet", async () => {
    const store = createStore(memoryBackend());
    for (let i = 0; i < 80; i++) await store.put("conversations", conv(`c${i}`, `2026-01-02T00:00:${String(i % 60).padStart(2, "0")}.000Z`, `${"pad ".repeat(100)}the Needle is here ${"pad ".repeat(100)}`));
    const hits = await store.search("needle");
    expect(hits).toHaveLength(50);
    expect(hits[0]!.snippet.length).toBeLessThanOrEqual(140);
    expect(hits[0]!.snippet).toContain("Needle");
    expect(await store.search("needle", { limit: 5 })).toHaveLength(5);
  });
  it("filters by provider and kind, and searches titles, memories and preferences", async () => {
    const store = createStore(memoryBackend());
    await store.put("conversations", conv("c1", "2026-01-02T00:00:00.000Z", "nothing", "Tea notes"));
    await store.put("memories", { provider: "claude", text: "Likes green tea" });
    await store.put("preferences", { provider: "claude", kind: "about-me", text: "Drinks tea daily" });
    expect((await store.search("tea")).map((h) => h.kind).toSorted()).toEqual(["conversations", "memories", "preferences"]);
    expect((await store.search("tea", { provider: "claude" })).map((h) => h.kind).toSorted()).toEqual(["memories", "preferences"]);
    expect((await store.search("tea", { kind: "conversations" })).map((h) => h.title)).toEqual(["Tea notes"]);
  });
});

describe("ST7 a record removed on the site", () => {
  it("keep deletes the records of one provider and kind that are not in the list", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await store.put("memories", { provider: "claude", text: "Lives in Berlin" });
    await store.put("memories", { provider: "claude", text: "Has a dog" });
    await store.put("memories", { provider: "chatgpt", id: "m1", text: "Lives in Paris" });
    await store.put("preferences", { provider: "claude", kind: "about-me", text: "Teacher" });
    await backend.put("memories", "claude:broken", { provider: "claude" });
    const toronto = { provider: "claude" as const, text: "Lives in Toronto" };
    await store.put("memories", toronto);
    expect(await store.keep("memories", "claude", [recordKey("memories", toronto)])).toBe(2);
    expect((await store.all("memories")).map((m) => m.text).toSorted()).toEqual(["Lives in Paris", "Lives in Toronto"]);
    expect(await store.all("preferences")).toHaveLength(1);
    expect((await store.problems()).map((p) => p.key)).toEqual(["claude:broken"]);
  });
});
