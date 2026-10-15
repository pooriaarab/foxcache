// www.kimi.com (Moonshot AI). The page keeps a bearer token in
// localStorage "access_token" (auth localStorage-bearer). Every read is a
// Connect unary call, POST /apiv2/<package>.<Service>/<Method> with a JSON
// body, and each method is its own path. Endpoints and sources:
// docs/providers/kimi.md.
import { localStorageBearer } from "../auth/localStorage-bearer.js";
import { FoxcacheError } from "../errors.js";
import type { Body, Http } from "../http.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message, type Role } from "../schema.js";
import { type Obj, pathToRoot, reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("kimi");
const MULTI_AI = "https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/extractor/api_client.py";
const LIST = "/apiv2/kimi.chat.v1.ChatService/ListChats";
const CHAT = "/apiv2/kimi.chat.v1.ChatService/GetChat";
const MESSAGES = "/apiv2/kimi.chat.v1.ChatService/ListMessages";
const PAGE = 100;
const ROLES: Record<string, Role> = { user: "user", assistant: "assistant", system: "system" };
/** The parentId of a first message: left out or "" (Connect JSON), or the all-zero uuid. */
const isRoot = (parent: unknown) => parent === undefined || parent === "" || parent === "00000000-0000-0000-0000-000000000000";

/** One Connect call. An error can come with HTTP 200 as {error_type, message} (K1, K2). */
async function call(http: Http, path: string, body: Body): Promise<Obj> {
  const answer = r.obj(await http.post(path, body), path);
  if (typeof answer.error_type === "string") {
    if (answer.error_type === "auth.token.invalid") throw new FoxcacheError("logged-out", `kimi: ${path} says the token is not valid: reload www.kimi.com and sign in.`);
    throw new FoxcacheError("provider-error", `kimi: ${path} answered ${answer.error_type}.`);
  }
  return answer;
}

/** The text blocks of a message, joined. Tool and file blocks are left out. */
function messageText(m: Obj, where: string): string {
  return r
    .arr(m.blocks ?? [], `${where}.blocks`)
    .map((b, i) => r.obj(b, `${where}.blocks[${i}]`))
    .filter((b) => b.text !== undefined)
    .map((b, i) => r.optStr(r.obj(b.text, `${where}.blocks[${i}].text`).content, `${where}.blocks[${i}].text.content`) ?? "")
    .join("\n\n");
}

export const kimi: Adapter = {
  id: "kimi",
  label: "Kimi",
  origin: "https://www.kimi.com",
  auth: localStorageBearer({ key: "access_token" }),
  // Each method reads only, so each takes any body. The writes are under "Never call" in the doc.
  reads: defineReads([
    { method: "POST", path: LIST, body: { type: "json", match: {} }, source: "https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/kimi.ts#L392-L421" },
    { method: "POST", path: CHAT, body: { type: "json", match: {} }, source: `${MULTI_AI}#L109-L112` },
    { method: "POST", path: MESSAGES, body: { type: "json", match: {} }, source: `${MULTI_AI}#L114-L118` },
  ]),
  // No source documents the order of ListChats.
  newestFirst: false,

  async detect(http) {
    try {
      r.arr((await call(http, LIST, { page_size: 1, query: "" })).chats ?? [], "ListChats.chats");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const page = await call(http, LIST, { page_size: PAGE, query: "", ...(cursor ? { page_token: cursor } : {}) });
    const items = r.arr(page.chats ?? [], "ListChats.chats").map((x, i) => {
      const c = r.obj(x, `chats[${i}]`);
      return { id: r.str(c.id, `chats[${i}].id`), title: r.optStr(c.name, `chats[${i}].name`) ?? "", updatedAt: r.time(c.updateTime, `chats[${i}].updateTime`) };
    });
    const next = r.optStr(page.nextPageToken, "ListChats.nextPageToken");
    // An empty page with a token is not the end (K40).
    return { items, next };
  },

  async getConversation(http, stub) {
    const chat = r.obj((await call(http, CHAT, { chatId: stub.id })).chat, "GetChat.chat");
    const answer = await call(http, MESSAGES, { chatId: stub.id });
    if (r.optStr(answer.nextPageToken, "ListMessages.nextPageToken") !== undefined) throw r.fail("ListMessages.nextPageToken", "is set, and foxcache does not page messages");
    const list = r.arr(answer.messages ?? [], "ListMessages.messages");
    if (list.length > MAX_MESSAGES) throw new FoxcacheError("too-large", `kimi: the chat has more than ${MAX_MESSAGES} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
    const byId = new Map<string, { m: Obj; at: string }>();
    list.forEach((x, i) => {
      const m = r.obj(x, `messages[${i}]`);
      const id = r.str(m.id, `messages[${i}].id`);
      byId.set(id, { m, at: r.time(m.createTime, `message ${id}.createTime`) });
    });
    // No source names the current leaf: the newest message is on the branch the user saw last (K4).
    let leaf: string | undefined;
    for (const [id, { at }] of byId) if (leaf === undefined || at >= byId.get(leaf)!.at) leaf = id;
    const parentOf = (id: string) => {
      const parent = byId.get(id)!.m.parentId;
      return isRoot(parent) ? undefined : r.str(parent, `message ${id}.parentId`);
    };
    const ids = leaf === undefined ? [] : pathToRoot(leaf, parentOf, (id) => byId.has(id), r.fail);
    const messages: Message[] = ids.map((id) => {
      const { m, at } = byId.get(id)!;
      const role = ROLES[r.str(m.role, `message ${id}.role`)];
      if (!role) throw r.fail(`message ${id}.role`, `is ${JSON.stringify(m.role)}`);
      return { role, text: messageText(m, `message ${id}`), createdAt: at, attachments: [] };
    });
    return {
      provider: "kimi",
      id: stub.id,
      title: stub.title,
      createdAt: r.time(chat.createTime, "GetChat.chat.createTime"),
      updatedAt: r.time(chat.updateTime, "GetChat.chat.updateTime"),
      messages,
    };
  },
};
