// X10 in docs/failure-modes.md, with the archive limit cut to 4 KiB.
import { describe, expect, it, vi } from "vitest";
import { memoryBackend, parseArchive } from "../src/index.js";

vi.mock("../src/archive.js", async (actual) => ({ ...(await actual<typeof import("../src/archive.js")>()), MAX_ARCHIVE_BYTES: 4096 }));
vi.mock("../extension/idb.js", () => ({ idbBackend: () => memoryBackend() }));

type Listener = (message: unknown, sender: unknown) => Promise<unknown> | undefined;
const page = { id: "fx", url: "moz-extension://fx/archive.html" };

async function eventPage() {
  let listener: Listener | undefined;
  const on = { addListener: () => undefined };
  vi.stubGlobal("browser", {
    runtime: { id: "fx", getURL: (p: string) => `moz-extension://fx/${p}`, onMessage: { addListener: (f: Listener) => (listener = f) }, onMessageExternal: on },
    tabs: { onRemoved: on },
  });
  vi.resetModules();
  const path = "../extension/background.js";
  const { store } = await import(path);
  return { store, send: (message: unknown) => listener!(message, page) };
}

describe("event page: the JSON export", () => {
  it("X10 the export is compact, and one the CLI could not import is refused", async () => {
    const { store, send } = await eventPage();
    await store.put("memories", { provider: "chatgpt", id: "m1", text: "Prefers metric units." });
    const small = (await send({ type: "export:json" })) as { ok: true; value: string };
    expect(small.ok).toBe(true);
    expect(small.value).not.toContain("\n");
    expect(parseArchive(small.value).memories).toHaveLength(1);
    await store.put("memories", { provider: "chatgpt", id: "m2", text: "y".repeat(5000) });
    expect(await send({ type: "export:json" })).toMatchObject({ ok: false, code: "too-large", error: expect.stringContaining("Markdown") });
  });
});
