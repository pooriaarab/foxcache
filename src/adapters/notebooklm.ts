// notebook.google.com (NotebookLM, now Gemini Notebook). Every read is a
// batchexecute POST of one rpc id (src/batchexecute.ts), signed with the
// page tokens of / (auth google-page-tokens). A notebook is a project, and
// its latest chat a conversation. Endpoints and sources:
// docs/providers/notebooklm.md.
import { googlePageTokens } from "../auth/google-page-tokens.js";
import { batchRead, callBatch } from "../batchexecute.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import type { Message } from "../schema.js";
import { reader } from "./read.js";
import type { Adapter, Stub } from "./types.js";

const r = reader("notebooklm");
const PATH = "/_/LabsTailwindUi/data/batchexecute";
// Compiled names a Google deploy can change. A renamed id gets no frame back: provider-schema.
const NOTEBOOKS = "wXbhsf";
const NOTEBOOK = "rLM1Ne";
const LAST_CHAT = "hPTbtc";
const TURNS = "khqZz";
/** khqZz reads at most this many turns and has no cursor (NB3). */
const MAX_TURNS = 1000;
/** The request options GetProject takes, as notebooklm-py sends them. */
const OPTIONS = [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]];
const SRC = "https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508";

const call = (http: Http, rpcid: string, args: unknown, sourcePath: string) => callBatch(http, PATH, rpcid, args, sourcePath);

/** The notebooks, most recently viewed first: id, name, and the later of last viewed and created. */
async function notebooks(http: Http): Promise<Stub[]> {
  const result = await call(http, NOTEBOOKS, [null, 1, null, [2]], "/");
  const rows = result === null ? null : r.arr(result, NOTEBOOKS)[0];
  if (rows === null || rows === undefined) return [];
  return r.arr(rows, `${NOTEBOOKS}[0]`).map((x, i) => {
    const where = `${NOTEBOOKS}[0][${i}]`;
    const row = r.arr(x, where);
    const id = r.str(row[2], `${where}[2]`);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw r.fail(`${where}[2]`, "is not a notebook id");
    const created = r.stamp(r.pos(row, [5, 8], where), `${where}[5][8]`);
    const seen = r.pos(row, [5, 5], where);
    const viewed = seen === null || seen === undefined ? undefined : r.stamp(seen, `${where}[5][5]`);
    // notebooklm-py strips this prefix from titles too.
    const title = r.str(row[0], `${where}[0]`).replace(/^thought\n/, "").trim();
    return { id, title, updatedAt: viewed && viewed > created ? viewed : created };
  });
}

/** The id of the notebook's latest chat session, or undefined. */
async function lastChat(http: Http, notebook: string): Promise<string | undefined> {
  const result = await call(http, LAST_CHAT, [[], null, notebook, 1], `/notebook/${notebook}`);
  const group = result === null ? undefined : r.arr(result, LAST_CHAT)[0];
  const row = group === undefined || group === null ? undefined : r.arr(group, `${LAST_CHAT}[0]`)[0];
  return row === undefined || row === null ? undefined : r.str(r.arr(row, `${LAST_CHAT}[0][0]`)[0], `${LAST_CHAT}[0][0][0]`);
}

/** A source's id: "id", ["id"], or [null, true, ["id"]] for a Drive file. */
function sourceId(x: unknown, where: string): string {
  const id = typeof x === "string" ? x : Array.isArray(x) ? (typeof x[0] === "string" ? x[0] : Array.isArray(x[2]) ? x[2][0] : undefined) : undefined;
  if (typeof id !== "string" || !id) throw r.fail(where, "is not a source id");
  return id;
}

