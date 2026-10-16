// app.notion.com (Notion AI chats). The session cookie token_v2 is
// HttpOnly, so the cookies alone (auth cookie). Every read is a JSON POST
// under /api/v3/. Endpoints and sources: docs/providers/notion.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message, type Role } from "../schema.js";
import { type Obj, reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("notion");
const MCP = "https://github.com/nmt3325/notion-ai-mcp/blob/7f2ff404059f8abb90ec2a3ef7ad6637b763cd07/src/notion-client.ts";
const CONNECTOR = "https://github.com/roman-prizrakjj/notion-agent-connector/blob/89a8ac1c65223cf3f98a76c805a0029998ad4f80/notion_client.py";
const PAGE = 50;
/** Message ids per record request, as the connector sends. */
const BATCH = 50;

/** A record of a recordMap: {value: {value: record, role}} or the older {value: record}. */
function record(x: unknown, where: string): Obj {
  const outer = r.obj(r.obj(x, where).value, `${where}.value`);
  return typeof outer.value === "object" && outer.value !== null && !Array.isArray(outer.value) ? (outer.value as Obj) : outer;
}
/** Epoch milliseconds, as ISO-8601 UTC (P4). */
const ms = (x: unknown, where: string) => r.seconds(r.num(x, where) / 1000, where);

/** The user's workspace ids, from loadUserContent (signed out: none). */
async function spaces(http: Http): Promise<string[]> {
  const map = r.obj(r.obj(await http.post("/api/v3/loadUserContent", {}), "loadUserContent").recordMap, "loadUserContent.recordMap");
  const users = Object.keys(r.obj(map.notion_user ?? {}, "recordMap.notion_user"));
  const roots = r.obj(map.user_root ?? {}, "recordMap.user_root");
  const user = users.find((id) => roots[id] !== undefined);
  if (!user) return [];
  const pointers = r.arr(record(roots[user], `user_root[${user}]`).space_view_pointers, "user_root.space_view_pointers");
  return [...new Set(pointers.map((p, i) => r.str(r.obj(p, `space_view_pointers[${i}]`).spaceId, `space_view_pointers[${i}].spaceId`)))];
}

/** Records of one table, from syncRecordValuesSpaceInitial. */
async function records(http: Http, space: string, table: "thread" | "thread_message", ids: string[]): Promise<Obj> {
  const body = { requests: ids.map((id) => ({ pointer: { table, id, spaceId: space }, version: -1 })), spacePointer: { table: "space", id: space } };
  const map = r.obj(r.obj(await http.post("/api/v3/syncRecordValuesSpaceInitial", body), "syncRecordValues").recordMap, "syncRecordValues.recordMap");
  return r.obj(map[table] ?? {}, `recordMap.${table}`);
}

/** Notion rich text, [[text, marks], ...], as plain text. */
function richText(x: unknown, where: string): string {
  if (typeof x === "string") return x;
  return r.arr(x, where).map((part, i) => r.str(r.arr(part, `${where}[${i}]`)[0], `${where}[${i}][0]`)).join("");
}

/** The role and text the Notion page shows for a step, or undefined for a step it hides. */
function visible(step: Obj, where: string): { role: Role; text: string } | undefined {
  const type = r.str(step.type, `${where}.type`);
  if (type === "user") return { role: "user", text: richText(step.displayValue ?? step.value, `${where}.value`) };
  if (type === "user-injected") return step.displayMessage === undefined ? undefined : { role: "user", text: richText(step.displayMessage, `${where}.displayMessage`) };
  if (type === "markdown-chat" || type === "fast-researcher-chat") return { role: "assistant", text: r.str(step.value, `${where}.value`) };
  if (type !== "agent-inference") return undefined;
  if (typeof step.value === "string") return { role: "assistant", text: step.value };
  const parts = r.arr(step.value, `${where}.value`).map((p, i) => r.obj(p, `${where}.value[${i}]`));
  return { role: "assistant", text: parts.filter((p) => p.type === "text").map((p, i) => r.str(p.content, `${where}.value[${i}].content`)).join("") };
}

export const notion: Adapter = {
  id: "notion",
  label: "Notion AI",
  origin: "https://app.notion.com",
  auth: cookie,
  // Three read operations, each its own path. The writes beside them are under "Never call" in the doc.
  reads: defineReads([
    { method: "POST", path: "/api/v3/loadUserContent", body: { type: "json", match: {}, keys: [] }, source: "https://github.com/jamalex/notion-py/blob/f31081edef26882298eb0c31cf023e810a2a9a09/notion/client.py#L124-L133" },
    { method: "POST", path: "/api/v3/getInferenceTranscriptsForUser", body: { type: "json", match: { "threadParentPointer.table": "space" }, keys: ["threadParentPointer", "limit", "includeWriterChats", "includeWorkflowThreads", "cursor"] }, source: `${MCP}#L549-L551` },
    { method: "POST", path: "/api/v3/syncRecordValuesSpaceInitial", body: { type: "json", match: { "spacePointer.table": "space" }, keys: ["requests", "spacePointer"] }, source: `${CONNECTOR}#L217-L243` },
  ]),
  // No source gives the order of the list.
  newestFirst: false,

  async detect(http) {
    try {
      return (await spaces(http)).length > 0;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  // The cursor is [workspace id, Notion's cursor or null]. The workspaces go in id order, not sidebar order, so a reordered sidebar cannot send one workspace's cursor to another (N40).
  async listConversations(http, cursor) {
    const all = (await spaces(http)).toSorted();
    const [space, notionCursor] = cursor ? (JSON.parse(cursor) as [unknown, string | null]) : [all[0], null];
    if (space === undefined) return { items: [] };
    if (typeof space !== "string") throw r.fail("the list cursor", "does not name a workspace");
    const after = (id: string) => all.find((s) => s > id);
    if (!all.includes(space)) {
      // The workspace is gone since the cursor was saved: go on with the next one.
      const next = after(space);
      return { items: [], next: next === undefined ? undefined : JSON.stringify([next, null]) };
    }
    const body = { threadParentPointer: { table: "space", id: space, spaceId: space }, limit: PAGE, includeWriterChats: false, includeWorkflowThreads: true, ...(notionCursor ? { cursor: notionCursor } : {}) };
    const page = r.obj(await http.post("/api/v3/getInferenceTranscriptsForUser", body), "getInferenceTranscriptsForUser");
    const items = r.arr(page.transcripts, "transcripts").map((x, i) => {
      const t = r.obj(x, `transcripts[${i}]`);
      return { id: `${space}:${r.str(t.id, `transcripts[${i}].id`)}`, title: r.optStr(t.title, `transcripts[${i}].title`) ?? "", updatedAt: ms(t.updated_at, `transcripts[${i}].updated_at`) };
    });
    if (r.bool(page.hasMore, "hasMore")) return { items, next: JSON.stringify([space, r.str(page.nextCursor, "nextCursor")]) };
    const next = after(space);
    return { items, next: next === undefined ? undefined : JSON.stringify([next, null]) };
  },

  async getConversation(http, stub) {
    const [space, thread, extra] = stub.id.split(":");
    if (!space || !thread || extra !== undefined) throw r.fail(`conversation id ${JSON.stringify(stub.id)}`, "is not <space>:<thread>");
    const threads = await records(http, space, "thread", [thread]);
    if (threads[thread] === undefined) throw r.fail(`thread ${thread}`, "is not in the answer");
    const t = record(threads[thread], `thread ${thread}`);
    const ids = r.arr(t.messages, "thread.messages").map((id, i) => r.str(id, `thread.messages[${i}]`));
    if (ids.length > MAX_MESSAGES) throw new FoxcacheError("too-large", `notion: the chat has ${ids.length} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
    const steps: Obj = {};
    for (let i = 0; i < ids.length; i += BATCH) Object.assign(steps, await records(http, space, "thread_message", ids.slice(i, i + BATCH)));
    const messages: Message[] = [];
    for (const id of ids) {
      const where = `thread_message ${id}`;
      if (steps[id] === undefined) throw r.fail(where, "is not in the answer");
      const m = record(steps[id], where);
      const shown = visible(r.obj(m.step, `${where}.step`), `${where}.step`);
      if (shown && shown.text.trim()) messages.push({ ...shown, createdAt: ms(m.created_time, `${where}.created_time`), attachments: [] });
    }
    const title = stub.title || (r.optStr(r.obj(t.data ?? {}, "thread.data").title, "thread.data.title") ?? "");
    return { provider: "notion", id: stub.id, title, createdAt: ms(t.created_time, "thread.created_time"), updatedAt: ms(t.updated_time, "thread.updated_time"), messages };
  },
};
