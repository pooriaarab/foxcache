// chat.deepseek.com. The page keeps a bearer token in localStorage
// "userToken"; http reads it there and keeps it (auth "deepseek-local").
// Endpoints and sources: docs/providers/deepseek.md.
import { FoxcacheError } from "../errors.js";
import type { Http, Query } from "../http.js";
import type { Message } from "../schema.js";
import type { Adapter } from "./types.js";
import { type Obj, pathToRoot, reader } from "./read.js";

const r = reader("deepseek");
/** The fragments that are the visible text. THINK, TOOL_* and TIP are not. */
const VISIBLE = new Set(["REQUEST", "RESPONSE"]);

/** Every answer is {code, msg, data: {biz_code, biz_msg, biz_data}}, and an error can come with HTTP 200. */
async function biz(http: Http, path: string, query?: Query): Promise<Obj> {
  const env = r.obj(await http.get(path, query), path);
  if (env.code === 40003) throw new FoxcacheError("logged-out", `deepseek: ${path} says the session is not valid: sign in again.`);
  if (env.code !== 0) throw new FoxcacheError("provider-error", `deepseek: ${path} answered code ${String(env.code)}: ${String(env.msg ?? "")}`);
  const data = r.obj(env.data, `${path} data`);
  if (data.biz_code !== 0) throw new FoxcacheError("provider-error", `deepseek: ${path} answered biz_code ${String(data.biz_code)}: ${String(data.biz_msg ?? "")}`);
  return r.obj(data.biz_data, `${path} biz_data`);
}

interface Cursor {
  pinned: boolean;
  updatedAt?: number;
  id?: string;
}

function messageText(m: Obj, where: string): string {
  if (Array.isArray(m.fragments)) {
    return m.fragments
      .map((f, i) => r.obj(f, `${where}.fragments[${i}]`))
      .filter((f) => VISIBLE.has(r.str(f.type, `${where}.fragments.type`)))
      .map((f, i) => r.optStr(f.content, `${where}.fragments[${i}].content`) ?? "")
      .join("\n\n");
  }
  return r.optStr(m.content, `${where}.content`) ?? "";
}

export const deepseek: Adapter = {
  id: "deepseek",
  label: "DeepSeek",
  origin: "https://chat.deepseek.com",
  auth: "deepseek-local",
  // Pinned chats come first, so a page with no change does not mean the rest is unchanged.
  newestFirst: false,

  async detect(http) {
    try {
      await biz(http, "/api/v0/users/current");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const c: Cursor = cursor ? (JSON.parse(cursor) as Cursor) : { pinned: true };
    const query: Query = { "lte_cursor.pinned": c.pinned, "lte_cursor.updated_at": c.updatedAt, "lte_cursor.id": c.id };
    const page = await biz(http, "/api/v0/chat_session/fetch_page", query);
    const rows = r.arr(page.chat_sessions, "fetch_page chat_sessions").map((s, i) => r.obj(s, `fetch_page chat_sessions[${i}]`));
    const items = rows.map((s, i) => ({ id: r.str(s.id, `chat_sessions[${i}].id`), title: r.optStr(s.title, `chat_sessions[${i}].title`) ?? "", updatedAt: r.seconds(s.updated_at, `chat_sessions[${i}].updated_at`) }));
    const last = rows.at(-1);
    let next: Cursor | undefined;
    if (r.bool(page.has_more, "fetch_page has_more") && last) next = { pinned: c.pinned, updatedAt: last.updated_at as number, id: items.at(-1)!.id };
    else if (c.pinned) next = { pinned: false };
    return { items, next: next && JSON.stringify(next) };
  },

  async getConversation(http, stub) {
    const data = await biz(http, "/api/v0/chat/history_messages", { chat_session_id: stub.id });
    const session = r.obj(data.chat_session, "chat_session");
    const list = r.arr(data.chat_messages, "chat_messages").map((m, i) => r.obj(m, `chat_messages[${i}]`));
    const byId = new Map(
      list.map((m, i) => {
        if (typeof m.message_id !== "number" && typeof m.message_id !== "string") throw r.fail(`chat_messages[${i}].message_id`, "is missing");
        return [String(m.message_id), m];
      }),
    );
    const leaf = session.current_message_id;
    if (list.length && (leaf === null || leaf === undefined || !byId.has(String(leaf)))) throw r.fail("chat_session.current_message_id", "is not a message of the chat (no leaf)");
    // The first message has parent_id null.
    const ids = list.length ? pathToRoot(String(leaf), (id) => (byId.get(id)!.parent_id === null ? undefined : String(byId.get(id)!.parent_id)), (id) => byId.has(id), r.fail) : [];
    const messages: Message[] = ids.map((id) => {
      const m = byId.get(id)!;
      const where = `message ${id}`;
      const role = r.str(m.role, `${where}.role`);
      if (role !== "USER" && role !== "ASSISTANT") throw r.fail(`${where}.role`, `is ${JSON.stringify(role)}`);
      const attachments = r.arr(m.files ?? [], `${where}.files`).map((f, i) => {
        const o = r.obj(f, `${where}.files[${i}]`);
        const size = r.optSize(o.file_size);
        return { name: r.str(o.file_name, `${where}.files[${i}].file_name`), ...(typeof o.id === "string" ? { id: o.id } : {}), ...(size !== undefined ? { size } : {}) };
      });
      const createdAt = r.optSeconds(m.inserted_at, `${where}.inserted_at`);
      return { role: role === "USER" ? "user" : "assistant", text: messageText(m, where), ...(createdAt ? { createdAt } : {}), attachments };
    });
    return {
      provider: "deepseek",
      id: r.str(session.id, "chat_session.id"),
      title: r.optStr(session.title, "chat_session.title") ?? "",
      createdAt: r.seconds(session.inserted_at, "chat_session.inserted_at"),
      updatedAt: r.seconds(session.updated_at, "chat_session.updated_at"),
      messages,
    };
  },
};
