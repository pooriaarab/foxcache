import { describe, expect, it } from "vitest";
import { FoxcacheError, check, claude } from "../src/index.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const ORIGIN = "https://claude.ai";
const ORG = "/api/organizations/00000000-0000-4000-8000-0000000000aa";
const C1 = "aaaaaaaa-0000-4000-8000-000000000001";
const C2 = "aaaaaaaa-0000-4000-8000-000000000002";
const DETAIL = "?tree=True&rendering_mode=messages&render_all_tools=true";
const LIST = `${ORG}/chat_conversations_v2?limit=50&offset=0&consistency=strong`;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("claude detect and list", () => {
  it("is signed in when the account has a chat organization", async () => {
    expect(await claude.detect(fixtureHttp(ORIGIN, fixture("claude")).http)).toBe(true);
  });
  it("is signed out on a 401, and when no organization can chat", async () => {
    expect(await claude.detect(fixtureHttp(ORIGIN, { "/api/organizations": { $status: 401 } }).http)).toBe(false);
    expect(await claude.detect(fixtureHttp(ORIGIN, { "/api/organizations": [{ uuid: "o", capabilities: ["api"] }] }).http)).toBe(false);
  });
  it("lists the stubs of a page, newest first, and pages by offset", async () => {
    const page = await claude.listConversations(fixtureHttp(ORIGIN, fixture("claude")).http);
    expect(page).toEqual({ items: [{ id: C1, title: "Trip planning", updatedAt: "2026-09-02T08:15:30.123Z" }, { id: C2, title: "<b>Hostile</b> title", updatedAt: "2026-08-01T09:05:00.000Z" }], next: undefined });
    const routes = { ...fixture("claude"), [LIST]: { data: [{ uuid: "x1", name: "a", updated_at: "2026-01-02T00:00:00Z" }], has_more: true } };
    expect((await claude.listConversations(fixtureHttp(ORIGIN, routes).http)).next).toBe("1");
  });
  it("asks for the organization once per capture", async () => {
    const f = fixtureHttp(ORIGIN, fixture("claude"));
    await claude.listConversations(f.http);
    await claude.getConversation(f.http, { id: C1, title: "", updatedAt: "" });
    expect(f.calls.filter((c) => c === "/api/organizations")).toHaveLength(1);
  });
});

describe("P3 branches", () => {
  it("follows current_leaf_message_uuid back to the root, with text blocks only", async () => {
    const c = await claude.getConversation(fixtureHttp(ORIGIN, fixture("claude")).http, { id: C1, title: "", updatedAt: "" });
    expect(check("conversations", c)).toEqual(c);
    expect(c).toMatchObject({ provider: "claude", id: C1, title: "Trip planning", model: "claude-sonnet-4-6", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-02T08:15:30.123Z" });
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Plan 3 days in Lisbon"],
      ["assistant", "Day 1: Alfama.\n\nDay 2: Belem."],
    ]);
  });
  it("throws provider-schema on a cycle or a missing leaf", async () => {
    const routes = fixture("claude");
    const key = `${ORG}/chat_conversations/${C1}${DETAIL}`;
    const base = routes[key] as { chat_messages: Array<{ uuid: string; parent_message_uuid: string }> };
    const cycle = structuredClone(base);
    cycle.chat_messages[0]!.parent_message_uuid = cycle.chat_messages[2]!.uuid;
    expect(await code(claude.getConversation(fixtureHttp(ORIGIN, { ...routes, [key]: cycle }).http, { id: C1, title: "", updatedAt: "" }))).toMatch(/^provider-schema: claude: .*cycle/);
    expect(await code(claude.getConversation(fixtureHttp(ORIGIN, { ...routes, [key]: { ...base, current_leaf_message_uuid: "nope" } }).http, { id: C1, title: "", updatedAt: "" }))).toMatch(/^provider-schema: claude: .*leaf/);
  });
});

describe("P1 changed shapes", () => {
  it.each([
    ["the list is not {data}", LIST, [], /chat_conversations_v2/],
    ["a stub has no uuid", LIST, { data: [{ name: "x", updated_at: "2026-01-01T00:00:00Z" }], has_more: false }, /uuid/],
    ["a time is not a time", LIST, { data: [{ uuid: "x", name: "x", updated_at: 17 }], has_more: false }, /updated_at/],
  ])("throws provider-schema when %s", async (_n, key, body, want) => {
    const routes = { ...fixture("claude"), [key]: body };
    const e = await code(claude.listConversations(fixtureHttp(ORIGIN, routes).http));
    expect(e).toMatch(/^provider-schema: claude: /);
    expect(e).toMatch(want);
  });
  it("throws provider-schema when a message has no sender", async () => {
    const routes = fixture("claude");
    const key = `${ORG}/chat_conversations/${C2}${DETAIL}`;
    const bad = structuredClone(routes[key]) as { chat_messages: Array<Record<string, unknown>> };
    delete bad.chat_messages[0]!.sender;
    expect(await code(claude.getConversation(fixtureHttp(ORIGIN, { ...routes, [key]: bad }).http, { id: C2, title: "", updatedAt: "" }))).toMatch(/sender/);
  });
});

describe("P5 attachments are metadata", () => {
  it("keeps names, ids and sizes, never the extracted text", async () => {
    const c = await claude.getConversation(fixtureHttp(ORIGIN, fixture("claude")).http, { id: C1, title: "", updatedAt: "" });
    expect(c.messages[0]!.attachments).toEqual([
      { name: "notes.txt", id: "cccccccc-0000-4000-8000-000000000001", size: 120 },
      { name: "map.png", id: "dddddddd-0000-4000-8000-000000000001" },
    ]);
    expect(JSON.stringify(c)).not.toContain("Budget 500 EUR");
  });
  it("keeps the project id and the text of a message with no content blocks", async () => {
    const c = await claude.getConversation(fixtureHttp(ORIGIN, fixture("claude")).http, { id: C2, title: "", updatedAt: "" });
    expect(c.projectId).toBe("eeeeeeee-0000-4000-8000-000000000001");
    expect(c.messages[0]!.text).toMatch(/^Show me this: <img src=x/);
  });
});

describe("claude projects, memory and preferences", () => {
  it("reads a project with its instructions and file names only", async () => {
    const [p, ...rest] = await claude.projects!(fixtureHttp(ORIGIN, fixture("claude")).http);
    expect(rest).toEqual([]);
    expect(p).toEqual({
      provider: "claude",
      id: "eeeeeeee-0000-4000-8000-000000000001",
      name: "Thesis",
      instructions: "Answer as a careful reviewer. Cite sources.",
      files: [
        { name: "outline.md", id: "ffffffff-0000-4000-8000-000000000001" },
        { name: "paper.pdf", id: "ffffffff-0000-4000-8000-000000000002" },
      ],
    });
  });
  it("splits the memory into one memory per line, without headings or bullets", async () => {
    expect(await claude.memories!(fixtureHttp(ORIGIN, fixture("claude")).http)).toEqual([
      { provider: "claude", text: "Writes a PhD thesis on tides." },
      { provider: "claude", text: "Prefers British spelling." },
      { provider: "claude", text: "Lives in Lisbon." },
    ]);
  });
  it("reads the personal preferences, and nothing when they are empty", async () => {
    expect(await claude.preferences!(fixtureHttp(ORIGIN, fixture("claude")).http)).toEqual([{ provider: "claude", kind: "response-style", text: "Keep answers short. Use metric units." }]);
    expect(await claude.preferences!(fixtureHttp(ORIGIN, { "/api/account_profile": { conversation_preferences: null } }).http)).toEqual([]);
  });
});
