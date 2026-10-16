// claude.ai. Cookies only. Endpoints and sources: docs/providers/claude.md.
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { cookie } from "../auth/cookie.js";
import { defineReads } from "../reads.js";
import type { Attachment, Message, Project } from "../schema.js";
import type { Adapter, Stub } from "./types.js";
import { type Obj, pathToRoot, reader } from "./read.js";

const r = reader("claude");
const AV = "https://github.com/kenn-io/agentsview/blob/e989152895065fc1c84784662b61fb3a69c7eeba/internal/importer/claude_ai_sync.go";
const QOL = "https://github.com/lugia19/Claude-QoL/blob/dc61e64e1314e534098ee0023e71c40c06765553/content";
const PAGE = 50;
/** The parent_message_uuid of the first message. */
const ROOT = "00000000-0000-4000-8000-000000000000";
const DETAIL = { tree: "True", rendering_mode: "messages", render_all_tools: "true" };

// One organization lookup per capture: the runner gives every call the same Http.
const orgs = new WeakMap<Http, Promise<string>>();
function org(http: Http): Promise<string> {
  let p = orgs.get(http);
  if (!p) {
    p = http.get("/api/organizations").then((list) => {
      const chat = r.arr(list, "/api/organizations").map((o, i) => r.obj(o, `/api/organizations[${i}]`)).find((o) => Array.isArray(o.capabilities) && o.capabilities.includes("chat"));
      // Signed in to an account that cannot chat (an API console only) is signed out for claude.ai.
      if (!chat) throw new FoxcacheError("logged-out", "claude: this account has no organization that can chat. Sign in to claude.ai with a chat account.");
      return r.str(chat.uuid, "organization uuid");
    });
    p.catch(() => orgs.delete(http));
    orgs.set(http, p);
  }
  return p;
}

function attachments(m: Obj, where: string): Attachment[] {
  const out: Attachment[] = [];
  const ids = new Set<string>();
  for (const [i, a] of r.arr(m.attachments ?? [], `${where}.attachments`).entries()) {
    const o = r.obj(a, `${where}.attachments[${i}]`);
    out.push({ name: r.str(o.file_name, `${where}.attachments[${i}].file_name`), ...(typeof o.id === "string" ? { id: o.id } : {}), ...(r.optSize(o.file_size) !== undefined ? { size: r.optSize(o.file_size) } : {}) });
  }
  for (const key of ["files", "files_v2"]) {
    for (const [i, f] of r.arr(m[key] ?? [], `${where}.${key}`).entries()) {
      const o = r.obj(f, `${where}.${key}[${i}]`);
      const id = r.str(o.file_uuid, `${where}.${key}[${i}].file_uuid`);
      if (ids.has(id)) continue;
      ids.add(id);
      out.push({ name: r.str(o.file_name, `${where}.${key}[${i}].file_name`), id });
    }
  }
  return out;
}

/** The text blocks of a message. Thinking, tool calls and tool results are not the visible reply. */
function messageText(m: Obj, where: string): string {
  if (!Array.isArray(m.content) || m.content.length === 0) return r.optStr(m.text, `${where}.text`) ?? "";
  return m.content
    .map((b, i) => r.obj(b, `${where}.content[${i}]`))
    .filter((b) => b.type === "text")
    .map((b, i) => r.str(b.text, `${where}.content[${i}].text`))
    .join("\n\n");
}

function stub(x: unknown, where: string): Stub {
  const o = r.obj(x, where);
  return { id: r.str(o.uuid, `${where}.uuid`), title: r.optStr(o.name, `${where}.name`) ?? "", updatedAt: r.time(o.updated_at, `${where}.updated_at`) };
}

