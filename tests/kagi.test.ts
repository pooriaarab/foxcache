import { describe, expect, it } from "vitest";
import { FoxcacheError, type Http, MAX_MESSAGES, check } from "../src/index.js";
import { MAX_SUBPAGES } from "../src/adapters/read.js";
import { kagi } from "../src/adapters/kagi.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const K1 = "77ec0000-0000-4000-8000-000000000001";
const K2 = "77ec0000-0000-4000-8000-000000000002";
const B1 = "79ea0000-0000-4000-8000-0000000000b1";
const INIT = "/api/init";
const LIST = "/api/conversations?limit=100&all=true";
const ONE = `/api/conversations/${K1}/init`;
const open = (routes: Routes = fixture("kagi")) => fixtureHttp(kagi, routes);
const stub = (id: string) => ({ id, title: "", updatedAt: "" });
const one = () => structuredClone(fixture("kagi")[ONE]) as { messages: { items: Array<Record<string, unknown>>; has_more: boolean } };
const row = (uuid: string, role = "user") => ({ uuid, role, content: `text ${uuid}`, created_at: "2026-09-05T07:00:00" });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("kagi detect (K1)", () => {
  it("is signed in when /api/init answers", async () => {
    expect(await kagi.detect(open().http)).toBe(true);
  });
  it("is signed out on a 401 or a 403", async () => {
    expect(await kagi.detect(open({ [INIT]: { $status: 401 } }).http)).toBe(false);
    expect(await kagi.detect(open({ [INIT]: { $status: 403 } }).http)).toBe(false);
  });
  it("throws provider-schema when /api/init has no settings", async () => {
    expect(await code(kagi.detect(open({ [INIT]: { conversations: {} } }).http))).toMatch(/^provider-schema: kagi: init.settings is not an object/);
  });
});

describe("kagi list", () => {
  it("reads wrapped and bare items, with naive times as UTC", async () => {
    expect(await kagi.listConversations(open().http)).toEqual({
      items: [
        { id: K1, title: "Trip to Porto", updatedAt: "2026-09-05T08:03:00.654Z" },
        { id: K2, title: "<b>Hostile</b> thread", updatedAt: "2026-08-20T19:01:00.000Z" },
      ],
      next: undefined,
    });
  });
  it("pages with after_id, the uuid of the last item", async () => {
    const all = fixture("kagi")[LIST] as { items: unknown[] };
    const routes = { ...fixture("kagi"), [LIST]: { items: [all.items[0]], has_more: true }, [`${LIST}&after_id=${K1}`]: { items: [all.items[1]], has_more: false } };
    const f = open(routes);
    const first = await kagi.listConversations(f.http);
    expect(first.next).toBe(K1);
    expect((await kagi.listConversations(f.http, first.next)).items.map((s) => s.id)).toEqual([K2]);
    expect(f.calls).toEqual([LIST, `${LIST}&after_id=${K1}`]);
  });
  it("K3 gives the same cursor for the same page, so the capture can see a loop", async () => {
    const all = fixture("kagi")[LIST] as { items: unknown[] };
    const page = { items: [all.items[0]], has_more: true };
    const routes = { ...fixture("kagi"), [LIST]: page, [`${LIST}&after_id=${K1}`]: page };
    expect((await kagi.listConversations(open(routes).http, K1)).next).toBe(K1);
  });
  it("K2 names the field when the list changed", async () => {
    expect(await code(kagi.listConversations(open({ [LIST]: { conversations: [] } }).http))).toMatch(/^provider-schema: kagi: conversations.items is not a list/);
    expect(await code(kagi.listConversations(open({ [LIST]: { items: [{ conversation: { uuid: K1 } }], has_more: false } }).http))).toMatch(/^provider-schema: kagi: conversations.items\[0\].updated_at is not a time/);
  });
  it("K6 passes a 429 on as rate-limited", async () => {
    expect(await code(kagi.listConversations(open({ [LIST]: { $status: 429 } }).http))).toMatch(/^rate-limited: /);
  });
});

