import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_MESSAGES, MAX_TEXT, check, checkConversation, checkMemory, checkPreference, checkProject, recordKey } from "../src/index.js";

const conv = (over: Record<string, unknown> = {}) => ({
  provider: "chatgpt",
  id: "c-1",
  title: "Trip plan",
  createdAt: "2026-01-02T03:04:05.000Z",
  updatedAt: "2026-01-03T03:04:05.000Z",
  messages: [{ role: "user", text: "Plan a trip", attachments: [] }],
  ...over,
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("S1 required fields and types", () => {
  it("accepts a valid conversation", () => {
    expect(checkConversation(conv())).toEqual(conv());
  });
  it.each([
    ["missing title", { title: undefined }, "title"],
    ["numeric id", { id: 5 }, "id"],
    ["unknown provider", { provider: "bard" }, "provider"],
    ["bad time", { updatedAt: "yesterday" }, "updatedAt"],
    ["time with no zone", { createdAt: "2026-01-02T03:04:05" }, "createdAt"],
    ["messages not a list", { messages: {} }, "messages"],
    ["unknown role", { messages: [{ role: "robot", text: "x", attachments: [] }] }, "messages[0].role"],
    ["attachments missing", { messages: [{ role: "user", text: "x" }] }, "messages[0].attachments"],
    ["attachment without name", { messages: [{ role: "user", text: "x", attachments: [{ size: 3 }] }] }, "messages[0].attachments[0].name"],
  ])("rejects %s", (_name, over, path) => {
    expect(codeOf(() => checkConversation(conv(over)))).toMatch(new RegExp(`^invalid-record: .*${path.replace(/[[\]]/g, "\\$&")}`));
  });
  it("rejects a preference of an unknown kind and a library item of an unknown kind", () => {
    expect(codeOf(() => checkPreference({ provider: "claude", kind: "mood", text: "x" }))).toMatch(/^invalid-record: .*kind/);
    expect(codeOf(() => check("library", { provider: "chatgpt", id: "g-1", name: "x", kind: "plugin" }))).toMatch(/^invalid-record: .*kind/);
  });
  it("rejects a record that is not an object", () => {
    expect(codeOf(() => checkMemory(null))).toMatch(/^invalid-record/);
    expect(codeOf(() => checkMemory([]))).toMatch(/^invalid-record/);
  });
});

describe("S2 extra keys", () => {
  it("drops keys the schema does not name, at every level", () => {
    const out = checkConversation(conv({ mapping: { raw: true }, messages: [{ role: "user", text: "x", attachments: [{ name: "a.pdf", extracted_content: "secret" }], metadata: {} }] }));
    expect(out).not.toHaveProperty("mapping");
    expect(out.messages[0]).not.toHaveProperty("metadata");
    expect(out.messages[0]!.attachments[0]).toEqual({ name: "a.pdf" });
  });
  it("keeps project files as metadata", () => {
    const p = checkProject({ provider: "claude", id: "p1", name: "Thesis", instructions: "Be brief", files: [{ name: "notes.md", size: 12, content: "body" }] });
    expect(p).toEqual({ provider: "claude", id: "p1", name: "Thesis", instructions: "Be brief", files: [{ name: "notes.md", size: 12 }] });
  });
});

describe("S3 hostile text", () => {
  it("keeps HTML and script text as it is", () => {
    const text = `<img src=x onerror=alert(1)><script>alert("x")</script>`;
    expect(checkConversation(conv({ title: text, messages: [{ role: "assistant", text, attachments: [] }] })).messages[0]!.text).toBe(text);
  });
});

describe("S4 huge conversations", () => {
  it("cuts a message over the text limit and marks it", () => {
    const out = checkConversation(conv({ messages: [{ role: "assistant", text: "a".repeat(MAX_TEXT + 10), attachments: [] }] }));
    expect(out.messages[0]!.text.length).toBe(MAX_TEXT);
    expect(out.messages[0]!.truncated).toBe(true);
  });
  it("throws too-large over the message limit", () => {
    const messages = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: "user", text: "x", attachments: [] }));
    expect(codeOf(() => checkConversation(conv({ messages })))).toMatch(/^too-large/);
  });
});

describe("S5 broken characters", () => {
  it("removes NUL and replaces lone surrogates", () => {
    const out = checkMemory({ provider: "claude", text: "a\u0000b\uD800c\uDC00d😀" });
    expect(out.text).toBe("ab�c�d😀");
  });
});

describe("S6 ids", () => {
  it.each([[""], ["a/b"], [".."], ["x".repeat(201)], ["a\nb"]])("rejects id %j", (id) => {
    expect(codeOf(() => checkConversation(conv({ id })))).toMatch(/^invalid-record: .*id/);
  });
  it("builds keys from provider and id, and hashes a memory with no id", () => {
    expect(recordKey("conversations", checkConversation(conv()))).toBe("chatgpt:c-1");
    const a = recordKey("memories", checkMemory({ provider: "claude", text: "Likes tea" }));
    expect(a).toMatch(/^claude:m-[0-9a-f]{16}$/);
    expect(recordKey("memories", checkMemory({ provider: "claude", text: "Likes tea" }))).toBe(a);
    expect(recordKey("memories", checkMemory({ provider: "chatgpt", text: "Likes tea" }))).toMatch(/^chatgpt:m-/);
    expect(recordKey("preferences", checkPreference({ provider: "claude", kind: "about-me", text: "x" }))).toBe("claude:about-me");
  });
});