export const claude: Adapter = {
  id: "claude",
  label: "Claude",
  origin: "https://claude.ai",
  auth: cookie,
  reads: defineReads([
    { method: "GET", path: "/api/organizations", source: `${AV}#L86-L101` },
    { method: "GET", path: "/api/organizations/{org}/chat_conversations_v2", query: ["limit", "offset", "consistency"], source: `${AV}#L102-L123` },
    { method: "GET", path: "/api/organizations/{org}/chat_conversations/{id}", query: ["tree", "rendering_mode", "render_all_tools"], source: "https://github.com/twilligon/claude-backup/blob/6184ba75e6e139a5de7dd88feacf69e8bcf312df/claude_backup/__init__.py#L402-L408" },
    { method: "GET", path: "/api/organizations/{org}/projects", source: "https://github.com/agoramachina/claude-exporter/blob/d7cc384fbaefd1c020e74392512b8cfb3292c7b9/chrome/content.js#L538-L560" },
    { method: "GET", path: "/api/organizations/{org}/projects/{id}", source: `${QOL}/helpers/claude-api.js#L1636-L1645` },
    { method: "GET", path: "/api/organizations/{org}/projects/{id}/docs", source: `${QOL}/helpers/claude-api.js#L1647-L1694` },
    { method: "GET", path: "/api/organizations/{org}/projects/{id}/files", source: `${QOL}/helpers/claude-api.js#L1647-L1694` },
    { method: "GET", path: "/api/organizations/{org}/memory", source: "https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/claude_ai/extractor/api_client.py#L139-L147" },
    { method: "GET", path: "/api/account_profile", source: `${QOL}/isolated/pref-switcher.js#L311-L316` },
  ]),
  newestFirst: true,

  async detect(http) {
    try {
      await org(http);
      return true;
    } catch (error) {
      // A challenge page or a changed shape is not signed out: it surfaces (P10).
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const offset = Number(cursor ?? 0);
    const path = `/api/organizations/${await org(http)}/chat_conversations_v2`;
    const page = r.obj(await http.get(path, { limit: PAGE, offset, consistency: "strong" }), "chat_conversations_v2");
    const items = r.arr(page.data, "chat_conversations_v2.data").map((s, i) => stub(s, `chat_conversations_v2.data[${i}]`));
    const more = r.bool(page.has_more, "chat_conversations_v2.has_more");
    return { items, next: more && items.length > 0 ? String(offset + items.length) : undefined };
  },

  async getConversation(http, s) {
    const c = r.obj(await http.get(`/api/organizations/${await org(http)}/chat_conversations/${encodeURIComponent(s.id)}`, DETAIL), "chat_conversation");
    const list = r.arr(c.chat_messages, "chat_messages").map((m, i) => r.obj(m, `chat_messages[${i}]`));
    const byId = new Map(list.map((m, i) => [r.str(m.uuid, `chat_messages[${i}].uuid`), m]));
    let ids: string[] = [];
    if (list.length > 0) {
      const leaf = r.str(c.current_leaf_message_uuid, "current_leaf_message_uuid");
      if (!byId.has(leaf)) throw r.fail("current_leaf_message_uuid", "is not a message of the conversation (no leaf)");
      ids = pathToRoot(
        leaf,
        (id) => {
          const parent = r.str(byId.get(id)!.parent_message_uuid, `message ${id}.parent_message_uuid`);
          return parent === ROOT ? undefined : parent;
        },
        (id) => byId.has(id),
        r.fail,
      );
    }
    const messages: Message[] = ids.map((id) => {
      const m = byId.get(id)!;
      const where = `message ${id}`;
      const sender = r.str(m.sender, `${where}.sender`);
      if (sender !== "human" && sender !== "assistant") throw r.fail(`${where}.sender`, `is ${JSON.stringify(sender)}`);
      const createdAt = r.optTime(m.created_at, `${where}.created_at`);
      return { role: sender === "human" ? "user" : "assistant", text: messageText(m, where), ...(createdAt ? { createdAt } : {}), attachments: attachments(m, where) };
    });
    const model = r.optStr(c.model, "model");
    const projectId = r.optStr(c.project_uuid, "project_uuid");
    return {
      provider: "claude",
      id: r.str(c.uuid, "uuid"),
      title: r.optStr(c.name, "name") ?? "",
      createdAt: r.time(c.created_at, "created_at"),
      updatedAt: r.time(c.updated_at, "updated_at"),
      ...(model ? { model } : {}),
      ...(projectId ? { projectId } : {}),
      messages,
    };
  },

  async projects(http) {
    const base = `/api/organizations/${await org(http)}/projects`;
    const out: Project[] = [];
    for (const [i, row] of r.arr(await http.get(base), "projects").entries()) {
      const id = r.str(r.obj(row, `projects[${i}]`).uuid, `projects[${i}].uuid`);
      const p = r.obj(await http.get(`${base}/${encodeURIComponent(id)}`), `project ${id}`);
      const files: Attachment[] = [];
      for (const [j, d] of r.arr(await http.get(`${base}/${encodeURIComponent(id)}/docs`), `project ${id} docs`).entries()) {
        const o = r.obj(d, `project ${id} docs[${j}]`);
        files.push({ name: r.str(o.file_name, `project ${id} docs[${j}].file_name`), id: r.str(o.uuid, `project ${id} docs[${j}].uuid`) });
      }
      for (const [j, f] of r.arr(await http.get(`${base}/${encodeURIComponent(id)}/files`), `project ${id} files`).entries()) {
        const o = r.obj(f, `project ${id} files[${j}]`);
        files.push({ name: r.str(o.file_name, `project ${id} files[${j}].file_name`), id: r.str(o.file_uuid, `project ${id} files[${j}].file_uuid`) });
      }
      const instructions = r.optStr(p.prompt_template, `project ${id}.prompt_template`);
      out.push({ provider: "claude", id, name: r.str(p.name, `project ${id}.name`), ...(instructions ? { instructions } : {}), files });
    }
    return out;
  },

  /** The account memory is one Markdown text: each line that is not a heading is one memory. */
  async memories(http) {
    const m = r.obj(await http.get(`/api/organizations/${await org(http)}/memory`), "memory");
    const text = r.optStr(m.memory, "memory.memory") ?? "";
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => ({ provider: "claude" as const, text: line.replace(/^[-*+]\s+/, "") }));
  },

  async preferences(http) {
    const text = r.optStr(r.obj(await http.get("/api/account_profile"), "account_profile").conversation_preferences, "account_profile.conversation_preferences");
    return text ? [{ provider: "claude", kind: "response-style", text }] : [];
  },
};
