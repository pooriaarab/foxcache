import { describe, expect, it } from "vitest";
import { FoxcacheError, check, deepseek } from "../src/index.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const ORIGIN = "https://chat.deepseek.com";
const S1 = "0b1e0000-0000-4000-8000-000000000001";
const S2 = "0b1e0000-0000-4000-8000-000000000002";
const S3 = "0b1e0000-0000-4000-8000-000000000003";
const storage = { getItem: (k: string) => (k === "userToken" ? JSON.stringify({ value: "synthetic-token" }) : null) };
const open = (routes = fixture("deepseek")) => fixtureHttp(ORIGIN, routes, "deepseek-local", storage);
const stub = (id: string) => ({ id, title: "", updatedAt: "" });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("deepseek detect", () => {
  it("is signed in with a token and a user", async () => {
    expect(await deepseek.detect(open().http)).toBe(true);
  });
  it("is signed out with no token, or when the API says the token is bad (HTTP 200, code 40003)", async () => {
    expect(await deepseek.detect(fixtureHttp(ORIGIN, fixture("deepseek"), "deepseek-local", { getItem: () => null }).http)).toBe(false);
    const routes = { ...fixture("deepseek"), "/api/v0/users/current": { code: 40003, msg: "Authorization Failed (invalid token)", data: null } };
    expect(await deepseek.detect(open(routes).http)).toBe(false);
  });
  it("throws provider-error on another API error code", async () => {
    const routes = { ...fixture("deepseek"), "/api/v0/users/current": { code: 0, msg: "", data: { biz_code: 7, biz_msg: "busy", biz_data: null } } };
    expect(await code(deepseek.detect(open(routes).http))).toMatch(/^provider-error: deepseek: .*busy/);
  });
});

describe("deepseek list", () => {
  it("reads the pinned list, then pages the rest by updated_at and id", async () => {
    const f = open();
    const first = await deepseek.listConversations(f.http);
    expect(first.items).toEqual([{ id: S1, title: "Lisbon ideas", updatedAt: "2026-08-06T07:08:43.456Z" }]);
    const second = await deepseek.listConversations(f.http, first.next);
    expect(second.items.map((s) => s.id)).toEqual([S2]);
    const third = await deepseek.listConversations(f.http, second.next);
    expect([third.items.map((s) => s.id), third.next]).toEqual([[S3], undefined]);
  });
  it("throws provider-schema when the list shape changes", async () => {
    const routes = { ...fixture("deepseek"), "/api/v0/chat_session/fetch_page?lte_cursor.pinned=true": { code: 0, data: { biz_code: 0, biz_data: { sessions: [] } } } };
    expect(await code(deepseek.listConversations(open(routes).http))).toMatch(/^provider-schema: deepseek: .*chat_sessions/);
  });
});

describe("deepseek conversations", () => {
  it("follows current_message_id back to the root, with REQUEST and RESPONSE text only (P2, P4)", async () => {
    const c = await deepseek.getConversation(open().http, stub(S1));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "deepseek", id: S1, title: "Lisbon ideas", createdAt: "2026-08-06T07:06:40.100Z", updatedAt: "2026-08-06T07:08:43.456Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Ideas for Lisbon?"],
      ["assistant", "Try Alfama and Belem."],
    ]);
    expect(c.messages[0]!.attachments).toEqual([{ name: "budget.xlsx", id: "file-1", size: 2048 }]);
    expect(c.messages[1]!.createdAt).toBe("2026-08-06T07:07:00.500Z");
  });
  it("reads the older flat shape, and an empty chat", async () => {
    expect((await deepseek.getConversation(open().http, stub(S2))).messages.map((m) => m.text)).toEqual(["Old style question", "Old style answer"]);
    expect((await deepseek.getConversation(open().http, stub(S3))).messages).toEqual([]);
  });
  it("throws provider-schema on an unknown role", async () => {
    const routes = fixture("deepseek");
    const key = `/api/v0/chat/history_messages?chat_session_id=${S2}`;
    const bad = structuredClone(routes[key]) as { data: { biz_data: { chat_messages: Array<{ role: string }> } } };
    bad.data.biz_data.chat_messages[0]!.role = "ROBOT";
    expect(await code(deepseek.getConversation(open({ ...routes, [key]: bad }).http, stub(S2)))).toMatch(/^provider-schema: deepseek: .*role/);
  });
});
