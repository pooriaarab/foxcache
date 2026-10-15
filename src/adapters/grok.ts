// grok.com. Cookies only. The list and the message tree are GET reads; the
// message text comes only from POST load-responses, a bulk get by id.
// Endpoints and sources: docs/providers/grok.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message, type Role } from "../schema.js";
import { type Obj, pathToRoot, reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("grok");
const MULTI = "https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/extractor/api_client.py";
const PAGE = 60;
/** Ids per load-responses call. */
const BATCH = 50;
const ROLES: Record<string, Role> = { human: "user", assistant: "assistant" };
const LIST = "/rest/app-chat/conversations";

function stubs(page: Obj) {
  return r.arr(page.conversations, "conversations").map((x, i) => {
    const c = r.obj(x, `conversations[${i}]`);
    const where = `conversations[${i}]`;
    return { id: r.str(c.conversationId, `${where}.conversationId`), title: r.optStr(c.title, `${where}.title`) ?? "", updatedAt: r.time(c.modifyTime ?? c.createTime, `${where}.modifyTime`) };
  });
}

export const grok: Adapter = {
  id: "grok",
  label: "Grok",
  origin: "https://grok.com",
  auth: cookie,
  reads: defineReads([
    { method: "GET", path: LIST, query: ["pageSize", "pageToken"], source: `${MULTI}#L55-L86` },
    { method: "GET", path: "/rest/app-chat/conversations_v2/{id}", source: "https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/lib/grok-api.ts#L130-L145" },
    { method: "GET", path: "/rest/app-chat/conversations/{id}/response-node", query: ["includeThreads"], source: "https://github.com/mvanhorn/agent-tincan/blob/98cc6ebe104933c6a49ae204c7916fd35fe23e60/extension/ops.js#L1272-L1287" },
    // Its only body is {responseIds}: there is no operation to name. The writes are under "Never call" in the doc.
    { method: "POST", path: "/rest/app-chat/conversations/{id}/load-responses", body: { type: "json", match: {} }, source: `${MULTI}#L99-L106` },
  ]),
  // No source confirms the order of the list.
  newestFirst: false,

  async detect(http) {
    try {
      r.arr(r.obj(await http.get(LIST, { pageSize: 1 }), "conversations page").conversations, "conversations");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const page = r.obj(await http.get(LIST, { pageSize: PAGE, pageToken: cursor }), "conversations page");
    const items = stubs(page);
    const next = r.optStr(page.nextPageToken, "nextPageToken");
    if (next !== undefined && next === cursor) throw new FoxcacheError("pagination-loop", "grok: nextPageToken came back as the token that was sent.");
    return { items, next: items.length > 0 ? next : undefined };
  },

  async getConversation(http, stub) {
    const c = r.obj(r.obj(await http.get(`/rest/app-chat/conversations_v2/${stub.id}`), "conversations_v2").conversation, "conversations_v2.conversation");
    const tree = r.obj(await http.get(`${LIST}/${stub.id}/response-node`, { includeThreads: true }), "response-node");
    const nodes = r.arr(tree.responseNodes, "responseNodes").map((x, i) => {
      const n = r.obj(x, `responseNodes[${i}]`);
      return { id: r.str(n.responseId, `responseNodes[${i}].responseId`), parent: r.optStr(n.parentResponseId, `responseNodes[${i}].parentResponseId`) };
    });
    if (nodes.length > MAX_MESSAGES) throw new FoxcacheError("too-large", `grok: the chat has more than ${MAX_MESSAGES} responses; foxcache keeps at most ${MAX_MESSAGES}.`);
    const bodies = new Map<string, Obj>();
    for (let at = 0; at < nodes.length; at += BATCH) {
      const page = r.obj(await http.post(`${LIST}/${stub.id}/load-responses`, { responseIds: nodes.slice(at, at + BATCH).map((n) => n.id) }), "load-responses");
      for (const [i, x] of r.arr(page.responses, "load-responses.responses").entries()) {
        const b = r.obj(x, `responses[${i}]`);
        bodies.set(r.str(b.responseId, `responses[${i}].responseId`), b);
      }
    }
    const parents = new Map(nodes.map((n) => [n.id, n.parent]));
    const body = (id: string): Obj => {
      const b = bodies.get(id);
      if (!b) throw r.fail(`response ${id}`, "is in the tree, but load-responses did not send it");
      return b;
    };
    const at = (id: string) => r.time(body(id).createTime, `response ${id}.createTime`);
    // The visible thread: from the newest response back to the root.
    const leaf = nodes.map((n) => n.id).reduce<string | undefined>((best, id) => (best === undefined || at(id) > at(best) ? id : best), undefined);
    const path = leaf === undefined ? [] : pathToRoot(leaf, (id) => parents.get(id), (id) => parents.has(id), r.fail);
    let model: string | undefined;
    const messages: Message[] = path.map((id) => {
      const b = body(id);
      const sender = r.str(b.sender, `response ${id}.sender`);
      const role = ROLES[sender.toLowerCase()];
      if (!role) throw r.fail(`response ${id}.sender`, `is ${JSON.stringify(sender)}`);
      if (role === "assistant") model = r.optStr(b.model, `response ${id}.model`) ?? model;
      return { role, text: r.str(b.message, `response ${id}.message`), createdAt: at(id), attachments: [] };
    });
    return {
      provider: "grok",
      id: r.str(c.conversationId, "conversation.conversationId"),
      title: r.optStr(c.title, "conversation.title") ?? "",
      createdAt: r.time(c.createTime, "conversation.createTime"),
      updatedAt: r.time(c.modifyTime ?? c.createTime, "conversation.modifyTime"),
      ...(model ? { model } : {}),
      messages,
    };
  },
};
