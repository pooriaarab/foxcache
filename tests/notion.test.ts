import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_MESSAGES, check } from "../src/index.js";
import { notion } from "../src/adapters/notion.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const S = "5b1e0000-0000-4000-8000-0000000000a1";
const S2 = "5b1e0000-0000-4000-8000-0000000000a2";
const T1 = "3d4e0000-0000-4000-8000-000000000001";
const T2 = "3d4e0000-0000-4000-8000-000000000002";
const USER = "POST /api/v3/loadUserContent";
const LIST = "POST /api/v3/getInferenceTranscriptsForUser";
const RECORDS = "POST /api/v3/syncRecordValuesSpaceInitial";
const open = (routes: Routes = fixture("notion")) => fixtureHttp(notion, routes);
const stub = (thread: string, title = "") => ({ id: `${S}:${thread}`, title, updatedAt: "" });
/** The route of one list page: the exact body the adapter sends. */
const listKey = (space: string, cursor?: string) => `${LIST} ${JSON.stringify({ threadParentPointer: { table: "space", id: space, spaceId: space }, limit: 50, includeWriterChats: false, includeWorkflowThreads: true, ...(cursor ? { cursor } : {}) })}`;
const page = (ids: string[], more: { hasMore: boolean; nextCursor?: string | null }) => ({ transcripts: ids.map((id) => ({ id, title: `chat ${id.slice(-1)}`, created_at: 1_790_000_000_000, updated_at: 1_790_000_100_000 })), ...more });
const records = (): { recordMap: { thread: Record<string, { value: { value: Record<string, unknown> } }>; thread_message: Record<string, unknown> } } => structuredClone(fixture("notion")[RECORDS]) as never;

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("notion detect (NO1)", () => {
  it("is signed in when loadUserContent has a user", async () => {
    expect(await notion.detect(open().http)).toBe(true);
  });
  it("is signed out on a 401, a 403, or an answer with no user", async () => {
    expect(await notion.detect(open({ [USER]: { $status: 401 } }).http)).toBe(false);
    expect(await notion.detect(open({ [USER]: { $status: 403 } }).http)).toBe(false);
    expect(await notion.detect(open({ [USER]: { recordMap: { notion_user: {} } } }).http)).toBe(false);
  });
  it("throws provider-schema when the answer has no recordMap", async () => {
    expect(await code(notion.detect(open({ [USER]: { users: [] } }).http))).toMatch(/^provider-schema: notion: loadUserContent.recordMap is not an object/);
  });
});

describe("notion list", () => {
  it("lists the AI chats of the workspace with ISO times", async () => {
    const f = open();
    expect(await notion.listConversations(f.http)).toEqual({
      items: [
        { id: `${S}:${T1}`, title: "Plan the offsite", updatedAt: "2026-09-02T09:01:04.000Z" },
        { id: `${S}:${T2}`, title: "<b>Hostile</b> notes", updatedAt: "2026-08-10T12:00:03.000Z" },
      ],
      next: undefined,
    });
    expect(f.calls).toEqual([USER, LIST]);
  });
  it("NO2 names the field when the list changed", async () => {
    expect(await code(notion.listConversations(open({ ...fixture("notion"), [LIST]: { threads: [] } }).http))).toMatch(/^provider-schema: notion: transcripts is not a list/);
  });
  it("NO3 follows nextCursor, and fails when hasMore comes with no cursor", async () => {
    const routes = { ...fixture("notion"), [listKey(S)]: page([T1], { hasMore: true, nextCursor: "c-2" }), [listKey(S, "c-2")]: page([T2], { hasMore: false, nextCursor: null }) };
    const first = await notion.listConversations(open(routes).http);
    expect(first.items.map((s) => s.id)).toEqual([`${S}:${T1}`]);
    const second = await notion.listConversations(open(routes).http, first.next);
    expect(second).toMatchObject({ items: [{ id: `${S}:${T2}` }], next: undefined });
    expect(await code(notion.listConversations(open({ ...routes, [listKey(S)]: page([T1], { hasMore: true }) }).http))).toMatch(/^provider-schema: notion: nextCursor is not text/);
  });
  it("NO3 gives the same cursor for the same page, so the capture can see a loop", async () => {
    const routes = { ...fixture("notion"), [listKey(S)]: page([T1], { hasMore: true, nextCursor: "same" }), [listKey(S, "same")]: page([T1], { hasMore: true, nextCursor: "same" }) };
    const first = await notion.listConversations(open(routes).http);
    expect((await notion.listConversations(open(routes).http, first.next)).next).toBe(first.next);
  });
  it("NO6 lists each workspace in turn", async () => {
    const user = structuredClone(fixture("notion")[USER]) as { recordMap: { user_root: Record<string, { value: { value: { space_view_pointers: unknown[] } } }> } };
    Object.values(user.recordMap.user_root)[0]!.value.value.space_view_pointers.push({ id: "6a000000-0000-4000-8000-0000000000c2", spaceId: S2, table: "space_view" });
    const routes = { ...fixture("notion"), [USER]: user, [listKey(S)]: page([T1], { hasMore: false }), [listKey(S2)]: page([T2], { hasMore: false }) };
    const first = await notion.listConversations(open(routes).http);
    expect(first.items.map((s) => s.id)).toEqual([`${S}:${T1}`]);
    const second = await notion.listConversations(open(routes).http, first.next);
    expect(second).toEqual({ items: [{ id: `${S2}:${T2}`, title: "chat 2", updatedAt: "2026-09-21T14:15:00.000Z" }], next: undefined });
  });
  it("NO40 resumes in the same workspace after the sidebar is reordered, and passes one that is gone", async () => {
    type User = { recordMap: { user_root: Record<string, { value: { value: { space_view_pointers: unknown[] } } }> } };
    const withSpaces = (ids: string[]) => {
      const user = structuredClone(fixture("notion")[USER]) as User;
      Object.values(user.recordMap.user_root)[0]!.value.value.space_view_pointers = ids.map((spaceId, i) => ({ id: `6a000000-0000-4000-8000-0000000000c${i}`, spaceId, table: "space_view" }));
      return { ...fixture("notion"), [USER]: user, [listKey(S)]: page([T1], { hasMore: true, nextCursor: "s-2" }), [listKey(S, "s-2")]: page([T2], { hasMore: false }), [listKey(S2)]: page(["3d4e0000-0000-4000-8000-000000000009"], { hasMore: false }) };
    };
    const first = await notion.listConversations(open(withSpaces([S, S2])).http);
    expect(first.items.map((s) => s.id)).toEqual([`${S}:${T1}`]);
    const resumed = await notion.listConversations(open(withSpaces([S2, S])).http, first.next);
    expect(resumed.items.map((s) => s.id)).toEqual([`${S}:${T2}`]);
    const gone = await notion.listConversations(open(withSpaces([S2])).http, first.next);
    expect(gone.items).toEqual([]);
    expect((await notion.listConversations(open(withSpaces([S2])).http, gone.next)).items.map((s) => s.id)).toEqual([`${S2}:3d4e0000-0000-4000-8000-000000000009`]);
  });
  it("NO7 passes a 429 on as rate-limited", async () => {
    expect(await code(notion.listConversations(open({ ...fixture("notion"), [LIST]: { $status: 429 } }).http))).toMatch(/^rate-limited: /);
  });
});

