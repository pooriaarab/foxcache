// www.doubao.com (ByteDance). The session cookies alone (auth cookie).
// Every read is an IM pull command, a POST of {cmd, uplink_body, ...}
// with the page's query and the two headers its page sends (H16); each
// path takes its one cmd. Endpoints and sources: docs/providers/doubao.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message } from "../schema.js";
import { MAX_SUBPAGES, type Obj, reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("doubao");
const LEAFSPACE = "https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/references/api-notes.md";
const CTXPORT = "https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/doubao/plugin.ts";
/** The query of the page's IM calls: no device fingerprint, no signature. */
const QUERY = { version_code: "20800", language: "zh", device_platform: "web", aid: "497858", real_aid: "497858", pkg_type: "release_version", region: "CN", sys_region: "CN", samantha_web: "1", web_platform: "browser", "use-olympus-account": "1" };
const HEADERS = { "content-type": "application/json; encoding=utf-8", "agw-js-conv": "str" };
const LIST = { path: "/im/chain/recent_conv", cmd: 3200, up: "pull_recent_conv_chain_uplink_body", down: "pull_recent_conv_chain_downlink_body" };
const INFO = { path: "/im/conversation/info", cmd: 1110, up: "get_conv_info_uplink_body", down: "get_conv_info_downlink_body" };
// "singe" is the site's own spelling.
const CHAIN = { path: "/im/chain/single", cmd: 3100, up: "pull_singe_chain_uplink_body", down: "pull_singe_chain_downlink_body" };
const LIST_OPTION = { not_need_message: true, need_complete_conversation: true, need_coco_conversation: true, need_coco_bot: true, need_pc_pin_chain: true, pc_pin_query_type: 0 };
const PAGE = 50;
const FROM_LATEST = 3;
const OLDER = 1;
const BOT_CHAT = 3;
const TEXT_BLOCK = 10000;
const read = (c: typeof LIST, source: string) => ({ method: "POST" as const, path: c.path, query: Object.keys(QUERY), body: { type: "json" as const, match: { cmd: c.cmd } }, headers: HEADERS, source });

/** status_code values that are known not to mean "signed out": a missing header (H16) and the risk captcha (D40). */
const NOT_SESSION = new Set([712012002, 710022004]);

/** One pull, and its status_code. An error comes with HTTP 200 and a status_code that is not 0 (D2). */
async function send(http: Http, c: typeof LIST, payload: Obj): Promise<{ answer: Obj; status: number }> {
  const answer = r.obj(await http.post(c.path, { cmd: c.cmd, uplink_body: { [c.up]: payload }, sequence_id: crypto.randomUUID(), channel: 2, version: "1" }, QUERY), c.path);
  return { answer, status: r.num(answer.status_code, `${c.path} status_code`) };
}
async function pull(http: Http, c: typeof LIST, payload: Obj): Promise<Obj> {
  const { answer, status } = await send(http, c, payload);
  if (status !== 0) throw new FoxcacheError("provider-error", `doubao: ${c.path} answered status ${status}.`);
  return r.obj(r.obj(answer.downlink_body, `${c.path} downlink_body`)[c.down], `${c.path} ${c.down}`);
}

/** A number, or a digit string (agw-js-conv: str), or undefined. */
const digits = (x: unknown): number | undefined => (typeof x === "number" ? x : typeof x === "string" && /^\d+$/.test(x) ? Number(x) : undefined);
/** Epoch seconds, or milliseconds when over 10^12, as ISO-8601 UTC (D4). */
function epoch(x: unknown, where: string): string {
  const n = digits(x);
  if (n === undefined || !Number.isFinite(n) || n <= 0) throw r.fail(where, "is not a time");
  return new Date(n > 1e12 ? n : n * 1000).toISOString();
}
function index(x: unknown, where: string): number {
  const n = digits(x);
  if (n === undefined || !Number.isSafeInteger(n)) throw r.fail(where, "is not an index");
  return n;
}
function json(x: unknown, where: string): unknown {
  try {
    return JSON.parse(r.str(x, where));
  } catch (error) {
    if (error instanceof FoxcacheError) throw error;
    throw r.fail(where, "is not JSON");
  }
}

/** The text of the text blocks; a block's content is an object or JSON text. */
function blocksText(blocks: unknown[], where: string): string {
  return blocks
    .map((x, i) => [r.obj(x, `${where}[${i}]`), `${where}[${i}]`] as const)
    .filter(([b]) => b.block_type === TEXT_BLOCK)
    .map(([b, at]) => {
      const content = r.obj(typeof b.content === "string" ? json(b.content, `${at}.content`) : b.content, `${at}.content`);
      return r.str(r.obj(content.text_block, `${at}.content.text_block`).text, `${at}.content.text_block.text`);
    })
    .join("\n\n");
}
function messageText(m: Obj, where: string): string {
  if (Array.isArray(m.content_block) && m.content_block.length > 0) return blocksText(m.content_block, `${where}.content_block`);
  if (m.content_type === 9999) return blocksText(r.arr(json(m.content, `${where}.content`), `${where}.content`), `${where}.content`);
  if (m.content_type !== 1) return "";
  // A user text: JSON {text}, or the text itself.
  const raw = r.str(m.content, `${where}.content`);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as Obj).text === "string") return (parsed as Obj).text as string;
  } catch {
    // Not JSON: the text itself.
  }
  return raw;
}

