// HuggingChat (huggingface.co/chat), the open-source chat-ui. Session
// cookies only, and every /api/v2 answer is superjson: {json, meta}.
// Endpoints and sources: docs/providers/huggingchat.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import type { Http, Query } from "../http.js";
import { defineReads } from "../reads.js";
import type { Message } from "../schema.js";
import type { Adapter } from "./types.js";
import { type Obj, reader } from "./read.js";

const r = reader("huggingchat");

const CU = "https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/api/v2";
/** A conversation id is a MongoDB ObjectId. chat-ui reads a 7-character id as a shared link instead, so anything else is refused. */
const OBJECT_ID = /^[0-9a-f]{24}$/i;

/** The data of a superjson answer. foxcache reads dates as the ISO strings superjson puts in json. */
async function sj(http: Http, route: string, query?: Query): Promise<unknown> {
  const body = r.obj(await http.get(route, query), route);
  if (!("json" in body)) throw r.fail(`${route} json`, "is missing (not a superjson answer)");
  return body.json;
}

/**
 * The thread the site shows: the last message, its ancestors before it, and
 * the last child down from it (chat-ui createMessagesPath). A missing
 * ancestor or child, or a cycle, throws provider-schema (P7).
 */
function path(list: Obj[]): Obj[] {
  const byId = new Map(list.map((m, i) => [r.str(m.id, `messages[${i}].id`), m]));
  const leaf = list.at(-1);
  if (!leaf) return [];
  const get = (id: unknown, where: string) => {
    const m = byId.get(r.str(id, where));
    if (!m) throw r.fail(where, `names ${String(id)}, which is not in the conversation`);
    return m;
  };
  const out = r.arr(leaf.ancestors ?? [], `message ${String(leaf.id)}.ancestors`).map((a, i) => get(a, `message ${String(leaf.id)}.ancestors[${i}]`));
  out.push(leaf);
  const seen = new Set(out);
  for (let at = leaf; ; ) {
    const children = r.arr(at.children ?? [], `message ${String(at.id)}.children`);
    if (!children.length) break;
    at = get(children.at(-1), `message ${String(at.id)}.children`);
    if (seen.has(at)) throw r.fail(`message ${String(at.id)}`, "is in a child cycle");
    seen.add(at);
    out.push(at);
  }
  return out;
}

function message(m: Obj): Message | undefined {
  const where = `message ${String(m.id)}`;
  const role = r.str(m.from, `${where}.from`);
  if (role !== "user" && role !== "assistant" && role !== "system") throw r.fail(`${where}.from`, `is ${JSON.stringify(role)}`);
  const text = r.str(m.content, `${where}.content`);
  // chat-ui puts an empty system message at the root of every converted chat.
  if (role === "system" && !text) return undefined;
  // A file's value is its base64 data or a storage hash: only the name and type are kept (P5).
  const attachments = r.arr(m.files ?? [], `${where}.files`).map((f, i) => {
    const o = r.obj(f, `${where}.files[${i}]`);
    const mimeType = r.optStr(o.mime, `${where}.files[${i}].mime`);
    return { name: r.str(o.name, `${where}.files[${i}].name`), ...(mimeType ? { mimeType } : {}) };
  });
  const createdAt = r.optTime(m.createdAt, `${where}.createdAt`);
  return { role, text, ...(createdAt ? { createdAt } : {}), attachments };
}

export const huggingchat: Adapter = {
  id: "huggingchat",
  label: "HuggingChat",
  origin: "https://huggingface.co",
  auth: cookie,
  // GET only. DELETE on the list deletes every chat, and GET /chat/api/v2/user/settings can write: docs/providers/huggingchat.md.
  reads: defineReads([
    { method: "GET", path: "/chat/api/v2/user", source: `${CU}/user/+server.ts#L4-L17` },
    { method: "GET", path: "/chat/api/v2/conversations", query: ["p"], source: `${CU}/conversations/+server.ts#L13-L44` },
    { method: "GET", path: "/chat/api/v2/conversations/{id}", source: `${CU}/conversations/%5Bid%5D/+server.ts#L17-L65` },
  ]),
  newestFirst: true,

  async detect(http) {
    try {
      const user = await sj(http, "/chat/api/v2/user");
      // null when signed out.
      if (user === null) return false;
      r.str(r.obj(user, "user").id, "user.id");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const p = cursor ? Number(cursor) : 0;
    const data = r.obj(await sj(http, "/chat/api/v2/conversations", { p }), "conversations");
    const rows = r.arr(data.conversations, "conversations.conversations").map((c, i) => r.obj(c, `conversations[${i}]`));
    const items = rows.map((c, i) => ({ id: r.str(c.id, `conversations[${i}].id`), title: r.optStr(c.title, `conversations[${i}].title`) ?? "", updatedAt: r.time(c.updatedAt, `conversations[${i}].updatedAt`) }));
    return { items, next: r.bool(data.hasMore, "conversations.hasMore") ? String(p + 1) : undefined };
  },

  async getConversation(http, stub) {
    if (!OBJECT_ID.test(stub.id)) throw new FoxcacheError("not-allowed", `huggingchat: ${JSON.stringify(stub.id.slice(0, 40))} is not a conversation id.`);
    const data = r.obj(await sj(http, `/chat/api/v2/conversations/${stub.id}`), "conversation");
    const list = r.arr(data.messages, "conversation.messages").map((m, i) => r.obj(m, `messages[${i}]`));
    const messages = path(list).flatMap((m) => message(m) ?? []);
    const updatedAt = r.time(data.updatedAt, "conversation.updatedAt");
    const model = r.optStr(data.model, "conversation.model");
    return {
      provider: "huggingchat",
      id: r.str(data.id, "conversation.id"),
      title: r.optStr(data.title, "conversation.title") ?? "",
      // The answer has no creation time: the first message's stands in for it.
      createdAt: messages.find((m) => m.createdAt)?.createdAt ?? updatedAt,
      updatedAt,
      ...(model ? { model } : {}),
      messages,
    };
  },
};
