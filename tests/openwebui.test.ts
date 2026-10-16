// The shared open-webui parts (chat.qwen.ai, chat.z.ai): the read path
// templates and the thread walk (P7).
import { describe, expect, it } from "vitest";
import { FoxcacheError, createHttp, defineReads, localStorageBearer } from "../src/index.js";
import { epoch, fill, thread } from "../src/adapters/openwebui.js";
import { reader } from "../src/adapters/read.js";

const r = reader("owui");
const TOKEN = "eyJ-synthetic-owui-token";
const text = (m: Record<string, unknown>) => String(m.content);
const msg = (id: string, parentId: string | null, role = "user", extra = {}) => ({ id, parentId, role, content: `text ${id}`, timestamp: 1786000000, ...extra });

function errorOf(f: () => unknown): FoxcacheError {
  try {
    f();
  } catch (error) {
    if (error instanceof FoxcacheError) return error;
    throw error;
  }
  throw new Error("no error");
}

describe("open-webui read paths (H10, H18)", () => {
  const sent: string[] = [];
  const site = { origin: "https://chat.z.ai", auth: localStorageBearer({ key: "token" }), reads: defineReads([
    { method: "GET", path: "/api/v1/chats/", source: "https://example.test/list" },
    { method: "GET", path: "/api/v1/chats/{id}", source: "https://example.test/chat" },
  ]) };
  const http = createHttp(site, { fetch: async (url) => (sent.push(url), new Response("{}")), storage: { getItem: () => TOKEN }, scripts: () => [], call: () => undefined });

  it("fills the id into the template, and http refuses an id that would leave its segment", async () => {
    expect(fill("/api/v1/chats/{id}", "c-1")).toBe("/api/v1/chats/c-1");
    for (const id of ["a/../../auths", "a%2Fb", ".."]) expect(await http.get(fill("/api/v1/chats/{id}", id)).catch((e: FoxcacheError) => e.code)).toBe("not-allowed");
    expect(sent).toEqual([]);
  });
  it("refuses an empty id, which would read the list path /chats/ instead", () => {
    expect(errorOf(() => fill("/api/v1/chats/{id}", "")).code).toBe("not-allowed");
    expect(errorOf(() => fill("/api/v1/chats/", "x")).code).toBe("not-allowed");
  });
});

describe("open-webui thread", () => {
  it("follows currentId up parentId to the root and leaves the other branch out", () => {
    const messages = { a: msg("a", null), b: msg("b", "a", "assistant"), c: msg("c", "a", "assistant", { files: [{ name: "plan.pdf", id: "f1", size: 10, url: "https://x/presigned" }] }) };
    const out = thread(r, messages, "c", text);
    expect(out.map((m) => [m.role, m.text])).toEqual([["user", "text a"], ["assistant", "text c"]]);
    expect(out[1]!.attachments).toEqual([{ name: "plan.pdf", id: "f1", size: 10 }]);
    expect(out[0]!.createdAt).toBe("2026-08-06T07:06:40.000Z");
  });
  it("reads a time sent as a numeric string, and an empty chat", () => {
    expect(epoch(r, "1786000000", "t")).toBe("2026-08-06T07:06:40.000Z");
    expect(thread(r, {}, null, text)).toEqual([]);
  });
  it("throws provider-schema on schema drift: no leaf, a missing parent, a cycle, an unknown role", () => {
    expect(errorOf(() => thread(r, { a: msg("a", null) }, "zz", text)).message).toMatch(/^owui: currentId is not a message/);
    expect(errorOf(() => thread(r, { b: msg("b", "a") }, "b", text)).message).toMatch(/message b has the parent a, which is not in the conversation/);
    expect(errorOf(() => thread(r, { a: msg("a", "b"), b: msg("b", "a") }, "a", text)).message).toMatch(/is in a parent cycle/);
    expect(errorOf(() => thread(r, { a: msg("a", null, "tool") }, "a", text)).code).toBe("provider-schema");
    expect(errorOf(() => thread(r, [], "a", text)).message).toMatch(/chat.history.messages is not an object/);
  });
});
