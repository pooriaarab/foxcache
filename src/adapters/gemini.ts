// gemini.google.com. Every read is a batchexecute POST of one rpc id
// (src/batchexecute.ts), signed with the page tokens of /app (auth
// google-page-tokens). Endpoints and sources: docs/providers/gemini.md.
import { googlePageTokens } from "../auth/google-page-tokens.js";
import { batchRead, callBatch } from "../batchexecute.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import type { Message } from "../schema.js";
import { reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("gemini");
const PATH = "/_/BardChatUi/data/batchexecute";
// Compiled names a Google deploy can change. A renamed id gets no frame back: provider-schema.
const PREFERENCES = "ESY5D";
const LIST = "MaZiqc";
const CHAT = "hNvQHb";
const GEMS = "CNgdBe";
const SAVED_INFO = "ZKcapf";
const PAGE = 20;
/** hNvQHb reads at most this many turns and has no cursor (GE4). */
const MAX_TURNS = 1000;
/** The list streams: the pinned chats, then the rest. */
const PINNED = 1;
const REST = 0;
const SRC = {
  prefs: "https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/page-bridge.ts#L151-L167",
  list: "https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/contents/gemini-parser.ts#L842-L940",
  chat: "https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/contents/gemini-parser.ts#L1020-L1046",
  gems: "https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/components/gem_mixin.py#L80-L157",
  saved: "https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/gemini/extractor/api_client.py#L84-L141",
};

/** A [seconds, nanos] time as ISO-8601 UTC. */
function time(x: unknown, where: string): string {
  const t = r.arr(x, where);
  const nanos = t[1] === null || t[1] === undefined ? 0 : r.num(t[1], `${where}[1]`);
  return r.seconds(r.num(t[0], `${where}[0]`) + nanos / 1e9, where);
}
/** The value at a path of nested lists, each step checked. */
function at(x: unknown, path: number[], where: string): unknown {
  let value = x;
  path.forEach((i, n) => (value = r.arr(value, `${where}${path.slice(0, n).map((p) => `[${p}]`).join("")}`)[i]));
  return value;
}
const call = (http: Http, rpcid: string, args: unknown, sourcePath: string) => callBatch(http, PATH, rpcid, args, sourcePath);

export const gemini: Adapter = {
  id: "gemini",
  label: "Gemini",
  origin: "https://gemini.google.com",
  auth: googlePageTokens({ path: "/app" }),
  reads: defineReads([
    batchRead({ path: PATH, rpcid: PREFERENCES, source: SRC.prefs }),
    batchRead({ path: PATH, rpcid: LIST, source: SRC.list }),
    batchRead({ path: PATH, rpcid: CHAT, source: SRC.chat }),
    batchRead({ path: PATH, rpcid: GEMS, source: SRC.gems }),
    batchRead({ path: PATH, rpcid: SAVED_INFO, source: SRC.saved }),
  ]),
  // The row time may be the creation time (GE6), and two streams are read in turn.
  newestFirst: false,

  async detect(http) {
    try {
      await call(http, PREFERENCES, [], "/app");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  // The cursor is "<stream>:<token>": the pinned stream first, then the rest from its first page.
  async listConversations(http, cursor) {
    const stream = cursor === undefined ? PINNED : Number(cursor.slice(0, cursor.indexOf(":")));
    const token = cursor === undefined ? null : cursor.slice(cursor.indexOf(":") + 1) || null;
    const page = await call(http, LIST, [PAGE, token, [stream, null, 1]], "/app");
    // An empty stream: no rows (GE3 reads the pinned stream when there is no pinned chat).
    const o = page === null ? [] : r.arr(page, LIST);
    const rows = o[2] === null || o[2] === undefined ? [] : r.arr(o[2], `${LIST}[2]`);
    const items = rows
      .map((x, i) => ({ row: r.arr(x, `${LIST}[2][${i}]`), where: `${LIST}[2][${i}]` }))
      // Each stream keeps the rows of its kind, so a pinned chat is read once (GE3).
      .filter(({ row }) => (row[2] === true) === (stream === PINNED))
      .map(({ row, where }) => {
        const id = /^c_([A-Za-z0-9_-]+)$/.exec(r.str(row[0], `${where}[0]`))?.[1];
        if (!id) throw r.fail(`${where}[0]`, "is not a chat id");
        return { id, title: r.optStr(row[1], `${where}[1]`) ?? "", updatedAt: time(row[5], `${where}[5]`) };
      });
    const next = r.optStr(o[1], `${LIST}[1]`);
    return { items, next: next ? `${stream}:${next}` : stream === PINNED ? `${REST}:` : undefined };
  },

  async getConversation(http, stub) {
    const turns = r.arr(r.arr(await call(http, CHAT, [`c_${stub.id}`, MAX_TURNS, null, 1, [1], [4], null, 1], `/app/${stub.id}`), CHAT)[0], `${CHAT}[0]`);
    if (turns.length >= MAX_TURNS) throw new FoxcacheError("too-large", `gemini: the chat has ${MAX_TURNS} turns or more, and Gemini gives no more than ${MAX_TURNS}; foxcache does not store a cut chat.`);
    // Newest first on the wire.
    const messages: Message[] = turns.toReversed().flatMap((t, n) => {
      const where = `turns[${turns.length - 1 - n}]`;
      const when = at(t, [4], where);
      const createdAt = when === null || when === undefined ? undefined : time(when, `${where}[4]`);
      const stamp = createdAt ? { createdAt } : {};
      return [
        { role: "user" as const, text: r.str(at(t, [2, 0, 0], where), `${where}[2][0][0]`), ...stamp, attachments: [] },
        // The first candidate: the reply the page shows.
        { role: "assistant" as const, text: r.str(at(t, [3, 0, 0, 1, 0], where), `${where}[3][0][0][1][0]`), ...stamp, attachments: [] },
      ];
    });
    const times = messages.flatMap((m) => (m.createdAt ? [m.createdAt] : []));
    const updatedAt = [stub.updatedAt, ...times].toSorted().at(-1)!;
    return { provider: "gemini", id: stub.id, title: stub.title, createdAt: times[0] ?? stub.updatedAt, updatedAt, messages };
  },

  async library(http) {
    const result = await call(http, GEMS, [2, ["en"], 0], "/app");
    const o = result === null ? [] : r.arr(result, GEMS);
    const rows = o[2] === null || o[2] === undefined ? [] : r.arr(o[2], `${GEMS}[2]`);
    return rows.map((x, i) => {
      const where = `${GEMS}[2][${i}]`;
      return { provider: "gemini", id: r.str(at(x, [0], where), `${where}[0]`), name: r.str(at(x, [1, 0], where), `${where}[1][0]`), kind: "gem" };
    });
  },

  // Saved info ("Instructions for Gemini"): one memory per item.
  async memories(http) {
    const o = r.arr(await call(http, SAVED_INFO, [100], "/saved-info"), SAVED_INFO);
    if (o.length === 0) return [];
    return r.arr(o[0], `${SAVED_INFO}[0]`).map((x, i) => {
      const where = `${SAVED_INFO}[0][${i}]`;
      return { provider: "gemini", id: r.str(at(x, [0], where), `${where}[0]`), text: r.str(at(x, [1], where), `${where}[1]`), createdAt: time(at(x, [2], where), `${where}[2]`) };
    });
  },
};