describe("notion conversations", () => {
  it("reads the visible thread: user and assistant text, no config, context, tools or thinking", async () => {
    const f = open();
    const c = check("conversations", await notion.getConversation(f.http, stub(T1, "Plan the offsite")));
    expect(c).toMatchObject({ provider: "notion", id: `${S}:${T1}`, title: "Plan the offsite", createdAt: "2026-09-02T09:00:00.000Z", updatedAt: "2026-09-02T09:01:04.000Z" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "Plan a team offsite in Lisbon", "2026-09-02T09:00:01.000Z"],
      ["assistant", "Day 1: Alfama walk.", "2026-09-02T09:00:05.000Z"],
      ["user", "Add a dinner", "2026-09-02T09:01:00.000Z"],
      ["assistant", "Dinner at 8 in Belem.", "2026-09-02T09:01:04.000Z"],
    ]);
    expect(f.calls).toEqual([RECORDS, RECORDS]);
    expect(JSON.stringify(c)).not.toMatch(/synthetic-codename|Synthetic Space|The user wants a plan/);
  });
  it("NO8 keeps hostile text as text, from the older record envelope", async () => {
    const c = await notion.getConversation(open().http, stub(T2));
    expect([c.title, ...c.messages.map((m) => m.text)]).toEqual(["<b>Hostile</b> notes", '<img src=x onerror="document.title=1">', "Kept as text."]);
  });
  it("NO2 names the step when its type is not text", async () => {
    const r = records();
    (Object.values(r.recordMap.thread_message)[2] as { value: { value: { step: { type: unknown } } } }).value.value.step.type = 7;
    expect(await code(notion.getConversation(open({ [RECORDS]: r }).http, stub(T1)))).toMatch(/^provider-schema: notion: thread_message .*\.step\.type is not text/);
  });
  it("NO2 refuses an id that is not <space>:<thread>", async () => {
    expect(await code(notion.getConversation(open().http, { id: T1, title: "", updatedAt: "" }))).toMatch(/^provider-schema: notion: conversation id /);
  });
  it("NO4 names a message the record answer does not hold", async () => {
    const r = records();
    r.recordMap.thread[T1]!.value.value.messages = [...(r.recordMap.thread[T1]!.value.value.messages as string[]), "9f00ffff-0000-4000-8000-000000000000"];
    expect(await code(notion.getConversation(open({ [RECORDS]: r }).http, stub(T1)))).toMatch(/^provider-schema: notion: thread_message 9f00ffff-0000-4000-8000-000000000000 is not in the answer/);
  });
  it("NO5 refuses a thread longer than foxcache keeps, before it reads a message", async () => {
    const r = records();
    r.recordMap.thread[T1]!.value.value.messages = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => `m-${i}`);
    const f = open({ [RECORDS]: r });
    expect(await code(notion.getConversation(f.http, stub(T1)))).toMatch(/^too-large: notion: /);
    expect(f.calls).toHaveLength(1);
  });
  it("reads the messages 50 ids a request", async () => {
    const r = records();
    const ids = Array.from({ length: 120 }, (_, i) => `9e00${String(i).padStart(4, "0")}-0000-4000-8000-000000000000`);
    r.recordMap.thread[T1]!.value.value.messages = ids;
    for (const id of ids) r.recordMap.thread_message[id] = { value: { id, created_time: 1_790_000_000_000, step: { id, type: "user", value: [["hi"]] } } };
    const f = open({ [RECORDS]: r });
    expect((await notion.getConversation(f.http, stub(T1))).messages).toHaveLength(120);
    expect(f.calls).toHaveLength(4);
  });
});
