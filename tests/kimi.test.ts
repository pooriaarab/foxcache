// docs/providers/kimi.md: the Kimi failure modes K1-K8, through the
// adapter's own reads on the synthetic fixture.
import { describe, expect, it } from "vitest";
import { FoxcacheError, check, kimi, runCapture } from "../src/index.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const LIST = "POST /apiv2/kimi.chat.v1.ChatService/ListChats";
const CHAT = "POST /apiv2/kimi.chat.v1.ChatService/GetChat";
const MESSAGES = "POST /apiv2/kimi.chat.v1.ChatService/ListMessages";
const K1 = "0d1e0000-0000-4000-8000-0000000000a1";
const K2 = "0d1e0000-0000-4000-8000-0000000000a2";
const token = { getItem: (k: string) => (k === "access_token" ? "synthetic-token" : null) };
const open = (routes: Routes = fixture("kimi")) => fixtureHttp(kimi, routes, token);
const routes = (extra: Routes) => ({ ...fixture("kimi"), ...extra });
const stub = (id: string, title = "") => ({ id, title, updatedAt: "" });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("kimi detect (K1, K2)", () => {
  it("is signed in with a token, and sends it as a bearer to the list read", async () => {
    const f = open();
    expect(await kimi.detect(f.http)).toBe(true);
    expect(f.calls).toEqual([LIST]);
  });
  it("is signed out with no token, on a 401, or on HTTP 200 with auth.token.invalid", async () => {
    expect(await kimi.detect(fixtureHttp(kimi, fixture("kimi")).http)).toBe(false);
    expect(await kimi.detect(open(routes({ [LIST]: { $status: 401 } })).http)).toBe(false);
    expect(await kimi.detect(open(routes({ [LIST]: { error_type: "auth.token.invalid", message: "token invalid" } })).http)).toBe(false);
  });
  it("throws provider-error that names another error_type", async () => {
    expect(await code(kimi.detect(open(routes({ [LIST]: { error_type: "chat.rate.limit", message: "busy" } })).http))).toMatch(/^provider-error: kimi: .*chat\.rate\.limit/);
  });
});

describe("kimi list", () => {
  it("pages by page_token until the token is empty or left out (K3)", async () => {
    const f = open();
    const first = await kimi.listConversations(f.http);
    expect(first).toEqual({ items: [{ id: K1, title: "Hanoi street food", updatedAt: "2026-09-02T08:03:00.654Z" }], next: "page-2" });
    const second = await kimi.listConversations(f.http, first.next);
    expect(second).toEqual({ items: [{ id: K2, title: "Notes", updatedAt: "2026-08-20T10:01:00.000Z" }], next: undefined });
  });
  it("K40 pages past an empty page that still has a token", async () => {
    const f = open(routes({ [`${LIST} {"page_size":100,"query":""}`]: { nextPageToken: "page-2" } }));
    const first = await kimi.listConversations(f.http);
    expect(first).toEqual({ items: [], next: "page-2" });
    expect((await kimi.listConversations(f.http, first.next)).items.map((s) => s.id)).toEqual([K2]);
  });
  it("reads an empty account, whose answer has no chats field (K3)", async () => {
    expect(await kimi.listConversations(open(routes({ [`${LIST} {"page_size":100,"query":""}`]: { nextPageToken: "" } })).http)).toEqual({ items: [], next: undefined });
  });
  it.each([
    ["chats is not a list", { chats: {} }, /ListChats.chats is not a list/],
    ["a chat has no id", { chats: [{ name: "x", updateTime: "2026-09-02T08:00:00Z" }] }, /chats\[0\].id is not text/],
    ["updateTime is not a time", { chats: [{ id: K1, updateTime: 1788336000 }] }, /chats\[0\].updateTime is not a time/],
  ])("throws provider-schema when %s (P1)", async (_, page, why) => {
    expect(await code(kimi.listConversations(open(routes({ [`${LIST} {"page_size":100,"query":""}`]: page })).http))).toMatch(new RegExp(`^provider-schema: kimi: ${why.source}`));
  });
  it("passes a 429 on as rate-limited, for the runner to wait out (H3)", async () => {
    expect(await code(kimi.listConversations(open(routes({ [`${LIST} {"page_size":100,"query":""}`]: { $status: 429 } })).http))).toMatch(/^rate-limited: /);
  });
  it("stops the capture with pagination-loop when a page token comes again (K6)", async () => {
    const loop = routes({ [`${LIST} {"page_size":100,"query":"","page_token":"page-2"}`]: { chats: [{ id: "k3", updateTime: "2026-08-01T00:00:00Z" }], nextPageToken: "page-2" } });
    const sink = { put: async () => ({ stop: false }), checkpoint: async () => ({ stop: false }), keep: async () => ({ stop: false }) };
    const cp = await runCapture({ adapter: kimi, http: open(loop).http, sink, stamps: {}, delayMs: 0, sleep: async () => {} });
    expect(cp.error?.code).toBe("pagination-loop");
  });
});