describe("kagi conversations", () => {
  it("reads the active branch as Markdown, without thinking or HTML", async () => {
    const c = check("conversations", await kagi.getConversation(open().http, stub(K1)));
    expect(c).toMatchObject({ provider: "kagi", id: K1, title: "Trip to Porto", model: "synthetic-model", createdAt: "2026-09-05T08:00:00.123Z", updatedAt: "2026-09-05T08:03:00.654Z" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Two days in Porto?", "2026-09-05T08:00:00.123Z"],
      ["assistant", "Day 1: Ribeira.", "2026-09-05T08:01:00.000Z"],
      ["user", "And day 2?", "2026-09-05T08:02:00.000Z"],
      ["assistant", "Day 2: Foz.", "2026-09-05T08:03:00.654Z"],
    ]);
    expect(JSON.stringify(c)).not.toMatch(/hidden thinking|<p>/);
  });
  it("K7 keeps hostile text as text", async () => {
    const c = await kagi.getConversation(open().http, stub(K2));
    expect([c.title, ...c.messages.map((m) => m.text)]).toEqual(["<b>Hostile</b> thread", '<img src=x onerror="document.title=1">', "<script>alert(1)</script> stays text."]);
  });
  it("K2 names a message whose role is new", async () => {
    const c = one();
    c.messages.items[1]!.role = "robot";
    expect(await code(kagi.getConversation(open({ [ONE]: c }).http, stub(K1)))).toMatch(/^provider-schema: kagi: messages\[1\].role is "robot"/);
  });
  it("puts older pages first, each read newest first", async () => {
    const c = one();
    c.messages.has_more = true;
    const older = `/api/branches/${B1}/messages?limit=100&after_id=m1`;
    const f = open({ [ONE]: c, [older]: { messages: { items: [row("m0", "assistant"), row("m-1")], has_more: false } } });
    const got = await kagi.getConversation(f.http, stub(K1));
    expect(got.messages.map((m) => m.text)).toEqual(["text m-1", "text m0", "Two days in Porto?", "Day 1: Ribeira.", "And day 2?", "Day 2: Foz."]);
    expect(f.calls).toEqual([ONE, older]);
  });
});

/** Kagi for one conversation whose older-message pages each have size rows. */
function endless(size: number, fresh: boolean) {
  let calls = 0;
  const page = () => ({ items: Array.from({ length: size }, (_, i) => row(fresh ? `p${calls}-${i}` : `same-${i}`)), has_more: true });
  const http: Http = {
    post: async () => {
      throw new Error("no POST read here");
    },
    async get(path) {
      calls += 1;
      if (path === ONE) return { ...one(), messages: { items: [row("first")], has_more: true } };
      return { messages: page() };
    },
  };
  return { http, calls: () => calls };
}

describe("kagi older-message pages (K4, K5)", () => {
  it("throws pagination-loop when a page comes again", async () => {
    expect(await code(kagi.getConversation(endless(1, false).http, stub(K1)))).toMatch(/^pagination-loop: kagi: the older messages gave the same page again/);
  });
  it("throws pagination-loop when the pages never end", async () => {
    const f = endless(1, true);
    expect(await code(kagi.getConversation(f.http, stub(K1)))).toMatch(/^pagination-loop: kagi: the older messages did not end after 1000 pages/);
    expect(f.calls()).toBe(MAX_SUBPAGES + 1);
  });
  it("throws too-large while it reads, once the chat passes the message limit", async () => {
    const f = endless(1000, true);
    expect(await code(kagi.getConversation(f.http, stub(K1)))).toMatch(/^too-large: kagi: /);
    expect(f.calls()).toBe(MAX_MESSAGES / 1000 + 1);
  });
});

describe("kagi context", () => {
  it("reads the custom instructions, and none when they are empty", async () => {
    expect(await kagi.preferences!(open().http)).toEqual([{ provider: "kagi", kind: "instructions", text: "Answer in British English." }]);
    const init = structuredClone(fixture("kagi")[INIT]) as { settings: { custom_instructions: unknown } };
    init.settings.custom_instructions = null;
    expect(await kagi.preferences!(open({ [INIT]: init }).http)).toEqual([]);
  });
  it("lists the custom assistants by name, without their instructions", async () => {
    const items = await kagi.library!(open().http);
    expect(items.map((i) => check("library", i))).toEqual([{ provider: "kagi", id: "46890000-0000-4000-8000-0000000000a1", name: "Research helper", kind: "agent" }]);
    expect(JSON.stringify(items)).not.toContain("Synthetic assistant instructions");
  });
});
