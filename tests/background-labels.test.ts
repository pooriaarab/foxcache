// X60 in docs/failure-modes.md: the archive page names each site with its
// adapter's label, which it asks the event page for.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ADAPTERS, memoryBackend } from "../src/index.js";

vi.mock("../extension/idb.js", () => ({ idbBackend: () => memoryBackend() }));

type Listener = (message: unknown, sender: unknown) => Promise<unknown> | undefined;

async function send(message: unknown) {
  let listener: Listener | undefined;
  const on = { addListener: () => undefined };
  vi.stubGlobal("browser", {
    runtime: { id: "fx", getURL: (p: string) => `moz-extension://fx/${p}`, onMessage: { addListener: (f: Listener) => (listener = f) }, onMessageExternal: on },
    tabs: { onRemoved: on, sendMessage: async () => ({}), query: async () => [] },
    permissions: { contains: async () => true, onRemoved: on },
  });
  vi.resetModules();
  const path = "../extension/background.js";
  await import(path);
  return listener!(message, { id: "fx", url: "moz-extension://fx/archive.html" });
}

describe("X60 the archive page's labels", () => {
  it("come from every adapter, through the event page", async () => {
    expect(await send({ type: "providers:labels" })).toEqual({ ok: true, value: ADAPTERS.map((a) => ({ id: a.id, label: a.label })) });
  });
  it("are not a copy in the page", () => {
    const page = readFileSync("extension/archive.js", "utf8");
    expect(page).toContain('ask("providers:labels")');
    for (const a of ADAPTERS) expect(page).not.toContain(JSON.stringify(a.label));
  });
});
