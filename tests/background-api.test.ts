// X12 in docs/failure-modes.md: an adapter with an API origin is allowed
// only when the page and the API host are both granted. ChatGPT gets a
// stand-in API origin here.
import { describe, expect, it, vi } from "vitest";
import { memoryBackend } from "../src/index.js";

const API = "https://api.chatgpt.example";
vi.mock("../src/adapters/chatgpt.js", async (actual) => {
  const { chatgpt } = await actual<typeof import("../src/adapters/chatgpt.js")>();
  return { chatgpt: { ...chatgpt, apiOrigins: ["https://api.chatgpt.example"] } };
});
vi.mock("../extension/idb.js", () => ({ idbBackend: () => memoryBackend() }));

type Listener = (message: unknown, sender: unknown) => Promise<unknown> | undefined;
const page = { id: "fx", url: "moz-extension://fx/popup.html" };
const running = { provider: "chatgpt", status: "running", startedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", extrasDone: true, pages: 1, counts: {}, lastErrors: [] };

async function eventPage(granted: Set<string>) {
  let listener: Listener | undefined;
  let removed: ((p: { origins: string[] }) => Promise<void>) | undefined;
  const on = { addListener: () => undefined };
  vi.stubGlobal("browser", {
    runtime: { id: "fx", getURL: (p: string) => `moz-extension://fx/${p}`, onMessage: { addListener: (f: Listener) => (listener = f) }, onMessageExternal: on },
    tabs: { onRemoved: on, sendMessage: async () => ({ running: true }), query: async () => [] },
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)), onRemoved: { addListener: (f: typeof removed) => (removed = f) } },
  });
  vi.resetModules();
  const path = "../extension/background.js";
  const { store } = await import(path);
  const status = async () => ((await listener!({ type: "providers:status" }, page)) as { value: Array<{ id: string; state: string; origins: string[] }> }).value.find((p) => p.id === "chatgpt")!;
  return { store, status, removed: (origins: string[]) => removed!({ origins }) };
}

describe("X12 a site with an API origin", () => {
  it("is allowed only when the page and the API host are both granted", async () => {
    const granted = new Set(["https://chatgpt.com/*"]);
    const { status } = await eventPage(granted);
    expect(await status()).toMatchObject({ state: "no-permission", origins: ["https://chatgpt.com/*", `${API}/*`] });
    granted.add(`${API}/*`);
    expect((await status()).state).toBe("no-tab");
  });
  it("stops a running capture when the API host is turned off", async () => {
    const { store, removed } = await eventPage(new Set(["https://chatgpt.com/*", `${API}/*`]));
    await store.setCheckpoint("chatgpt", { tabId: 7, checkpoint: running });
    await removed([`${API}/*`]);
    expect((await store.checkpoint("chatgpt"))?.checkpoint.status).toBe("stopped");
  });
});