export const notebooklm: Adapter = {
  id: "notebooklm",
  label: "NotebookLM",
  origin: "https://notebook.google.com",
  auth: googlePageTokens({ path: "/" }),
  reads: defineReads([
    batchRead({ path: PATH, rpcid: NOTEBOOKS, source: `${SRC}/src/notebooklm/_web/notebooks.py#L567-L607` }),
    batchRead({ path: PATH, rpcid: NOTEBOOK, source: `${SRC}/docs/rpc-reference.md#L375-L403` }),
    batchRead({ path: PATH, rpcid: LAST_CHAT, source: `${SRC}/docs/rpc-reference.md#L1094-L1117` }),
    batchRead({ path: PATH, rpcid: TURNS, source: `${SRC}/docs/rpc-reference.md#L1123-L1150` }),
  ]),
  // Most recently viewed first, which is not the time of the last turn (NB5).
  newestFirst: false,

  async detect(http) {
    try {
      await notebooks(http);
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  // One page: the notebooks that have a chat (NB2).
  async listConversations(http) {
    const items: Stub[] = [];
    for (const notebook of await notebooks(http)) if (await lastChat(http, notebook.id)) items.push(notebook);
    return { items, next: undefined };
  },

  async getConversation(http, stub) {
    const chat = await lastChat(http, stub.id);
    if (!chat) throw new FoxcacheError("not-found", `notebooklm: the notebook ${stub.id} has no chat now.`);
    const result = await call(http, TURNS, [[], null, null, chat, MAX_TURNS], `/notebook/${stub.id}`);
    const turns = result === null ? [] : r.arr(r.arr(result, TURNS)[0] ?? [], `${TURNS}[0]`);
    if (turns.length >= MAX_TURNS) throw new FoxcacheError("too-large", `notebooklm: the chat has ${MAX_TURNS} turns or more, and NotebookLM gives no more than ${MAX_TURNS}; foxcache does not store a cut chat.`);
    // Newest first on the wire.
    const messages: Message[] = turns.toReversed().map((x, n) => {
      const where = `${TURNS}[0][${turns.length - 1 - n}]`;
      const turn = r.arr(x, where);
      if (turn[2] === 1) return { role: "user", text: r.str(turn[3], `${where}[3]`), attachments: [] };
      if (turn[2] === 2) return { role: "assistant", text: r.str(r.pos(turn, [4, 0, 0], where), `${where}[4][0][0]`), attachments: [] };
      throw r.fail(`${where}[2]`, `is ${JSON.stringify(turn[2])}`);
    });
    // Turns carry no time (NB5).
    return { provider: "notebooklm", id: stub.id, title: stub.title, createdAt: stub.updatedAt, updatedAt: stub.updatedAt, projectId: stub.id, messages };
  },

  async projects(http) {
    const out = [];
    for (const notebook of await notebooks(http)) {
      const info = r.arr(r.arr(await call(http, NOTEBOOK, [notebook.id, null, OPTIONS, null, 0], `/notebook/${notebook.id}`), NOTEBOOK)[0], `${NOTEBOOK}[0]`);
      const sources = info[1] === null || info[1] === undefined ? [] : r.arr(info[1], `${NOTEBOOK}[0][1]`);
      const files = sources.map((x, i) => {
        const where = `${NOTEBOOK}[0][1][${i}]`;
        return { name: r.optStr(r.pos(x, [1], where), `${where}[1]`) ?? "", id: sourceId(r.pos(x, [0], where), `${where}[0]`) };
      });
      // [[goal, custom prompt?], [length]]: a custom prompt is the notebook's instructions.
      const settings = info[7] === null || info[7] === undefined ? undefined : r.arr(info[7], `${NOTEBOOK}[0][7]`);
      const goal = settings?.[0] === undefined ? undefined : r.arr(settings[0], `${NOTEBOOK}[0][7][0]`);
      const instructions = goal === undefined ? undefined : r.optStr(goal[1], `${NOTEBOOK}[0][7][0][1]`);
      out.push({ provider: "notebooklm" as const, id: notebook.id, name: notebook.title, ...(instructions ? { instructions } : {}), files });
    }
    return out;
  },
};
