import { describe, expect, it } from "vitest";
import { FoxcacheError, check, chatgpt } from "../src/index.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const ORIGIN = "https://chatgpt.com";
const A = "6710aa00-1111-4222-8333-444455556666";
const B = "6710aa00-7777-4888-9999-000011112222";
const C = "6710aa00-aaaa-4bbb-8ccc-dddd00000003";
const GP = "g-p-0123456789abcdef0123456789abcdef";
const MAIN = "/backend-api/conversations?offset=0&limit=100&order=updated&is_archived=false&hide_snorlax=true";
const open = (routes = fixture("chatgpt")) => fixtureHttp(ORIGIN, routes, "chatgpt-session");
const stub = (id: string, updatedAt = "") => ({ id, title: "", updatedAt });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

async function listAll(http: ReturnType<typeof open>["http"]) {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const page = await chatgpt.listConversations(http, cursor);
    ids.push(...page.items.map((s) => s.id));
    if (!page.next) return ids;
    cursor = page.next;
  }
  throw new Error("the list did not end");
}

describe("chatgpt detect", () => {
  it("is signed in with a session token", async () => {
    expect(await chatgpt.detect(open().http)).toBe(true);
  });
  it("is signed out when the session has no token", async () => {
    expect(await chatgpt.detect(open({ ...fixture("chatgpt"), "/api/auth/session": {} }).http)).toBe(false);
  });
});

describe("chatgpt list", () => {
  it("pages the main list, the archived list and each project's list", async () => {
    const f = open();
    expect(await listAll(f.http)).toEqual([A, C, B]);
    const first = await chatgpt.listConversations(open().http);
    expect(first.items).toEqual([{ id: A, title: "Trip plan", updatedAt: "2026-10-14T18:30:00.654Z" }]);
  });
  it("pages by offset until offset + limit reaches total", async () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, title: "x", update_time: "2026-01-01T00:00:00Z" }));
    const routes = { ...fixture("chatgpt"), [MAIN]: { items, total: 150, limit: 100, offset: 0 }, [MAIN.replace("offset=0", "offset=100")]: { items: items.slice(0, 50).map((x) => ({ ...x, id: `y${x.id}` })), total: 150, limit: 100, offset: 100 } };
    const ids = await listAll(open(routes).http);
    expect(ids.filter((id) => id.startsWith("y"))).toHaveLength(50);
  });
  it("throws provider-schema when the list shape changes", async () => {
    expect(await code(chatgpt.listConversations(open({ ...fixture("chatgpt"), [MAIN]: { conversations: [] } }).http))).toMatch(/^provider-schema: chatgpt: .*items/);
  });
  it("throws provider-schema when total is missing, instead of ending after one page", async () => {
    const page = fixture("chatgpt")[MAIN] as Record<string, unknown>;
    expect(await code(chatgpt.listConversations(open({ ...fixture("chatgpt"), [MAIN]: { ...page, total: undefined } }).http))).toMatch(/^provider-schema: chatgpt: .*total/);
  });
});

describe("P2 the visible thread", () => {
  it("walks from current_node, without hidden, system, tool or reasoning nodes", async () => {
    const c = await chatgpt.getConversation(open().http, stub(A));
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "chatgpt", id: A, title: "Trip plan", model: "gpt-5", createdAt: "2025-10-01T09:00:00.123Z", updatedAt: "2025-10-14T18:30:00.654Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Plan a trip to Lisbon"],
      ["assistant", "Day 1: Alfama.\n\nDay 2: Belem."],
    ]);
    expect(c.messages[0]!.attachments).toEqual([{ name: "notes.pdf", id: "file-abc", mimeType: "application/pdf", size: 12345 }]);
    expect(c.messages[0]!.createdAt).toBe("2025-10-01T09:00:00.200Z");
  });
  it("keeps the later updatedAt of the list and the conversation", async () => {
    expect((await chatgpt.getConversation(open().http, stub(A, "2026-10-14T18:30:00.654Z"))).updatedAt).toBe("2026-10-14T18:30:00.654Z");
  });
  it("sets the project id of a project chat, and keeps hostile text as text", async () => {
    const c = await chatgpt.getConversation(open().http, stub(B));
    expect(c.projectId).toBe(GP);
    expect(c.messages[1]!.text).toContain("<script>");
  });
  it("throws provider-schema on a parent cycle or a missing current_node", async () => {
    const routes = fixture("chatgpt");
    const key = `/backend-api/conversation/${C}`;
    const base = routes[key] as { mapping: Record<string, { parent: string | null }> };
    const cycle = structuredClone(base);
    cycle.mapping.k1!.parent = "k1";
    expect(await code(chatgpt.getConversation(open({ ...routes, [key]: cycle }).http, stub(C)))).toMatch(/^provider-schema: chatgpt: .*cycle/);
    expect(await code(chatgpt.getConversation(open({ ...routes, [key]: { ...base, current_node: "gone" } }).http, stub(C)))).toMatch(/^provider-schema: chatgpt: .*current_node/);
  });
  it("throws provider-schema when a parent is not in the mapping (P7)", async () => {
    const routes = fixture("chatgpt");
    const key = `/backend-api/conversation/${A}`;
    const gap = structuredClone(routes[key]) as { mapping: Record<string, unknown> };
    delete gap.mapping.n2;
    delete gap.mapping.n3a;
    expect(await code(chatgpt.getConversation(open({ ...routes, [key]: gap }).http, stub(A)))).toMatch(/^provider-schema: chatgpt: message n3 has the parent n2, which is not in the conversation/);
  });
  it("throws provider-schema on a visible message with content it cannot read", async () => {
    const routes = fixture("chatgpt");
    const key = `/backend-api/conversation/${C}`;
    const bad = structuredClone(routes[key]) as { mapping: Record<string, { message: { content: unknown } }> };
    bad.mapping.k1!.message.content = { content_type: "hologram" };
    expect(await code(chatgpt.getConversation(open({ ...routes, [key]: bad }).http, stub(C)))).toMatch(/hologram/);
  });
});

describe("chatgpt projects, memories and preferences", () => {
  it("reads each project with its instructions and file metadata", async () => {
    expect(await chatgpt.projects!(open().http)).toEqual([{ provider: "chatgpt", id: GP, name: "Research", instructions: "Answer tersely. Cite papers.", files: [{ name: "paper.pdf", id: "file-xyz", mimeType: "application/pdf", size: 204800 }] }]);
  });
  it("reads the saved memories", async () => {
    expect(await chatgpt.memories!(open().http)).toEqual([
      { provider: "chatgpt", id: "0c1d2e3f-0000-4111-8222-333344445555", text: "Prefers metric units.", createdAt: "2025-06-15T15:06:40.000Z" },
      { provider: "chatgpt", id: "0c1d2e3f-0000-4111-8222-333344445556", text: "Is learning Portuguese." },
    ]);
  });
  it("reads the custom instructions as preferences, and leaves out empty ones", async () => {
    expect(await chatgpt.preferences!(open().http)).toEqual([
      { provider: "chatgpt", kind: "about-me", text: "Lives in Berlin." },
      { provider: "chatgpt", kind: "response-style", text: "Be concise." },
      { provider: "chatgpt", kind: "name", text: "Sam" },
      { provider: "chatgpt", kind: "occupation", text: "Engineer" },
    ]);
    const routes = { ...fixture("chatgpt"), "/backend-api/user_system_messages": { about_user_message: "", about_model_message: null } };
    expect(await chatgpt.preferences!(open(routes).http)).toEqual([]);
  });
});