describe("kimi conversations", () => {
  it("follows the newest message back to the root, with text blocks only (K4, P4)", async () => {
    const c = check("conversations", await kimi.getConversation(open().http, stub(K1, "Hanoi street food")));
    expect(c).toMatchObject({ provider: "kimi", id: K1, title: "Hanoi street food", createdAt: "2026-09-02T07:59:00.123Z", updatedAt: "2026-09-02T08:03:00.654Z" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Where to eat in Hanoi?", "2026-09-02T07:59:00.200Z"],
      ["assistant", "Try bún chả in the Old Quarter.\n\nGo early.", "2026-09-02T08:02:00.500Z"],
    ]);
  });
  it("keeps hostile text as text, takes the all-zero uuid as the root, and reads a message with no blocks (K3, S3)", async () => {
    const c = check("conversations", await kimi.getConversation(open().http, stub(K2, "Notes")));
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "<img src=x onerror=alert(1)>"],
      ["assistant", ""],
    ]);
  });
  it("keeps no signUrl, file or search result (K8)", async () => {
    const json = JSON.stringify(check("conversations", await kimi.getConversation(open().http, stub(K1))));
    expect(json).not.toMatch(/synthetic-sign-token|signUrl|menu\.pdf|example\.invalid|SCENARIO/);
  });
  it("reads an empty chat, whose answer has no messages field (K3)", async () => {
    expect((await kimi.getConversation(open(routes({ [`${MESSAGES} {"chatId":"${K2}"}`]: {} })).http, stub(K2))).messages).toEqual([]);
  });
  it("throws provider-schema on an unknown role", async () => {
    const bad = { messages: [{ id: "x", role: "robot", createTime: "2026-08-20T10:00:00Z" }] };
    expect(await code(kimi.getConversation(open(routes({ [`${MESSAGES} {"chatId":"${K2}"}`]: bad })).http, stub(K2)))).toMatch(/^provider-schema: kimi: message x.role is "robot"/);
  });
  it("throws provider-schema when a parent is not in the chat (K4, P7)", async () => {
    const gap = { messages: [{ id: "x", parentId: "gone", role: "user", createTime: "2026-08-20T10:00:00Z" }] };
    expect(await code(kimi.getConversation(open(routes({ [`${MESSAGES} {"chatId":"${K2}"}`]: gap })).http, stub(K2)))).toMatch(/^provider-schema: kimi: message x has the parent gone, which is not in the conversation/);
  });
  it("throws provider-schema when ListMessages sends a page token (K5)", async () => {
    const more = { messages: [{ id: "x", role: "user", createTime: "2026-08-20T10:00:00Z" }], nextPageToken: "m-2" };
    expect(await code(kimi.getConversation(open(routes({ [`${MESSAGES} {"chatId":"${K2}"}`]: more })).http, stub(K2)))).toMatch(/^provider-schema: kimi: ListMessages.nextPageToken /);
  });
  it("throws too-large on a chat over 20 000 messages (K7)", async () => {
    const huge = { messages: Array.from({ length: 20_001 }, (_, i) => ({ id: `h${i}`, ...(i ? { parentId: `h${i - 1}` } : {}), role: "user", createTime: "2026-08-20T10:00:00Z" })) };
    expect(await code(kimi.getConversation(open(routes({ [`${MESSAGES} {"chatId":"${K2}"}`]: huge })).http, stub(K2)))).toMatch(/^too-large: kimi: /);
  });
  it("throws provider-schema when GetChat has no chat", async () => {
    expect(await code(kimi.getConversation(open(routes({ [CHAT]: {} })).http, stub(K1)))).toMatch(/^provider-schema: kimi: GetChat.chat is not an object/);
  });
});
