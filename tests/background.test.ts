// X9 in docs/failure-modes.md: the event page with a fake browser and a
// slow store, so a message can land between two awaits of another one.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryBackend } from "../src/index.js";

// Every store call waits 5 ms, as IndexedDB does, so messages interleave.
const { slow } = vi.hoisted(() => ({
  slow:
    <A extends unknown[], R>(f: (...a: A) => Promise<R>) =>
    async (...a: A) => {
      await new Promise((r) => setTimeout(r, 5));
      return f(...a);
    },
}));
vi.mock("../extension/idb.js", () => ({
  idbBackend: () => {
    const m = memoryBackend();
    return { get: slow(m.get), put: slow(m.put), delete: slow(m.delete), entries: slow(m.entries), clear: slow(m.clear) };
  },
}));

type Listener = (message: unknown, sender: unknown) => Promise<unknown> | undefined;
const agent = { id: "fx", tab: { id: 7 }, url: "https://chatgpt.com/c/1" };
const page = { id: "fx", url: "moz-extension://fx/settings.html" };
const running = { provider: "chatgpt", status: "running", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", extrasDone: true, pages: 1, counts: {}, lastErrors: [] };
const memory = (id: string) => ({ provider: "chatgpt", id, text: `secret ${id}` });

async function eventPage() {
  let listener: Listener | undefined;
  const on = { addListener: () => undefined };
  vi.stubGlobal("browser", {
    runtime: { id: "fx", getURL: (p: string) => `moz-extension://fx/${p}`, onMessage: { addListener: (f: Listener) => (listener = f) }, onMessageExternal: on },
    tabs: { onRemoved: on, sendMessage: async () => ({ running: true }), query: async () => [] },
    permissions: { contains: async () => true, onRemoved: { addListener() {} } },
  });
  vi.resetModules();
  const path = "../extension/background.js";
  const { store } = await import(path);
  await store.setCheckpoint("chatgpt", { tabId: 7, checkpoint: running });
  await store.put("memories", memory("m1"));
  return { store, send: (message: unknown, sender: unknown) => listener!(message, sender) };
}

describe("event page: delete all during a capture", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("X9 a checkpoint saved while delete all runs does not bring the capture back", async () => {
    for (const offset of [0, 3, 6, 9]) {
      const { store, send } = await eventPage();
      const saved = send({ type: "capture:checkpoint", checkpoint: running }, agent);
      await new Promise((r) => setTimeout(r, offset));
      await send({ type: "data:delete-all" }, page);
      expect(await saved).toEqual({ stop: true });
      expect(await store.checkpoint("chatgpt")).toBeUndefined();
      expect(await send({ type: "capture:put", kind: "memories", record: memory("m2") }, agent)).toEqual({ stop: true });
      expect(await store.all("memories")).toEqual([]);
    }
  });

  it("X7 a record put while delete all runs is removed again", async () => {
    for (const offset of [0, 3, 6, 9]) {
      const { store, send } = await eventPage();
      const put = send({ type: "capture:put", kind: "memories", record: memory("m2") }, agent);
      await new Promise((r) => setTimeout(r, offset));
      await send({ type: "data:delete-all" }, page);
      expect(await put).toEqual({ stop: true });
      expect(await store.all("memories")).toEqual([]);
      expect(await store.checkpoint("chatgpt")).toBeUndefined();
    }
  });
});
