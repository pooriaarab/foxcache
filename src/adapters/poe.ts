// poe.com. Every read is a persisted GraphQL query, POST /api/gql_POST
// {queryName, variables, extensions: {hash}}, signed with the page's
// formkey and an md5 tag (auth page-formkey). Writes go to the same path,
// so each read names its operation and hash. Endpoints and sources:
// docs/providers/poe.md.
import { pageFormkey } from "../auth/page-formkey.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message } from "../schema.js";
import { MAX_SUBPAGES, type Obj, reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("poe");
const PAW = "https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper";
const ERICBLUE = "https://github.com/ericblue/poe-chat-exporter/blob/49df39b9b6436b7986ca15a2a50535f3c3027f6e/poe-exporter.py";
const GQL = "/api/gql_POST";
const PAGE = 50;
/** The only top-level keys of a read body: a query text would run whatever it says (H30). */
const KEYS = ["queryName", "variables", "extensions"];
// Persisted query hashes change with Poe's builds. A changed one answers GraphQL errors: provider-schema.
const LIST = { name: "ChatHistoryListPaginationQuery", hash: "6ce01455b0201e625489da90c65f87a2809d212ea41ab6e39412b6913990e81f" };
const MESSAGES = { name: "ChatListPaginationQuery", hash: "c1a8fd96dd6e0a4679814182951b1e256e175587513c81b223addf931833a692" };

/** Run one persisted query and give its data. */
async function query(http: Http, q: { name: string; hash: string }, variables: Obj): Promise<Obj> {
  const answer = r.obj(await http.post(GQL, { queryName: q.name, variables, extensions: { hash: q.hash } }), q.name);
  // Not the error text: it is the site's, and may hold anything.
  if (answer.data === null || answer.data === undefined) throw r.fail(q.name, Array.isArray(answer.errors) ? "answered GraphQL errors (the persisted query hash may have changed)" : "has no data");
  return r.obj(answer.data, "data");
}

/** Epoch microseconds, as ISO-8601 UTC (P4). */
const micros = (x: unknown, where: string) => r.seconds(r.num(x, where) / 1e6, where);

export const poe: Adapter = {
  id: "poe",
  label: "Poe",
  origin: "https://poe.com",
  // poe-formkey from the page function paw finds with this pattern; poe-tag-id = md5(body + formkey + salt).
  auth: pageFormkey({ fn: /window\.([a-zA-Z0-9]+)=function\(\)\{return window/, length: 32, header: "poe-formkey", tag: { header: "poe-tag-id", salt: "4LxgHM6KpFqokX0Ox" } }),
  reads: defineReads([
    { method: "POST", path: GQL, body: { type: "json", match: { queryName: LIST.name, "extensions.hash": LIST.hash }, keys: KEYS }, source: `${ERICBLUE}#L98-L131` },
    { method: "POST", path: GQL, body: { type: "json", match: { queryName: MESSAGES.name, "extensions.hash": MESSAGES.hash }, keys: KEYS }, source: `${PAW}/api.py#L1002-L1056` },
  ]),
  // The list has no time; no source states its order.
  newestFirst: false,

  async detect(http) {
    try {
      r.obj((await query(http, LIST, { count: 1, cursor: null })).chats, "data.chats");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const chats = r.obj((await query(http, LIST, { count: PAGE, cursor: cursor ?? null })).chats, "data.chats");
    // The list has no time, so each stub gets the capture's: every chat is read again (docs/providers/poe.md).
    const now = new Date().toISOString();
    const items = r.arr(chats.edges, "chats.edges").map((x, i) => {
      const node = r.obj(r.obj(x, `chats.edges[${i}]`).node, `chats.edges[${i}].node`);
      return { id: r.str(node.id, `chats.edges[${i}].node.id`), title: r.optStr(node.title, `chats.edges[${i}].node.title`) ?? "", updatedAt: now };
    });
    const info = r.obj(chats.pageInfo, "chats.pageInfo");
    const next = r.bool(info.hasNextPage, "chats.pageInfo.hasNextPage") ? r.str(info.endCursor, "chats.pageInfo.endCursor") : undefined;
    return { items, next: items.length > 0 ? next : undefined };
  },

  async getConversation(http, stub) {
    // Pages come newest first, each oldest first inside: walk back by startCursor.
    const pages: Obj[][] = [];
    const seen = new Set<string>();
    let count = 0;
    for (let cursor: string | null = null, n = 1; ; n++) {
      const node = r.obj((await query(http, MESSAGES, { count: 100, cursor, id: stub.id })).node, "data.node");
      const conn = r.obj(node.messagesConnection, "node.messagesConnection");
      const edges = r.arr(conn.edges, "messagesConnection.edges").map((e, i) => r.obj(r.obj(e, `messagesConnection.edges[${i}]`).node, `messagesConnection.edges[${i}].node`));
      pages.unshift(edges);
      count += edges.length;
      if (count > MAX_MESSAGES) throw new FoxcacheError("too-large", `poe: the chat has more than ${MAX_MESSAGES} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
      const info = r.obj(conn.pageInfo, "messagesConnection.pageInfo");
      if (!r.bool(info.hasNextPage, "messagesConnection.pageInfo.hasNextPage")) break;
      cursor = r.str(info.startCursor, "messagesConnection.pageInfo.startCursor");
      if (seen.has(cursor)) throw r.fail("messagesConnection.pageInfo.startCursor", "came again (a loop)");
      if (n >= MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `poe: the messages did not end after ${MAX_SUBPAGES} pages.`);
      seen.add(cursor);
    }
    const rows = pages.flat();
    // Nothing to store and no time to give it: not-found, so the runner goes on past empty chats (PO40).
    if (rows.length === 0) throw new FoxcacheError("not-found", `poe: chat ${stub.id} has no messages; nothing is stored for it.`);
    // author is "human" or the bot's handle.
    const messages: Message[] = rows.map((m, i) => {
      const author = r.str(m.author, `messages[${i}].author`);
      return { role: author === "human" ? "user" : "assistant", text: r.str(m.text, `messages[${i}].text`), createdAt: micros(m.creationTime, `messages[${i}].creationTime`), attachments: [] };
    });
    const model = rows.map((m) => m.author as string).findLast((a) => a !== "human");
    return {
      provider: "poe",
      id: stub.id,
      title: stub.title,
      createdAt: messages[0]!.createdAt!,
      updatedAt: messages.at(-1)!.createdAt!,
      ...(model ? { model } : {}),
      messages,
    };
  },
};
