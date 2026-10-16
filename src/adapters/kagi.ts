// assistant.kagi.com (Kagi Assistant). The session cookie kagi_session is
// HttpOnly, so the cookies alone (auth cookie). Reads are JSON GET calls
// under /api/. Endpoints and sources: docs/providers/kagi.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message } from "../schema.js";
import { MAX_SUBPAGES, type Obj, reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("kagi");
const DOC = "https://github.com/marshallku/kagi/blob/83c2fa8243a1bea20599b14b9386c3f185545cf5/docs/api.md";
const CLI = "https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs";
const PAGE = 100;

/** The settings and custom assistants of /api/init. */
async function init(http: Http): Promise<Obj> {
  const o = r.obj(await http.get("/api/init"), "init");
  r.obj(o.settings, "init.settings");
  return o;
}

/** One message row: its uuid, its model, and the message. role is user or assistant, and text is the Markdown content. */
function message(x: unknown, where: string): { id: string; model?: string; message: Message } {
  const m = r.obj(x, where);
  const role = r.str(m.role, `${where}.role`);
  if (role !== "user" && role !== "assistant") throw r.fail(`${where}.role`, `is ${JSON.stringify(role)}`);
  const createdAt = r.optTime(m.created_at, `${where}.created_at`);
  const model = r.optStr(m.model_name, `${where}.model_name`);
  return { id: r.str(m.uuid, `${where}.uuid`), ...(model ? { model } : {}), message: { role, text: r.str(m.content, `${where}.content`), ...(createdAt ? { createdAt } : {}), attachments: [] } };
}
const rows = (page: unknown, where: string) => {
  const o = r.obj(page, where);
  return { items: r.arr(o.items, `${where}.items`), more: r.bool(o.has_more, `${where}.has_more`) };
};

export const kagi: Adapter = {
  id: "kagi",
  label: "Kagi Assistant",
  origin: "https://assistant.kagi.com",
  auth: cookie,
  reads: defineReads([
    { method: "GET", path: "/api/init", source: `${DOC}#L99-L221` },
    { method: "GET", path: "/api/conversations", query: ["limit", "all", "after_id"], source: `${CLI}#L3762-L3769` },
    // GET only: PATCH and DELETE on /api/conversations/{uuid} write, and are not listed.
    { method: "GET", path: "/api/conversations/{id}/init", source: `${DOC}#L365-L399` },
    { method: "GET", path: "/api/branches/{branch}/messages", query: ["limit", "after_id"], source: `${CLI}#L3780-L3830` },
  ]),
  // No source gives the order of the list.
  newestFirst: false,

  async detect(http) {
    try {
      await init(http);
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const page = rows(await http.get("/api/conversations", { limit: PAGE, all: true, after_id: cursor }), "conversations");
    const items = page.items.map((x, i) => {
      const where = `conversations.items[${i}]`;
      const item = r.obj(x, where);
      // An item is {conversation, snippet, rank}, or the bare conversation.
      const c = item.conversation === undefined ? item : r.obj(item.conversation, `${where}.conversation`);
      return { id: r.str(c.uuid, `${where}.uuid`), title: r.optStr(c.title, `${where}.title`) ?? "", updatedAt: r.time(c.updated_at, `${where}.updated_at`) };
    });
    return { items, next: page.more && items.length > 0 ? items.at(-1)!.id : undefined };
  },

  async getConversation(http, stub) {
    const o = r.obj(await http.get(`/api/conversations/${stub.id}/init`), "conversation init");
    const c = r.obj(o.conversation, "conversation");
    let page = rows(o.messages, "messages");
    const all = page.items.map((m, i) => message(m, `messages[${i}]`));
    const seen = new Set<string>();
    for (let pages = 0; page.more; pages++) {
      if (pages >= MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `kagi: the older messages did not end after ${MAX_SUBPAGES} pages.`);
      const after = all[0]?.id;
      if (after === undefined) throw r.fail("messages", "has more pages, but no message to go on from");
      if (seen.has(after)) throw new FoxcacheError("pagination-loop", "kagi: the older messages gave the same page again.");
      seen.add(after);
      const branch = r.str(r.obj(o.active_branch, "active_branch").uuid, "active_branch.uuid");
      page = rows(r.obj(await http.get(`/api/branches/${branch}/messages`, { limit: PAGE, after_id: after }), "branch messages").messages, "branch messages");
      // A page of older messages is newest first.
      all.unshift(...page.items.map((m, i) => message(m, `branch messages[${i}]`)).toReversed());
      if (all.length > MAX_MESSAGES) throw new FoxcacheError("too-large", `kagi: the chat has more than ${MAX_MESSAGES} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
    }
    const model = all.findLast((m) => m.message.role === "assistant" && m.model)?.model ?? r.optStr(c.model_name, "conversation.model_name");
    const messages = all.map((m) => m.message);
    return {
      provider: "kagi",
      id: r.str(c.uuid, "conversation.uuid"),
      title: r.optStr(c.title, "conversation.title") ?? "",
      createdAt: r.time(c.created_at, "conversation.created_at"),
      updatedAt: r.time(c.updated_at, "conversation.updated_at"),
      ...(model ? { model } : {}),
      messages,
    };
  },

  async preferences(http) {
    const text = r.optStr(r.obj((await init(http)).settings, "init.settings").custom_instructions, "settings.custom_instructions");
    return text ? [{ provider: "kagi", kind: "instructions", text }] : [];
  },

  async library(http) {
    return r.arr((await init(http)).custom_assistants ?? [], "init.custom_assistants").map((x, i) => {
      const a = r.obj(x, `custom_assistants[${i}]`);
      return { provider: "kagi", id: r.str(a.uuid, `custom_assistants[${i}].uuid`), name: r.str(a.name, `custom_assistants[${i}].name`), kind: "agent" };
    });
  },
};
