import { describe, expect, it } from "vitest";
import { FOXSCOPE_ID, answerScent, cacheResolver, createStore, memoryBackend } from "../src/index.js";

async function filled() {
  const store = createStore(memoryBackend());
  await store.put("memories", { provider: "chatgpt", id: "m1", text: "Prefers metric units.", createdAt: "2026-01-01T00:00:00.000Z" });
  await store.put("memories", { provider: "claude", text: "Lives in Lisbon." });
  await store.put("preferences", { provider: "chatgpt", kind: "response-style", text: "Be concise." });
  await store.put("projects", { provider: "claude", id: "p1", name: "Thesis", instructions: "secret instructions", files: [{ name: "draft.pdf" }] });
  await store.put("conversations", { provider: "claude", id: "c1", title: "Private chat", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", messages: [{ role: "user", text: "very private", attachments: [] }] });
  return cacheResolver(store);
}
const all = ["cache.memories", "cache.preferences", "cache.projects", "cache.conversations"];

describe("the cache resolver", () => {
  it("lists four fields, conversations as private", async () => {
    const r = await filled();
    expect(r.namespace).toBe("cache");
    expect(await r.list()).toEqual([
      { name: "cache.memories", label: "Memories captured from AI chat sites", sensitivity: "ask" },
      { name: "cache.preferences", label: "Custom instructions and response style", sensitivity: "ask" },
      { name: "cache.projects", label: "Project names", sensitivity: "ask" },
      { name: "cache.conversations", label: "Conversations", sensitivity: "private" },
    ]);
  });
  it("reads memories and preferences with their provider", async () => {
    const values = await (await filled()).read(["cache.memories", "cache.preferences"], { derive: false });
    expect(values).toEqual({
      "cache.memories": [
        { provider: "chatgpt", text: "Prefers metric units." },
        { provider: "claude", text: "Lives in Lisbon." },
      ],
      "cache.preferences": [{ provider: "chatgpt", kind: "response-style", text: "Be concise." }],
    });
  });
  it("SC2 never returns conversations", async () => {
    const values = await (await filled()).read(all, { derive: true });
    expect(Object.keys(values)).not.toContain("cache.conversations");
    expect(JSON.stringify(values)).not.toContain("very private");
  });
  it("SC3 gives project names only", async () => {
    const values = await (await filled()).read(["cache.projects"], { derive: false });
    expect(values).toEqual({ "cache.projects": [{ provider: "claude", name: "Thesis" }] });
  });
  it("leaves out unknown names and other namespaces", async () => {
    expect(await (await filled()).read(["cache.nope", "prefs.size", "memory.all"], { derive: false })).toEqual({});
  });
});

describe("answerScent", () => {
  it("SC1 answers nothing to a sender that is not foxscope", async () => {
    const r = await filled();
    for (const sender of [{ id: "intruder@example" }, {}, { id: undefined }]) {
      expect(answerScent(r, sender, { type: "scent.list" })).toBeUndefined();
      expect(answerScent(r, sender, { type: "scent.read", fields: all, derive: false })).toBeUndefined();
    }
  });
  it("answers foxscope with the bare list and the bare values", async () => {
    const r = await filled();
    expect(await answerScent(r, { id: FOXSCOPE_ID }, { type: "scent.list" })).toHaveLength(4);
    expect(await answerScent(r, { id: FOXSCOPE_ID }, { type: "scent.read", fields: ["cache.projects"], derive: false })).toEqual({ "cache.projects": [{ provider: "claude", name: "Thesis" }] });
    expect(answerScent(r, { id: FOXSCOPE_ID }, { type: "other" })).toBeUndefined();
  });
  it("SC4 answers {error} to a bad read", async () => {
    const r = await filled();
    for (const fields of ["cache.memories", [1], Array(101).fill("cache.memories")]) {
      expect(await answerScent(r, { id: FOXSCOPE_ID }, { type: "scent.read", fields, derive: false })).toEqual({ error: expect.stringMatching(/^bad-request: /) });
    }
    expect(await answerScent(r, { id: FOXSCOPE_ID }, { type: "scent.read", fields: [], derive: "yes" })).toEqual({ error: expect.stringMatching(/derive/) });
  });
});