export const doubao: Adapter = {
  id: "doubao",
  label: "Doubao",
  origin: "https://www.doubao.com",
  auth: cookie,
  reads: defineReads([
    read(LIST, `${LEAFSPACE}#L60-L86`),
    read(INFO, `${CTXPORT}#L96-L136`),
    read(CHAIN, `${CTXPORT}#L140-L206`),
  ]),
  // Pinned chats come with the list.
  newestFirst: false,

  async detect(http) {
    try {
      const { status } = await send(http, LIST, { api_version: 1, conv_version: 0, direction: FROM_LATEST, limit: 1, message_count_per_conv: 0, option: LIST_OPTION });
      if (status === 0) return true;
      // VESTI: an expired session answers a status_code that is not 0; no source gives the code (D40).
      if (NOT_SESSION.has(status)) throw new FoxcacheError("provider-error", `doubao: ${LIST.path} answered status ${status}.`);
      return false;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    // The first page asks from the latest with version 0, a number; the next ones go older.
    const version = cursor === undefined ? 0 : Number.isSafeInteger(Number(cursor)) ? Number(cursor) : cursor;
    const page = await pull(http, LIST, { api_version: 1, conv_version: version, direction: cursor === undefined ? FROM_LATEST : OLDER, limit: PAGE, message_count_per_conv: 0, option: LIST_OPTION });
    const items = r.arr(page.cells ?? [], "recent_conv cells").map((x, i) => {
      const c = r.obj(r.obj(x, `cells[${i}]`).conversation, `cells[${i}].conversation`);
      return { id: r.str(c.conversation_id, `cells[${i}].conversation_id`), title: r.optStr(c.name, `cells[${i}].name`) ?? "", updatedAt: epoch(c.update_time, `cells[${i}].update_time`) };
    });
    if (!r.bool(page.has_more ?? false, "recent_conv has_more") || items.length === 0) return { items };
    const next = page.next_conv_version;
    return { items, next: typeof next === "number" ? String(next) : r.str(next, "recent_conv next_conv_version") };
  },

  async getConversation(http, stub) {
    const info = r.obj((await pull(http, INFO, { conversation_id: stub.id, ext: {}, bot_id: "", conversation_type: BOT_CHAT, option: { need_bot_info: false } })).conversation_info, "conversation_info");
    // Newest first, from one past the newest (2^53-1). The next anchor is the smallest index of the page (D5, D6).
    const byId = new Map<string, { m: Obj; at: number }>();
    for (let anchor = Number.MAX_SAFE_INTEGER, pages = 1; ; pages++) {
      const page = await pull(http, CHAIN, { conversation_id: stub.id, anchor_index: anchor, conversation_type: BOT_CHAT, direction: OLDER, limit: PAGE, ext: {}, filter: { index_list: [] } });
      let oldest = anchor;
      for (const [i, x] of r.arr(page.messages ?? [], "chain/single messages").entries()) {
        const m = r.obj(x, `messages[${i}]`);
        const id = r.str(m.message_id, `messages[${i}].message_id`);
        const at = index(m.index_in_conv, `message ${id}.index_in_conv`);
        if (!byId.has(id)) byId.set(id, { m, at });
        oldest = Math.min(oldest, at);
      }
      if (byId.size > MAX_MESSAGES) throw new FoxcacheError("too-large", `doubao: the chat has more than ${MAX_MESSAGES} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
      if (!r.bool(page.has_more ?? false, "chain/single has_more")) break;
      if (oldest >= anchor) throw new FoxcacheError("pagination-loop", "doubao: /im/chain/single gave no older message, but says it has more.");
      if (pages >= MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `doubao: /im/chain/single did not end after ${MAX_SUBPAGES} pages.`);
      anchor = oldest;
    }
    const messages: Message[] = [...byId.entries()]
      .toSorted(([, a], [, b]) => a.at - b.at)
      .map(([id, { m }]) => {
        const where = `message ${id}`;
        const createdAt = m.create_time === undefined ? undefined : epoch(m.create_time, `${where}.create_time`);
        return { role: r.num(m.user_type, `${where}.user_type`) === 1 ? "user" : "assistant", text: messageText(m, where), ...(createdAt ? { createdAt } : {}), attachments: [] };
      });
    return { provider: "doubao", id: stub.id, title: stub.title, createdAt: epoch(info.create_time, "conversation_info.create_time"), updatedAt: epoch(info.update_time, "conversation_info.update_time"), messages };
  },
};
