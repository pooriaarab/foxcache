// www.meta.ai. Every read is a Relay persisted query, POST /api/graphql
// {doc_id, variables}, sent with the page's cookies as the signed-in page
// sends it. Writes go to the same path, so each read names its doc_id.
// The ids and shapes are from the site's own bundle: docs/providers/meta.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message } from "../schema.js";
import { MAX_SUBPAGES, type Obj, reader } from "./read.js";
import type { Adapter, Stub } from "./types.js";

const r = reader("meta");
const CHUNKS = "https://www.meta.ai/_next/static/immutable/chunks";
const GQL = "/api/graphql";
/** The only top-level keys of a read body: no query_id or query text beside the doc_id (H30). */
const KEYS = ["doc_id", "variables"];
// doc_ids change with Meta's deploys. A changed one answers GraphQL errors: provider-schema.
const LIST = "f9f2f515cf675e127f619401193b6992"; // EctoConversationListWithPaginationRouterQuery
const PINNED = "28e9d6b1d7fe4b32a62f622dbd33ddc3"; // EctoPinnedConversationsRouterRefetchQuery
const UNPINNED = "4d89d5db4e7318d2437d24b406f69199"; // EctoUnpinnedConversationsRouterRefetchQuery
const MESSAGES = "a40d4674ba65ae2760857ff01494762d"; // EctoMergedMessageListPaginationQuery
const ROLES: Record<string, Message["role"]> = { UserMessage: "user", AssistantMessage: "assistant" };

/** Run one query and give its data. */
async function query(http: Http, docId: string, what: string, variables: Obj): Promise<Obj> {
  const answer = r.obj(await http.post(GQL, { doc_id: docId, variables }), what);
  // Not the error text: it is the site's, and may hold anything.
  if (answer.data === null || answer.data === undefined) throw r.fail(`the ${what} query`, Array.isArray(answer.errors) ? "answered GraphQL errors (the doc_id may have changed)" : "has no data");
  return r.obj(answer.data, "data");
}

/** One Relay connection of chats: its stubs and the end cursor when it has more. */
function chats(x: unknown, where: string): { items: Stub[]; more?: string } {
  const c = r.obj(x, `data.${where}`);
  const items = r.arr(c.edges, `${where}.edges`).map((e, i) => {
    const node = r.obj(r.obj(e, `${where}.edges[${i}]`).node, `${where}.edges[${i}].node`);
    const at = `${where}.edges[${i}].node`;
    return { id: r.str(node.id, `${at}.id`), title: r.optStr(node.displayTitle, `${at}.displayTitle`) ?? r.optStr(node.title, `${at}.title`) ?? "", updatedAt: r.time(node.updatedAt, `${at}.updatedAt`) };
  });
  const info = r.obj(c.pageInfo, `${where}.pageInfo`);
  return { items, ...(r.bool(info.hasNextPage, `${where}.pageInfo.hasNextPage`) && items.length > 0 ? { more: r.str(info.endCursor, `${where}.pageInfo.endCursor`) } : {}) };
}

/** The list cursor: where the pinned and the unpinned chats go on. */
interface Cursor {
  p?: string;
  u?: string;
}
const next = (c: Cursor) => (c.p === undefined && c.u === undefined ? undefined : JSON.stringify(c));

export const meta: Adapter = {
  id: "meta",
  label: "Meta AI",
  origin: "https://www.meta.ai",
  // The page adds a bearer only for a signed-out temporary user.
  auth: cookie,
  reads: defineReads([
    { method: "POST", path: GQL, body: { type: "json", match: { doc_id: LIST }, keys: KEYS }, source: `${CHUNKS}/21xl7171h-_0s.js` },
    { method: "POST", path: GQL, body: { type: "json", match: { doc_id: PINNED }, keys: KEYS }, source: `${CHUNKS}/1k4fkow1u-kuz.js` },
    { method: "POST", path: GQL, body: { type: "json", match: { doc_id: UNPINNED }, keys: KEYS }, source: `${CHUNKS}/21xl7171h-_0s.js` },
    { method: "POST", path: GQL, body: { type: "json", match: { doc_id: MESSAGES }, keys: KEYS }, source: `${CHUNKS}/1co5ovyqc5vs_.js` },
  ]),
  // No source states the order.
  newestFirst: false,

  async detect(http) {
    try {
      r.obj((await query(http, LIST, "list", {})).pinnedConversations, "data.pinnedConversations");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  // The first page: pinned and unpinned (the page asks for 20 and 40). Then the pinned go on, then the unpinned.
  async listConversations(http, cursor) {
    if (cursor === undefined) {
      const data = await query(http, LIST, "list", {});
      const pinned = chats(data.pinnedConversations, "pinnedConversations");
      const unpinned = chats(data.unpinnedConversations, "unpinnedConversations");
      return { items: [...pinned.items, ...unpinned.items], next: next({ p: pinned.more, u: unpinned.more }) };
    }
    const c = JSON.parse(cursor) as Cursor;
    if (c.p !== undefined) {
      const pinned = chats((await query(http, PINNED, "pinned list", { pinnedAfter: c.p, pinnedFirst: 20 })).pinnedConversations, "pinnedConversations");
      return { items: pinned.items, next: next({ p: pinned.more, u: c.u }) };
    }
    const unpinned = chats((await query(http, UNPINNED, "unpinned list", { unpinnedAfter: c.u, unpinnedFirst: 40 })).unpinnedConversations, "unpinnedConversations");
    return { items: unpinned.items, next: next({ u: unpinned.more }) };
  },

  async getConversation(http, stub) {
    // Pages come newest first, each oldest first inside: walk back by startCursor.
    const pages: Obj[][] = [];
    const seen = new Set<string>();
    let count = 0;
    for (let before: string | null = null, n = 1; ; n++) {
      const conversation = r.obj((await query(http, MESSAGES, "messages", { conversationId: stub.id, before, last: 10 })).conversation, "data.conversation");
      const conn = r.obj(conversation.messages, "conversation.messages");
      pages.unshift(r.arr(conn.edges, "messages.edges").map((e, i) => r.obj(r.obj(e, `messages.edges[${i}]`).node, `messages.edges[${i}].node`)));
      count += pages[0]!.length;
      if (count > MAX_MESSAGES) throw new FoxcacheError("too-large", `meta: the chat has more than ${MAX_MESSAGES} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
      const info = r.obj(conn.pageInfo, "messages.pageInfo");
      if (!r.bool(info.hasPreviousPage, "messages.pageInfo.hasPreviousPage")) break;
      before = r.str(info.startCursor, "messages.pageInfo.startCursor");
      if (seen.has(before)) throw r.fail("messages.pageInfo.startCursor", "came again (a loop)");
      if (n >= MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `meta: the messages did not end after ${MAX_SUBPAGES} pages.`);
      seen.add(before);
    }
    // content is the text the page's Copy button copies; an answer that is only an image has none.
    const messages: Message[] = pages.flat().map((m) => {
      const where = `message ${String(m.id)}`;
      const type = m["__typename"];
      const role = ROLES[r.str(type, `${where}.__typename`)];
      if (!role) throw r.fail(`${where}.__typename`, `is ${JSON.stringify(type)}`);
      return { role, text: r.optStr(m.content, `${where}.content`) ?? "", createdAt: r.time(m.createdAt, `${where}.createdAt`), attachments: [] };
    });
    return { provider: "meta", id: stub.id, title: stub.title, createdAt: messages[0]?.createdAt ?? stub.updatedAt, updatedAt: stub.updatedAt, messages };
  },
};
