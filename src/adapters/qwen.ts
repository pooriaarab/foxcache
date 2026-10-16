// chat.qwen.ai, an open-webui fork with its own /api/v2. The page keeps a
// bearer in localStorage "token" and sends the header "source: web" (auth
// with-headers on localStorage-bearer). Endpoints and sources:
// docs/providers/qwen.md.
import { localStorageBearer } from "../auth/localStorage-bearer.js";
import { withHeaders } from "../auth/with-headers.js";
import { FoxcacheError } from "../errors.js";
import type { Http, Query } from "../http.js";
import { defineReads } from "../reads.js";
import type { Memory, Preference, PreferenceKind } from "../schema.js";
import type { Adapter, Stub } from "./types.js";
import { epoch, fill, thread } from "./openwebui.js";
import { MAX_SUBPAGES, type Obj, reader } from "./read.js";

const r = reader("qwen");

const MA = "https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen";
const MEMORY_PAGE = 50;
const PERSONALIZATION: Record<string, PreferenceKind> = { name: "name", description: "about-me", instruction: "instructions", style: "response-style" };

/** The error of a success: false answer: logged-out when its data names the session, else provider-error (QWEN1). */
function failed(env: Obj, path: string): FoxcacheError {
  // Not the site's text in the message: it may echo a prompt or a token (QWEN41).
  const why = JSON.stringify(env.data ?? null).slice(0, 200);
  if (/unauthori[sz]ed|not.?log|login|token/i.test(why)) return new FoxcacheError("logged-out", `qwen: ${path} says the session is not valid: sign in again.`);
  return new FoxcacheError("provider-error", `qwen: ${path} answered success: false.`);
}

/** Every v2 answer is {success, request_id, data}; a failure can come with HTTP 200. */
async function v2(http: Http, path: string, query?: Query): Promise<unknown> {
  const env = r.obj(await http.get(path, query), path);
  if (env.success === true) return env.data;
  if (env.success !== false) throw r.fail(`${path} success`, "is not true or false");
  throw failed(env, path);
}

/** The pinned chats with main page 1, then the main list (chats outside projects), then each project's list, page by page from 1; an empty page ends a list. */
interface Cursor {
  page: number;
  projects?: string[];
  at?: number;
}

const stubOf = (s: Obj, where: string): Stub => ({ id: r.str(s.id, `${where}.id`), title: r.optStr(s.title, `${where}.title`) ?? "", updatedAt: epoch(r, s.updated_at, `${where}.updated_at`) });
const projectRows = async (http: Http) => r.arr(await v2(http, "/api/v2/projects/"), "projects").map((p, i) => r.obj(p, `projects[${i}]`));

/** Text of a message: the content_list blocks, or the flat content. reasoning_content is not kept. */
function messageText(m: Obj, where: string): string {
  const blocks = r.arr(m.content_list ?? [], `${where}.content_list`).map((b, i) => r.optStr(r.obj(b, `${where}.content_list[${i}]`).content, `${where}.content_list[${i}].content`) ?? "");
  const joined = blocks.filter(Boolean).join("\n\n");
  return joined || (r.optStr(m.content, `${where}.content`) ?? "");
}

export const qwen: Adapter = {
  id: "qwen",
  label: "Qwen Chat",
  origin: "https://chat.qwen.ai",
  auth: withHeaders(localStorageBearer({ key: "token" }), { source: "web" }),
  // GET only. DELETE /api/v2/chats/ deletes every chat: docs/providers/qwen.md.
  reads: defineReads([
    { method: "GET", path: "/api/v1/auths/", source: `${MA}/extractor/api_client.py#L8` },
    { method: "GET", path: "/api/v2/chats/", query: ["page", "project_id"], source: `${MA}/extractor/api_client.py#L74-L164` },
    { method: "GET", path: "/api/v2/chats/pinned", source: `${MA}/extractor/api_client.py#L154-L163` },
    { method: "GET", path: "/api/v2/chats/{id}", source: "https://github.com/R1y3n/qwenDataExport/blob/6a727185744e83c342b615380d153dadf9056fb3/main.py#L111-L126" },
    { method: "GET", path: "/api/v2/projects/", source: `${MA}/extractor/api_client.py#L171-L176` },
    { method: "GET", path: "/api/v2/memories/", query: ["page_size", "page_num"], source: `${MA}/extractor/account_memory.py#L23-L40` },
    { method: "GET", path: "/api/v2/users/user/settings", source: `${MA}/memory_parser.py#L105-L120` },
  ]),
  // Project chats come after the main list.
  newestFirst: false,

  async detect(http) {
    try {
      const user = r.obj(await http.get("/api/v1/auths/"), "auths");
      // A failure for another reason than the session is not "signed out" (QWEN42).
      if (user.success === false) throw failed(user, "/api/v1/auths/");
      r.str((user.success === true ? r.obj(user.data, "auths data") : user).id, "auths id");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const c: Cursor = cursor ? (JSON.parse(cursor) as Cursor) : { page: 1 };
    const project = c.projects?.[c.at ?? 0];
    // Pinned chats have a list of their own, which the main list may or may not repeat: once, with page 1 (QWEN40).
    const pinned = cursor === undefined ? r.arr(await v2(http, "/api/v2/chats/pinned"), "pinned").map((s, i) => stubOf(r.obj(s, `pinned[${i}]`), `pinned[${i}]`)) : [];
    const rows = r.arr(await v2(http, "/api/v2/chats/", { page: c.page, project_id: project }), "chats").map((s, i) => r.obj(s, `chats[${i}]`));
    const listed = rows.map((s, i) => stubOf(s, `chats[${i}]`));
    const items = [...pinned, ...listed.filter((s) => !pinned.some((p) => p.id === s.id))];
    if (listed.length) return { items, next: JSON.stringify({ ...c, page: c.page + 1 }) };
    const projects = c.projects ?? (await projectRows(http)).map((p, i) => r.str(p.id, `projects[${i}].id`));
    const at = c.projects ? (c.at ?? 0) + 1 : 0;
    return { items, next: at < projects.length ? JSON.stringify({ page: 1, projects, at }) : undefined };
  },

  async getConversation(http, stub) {
    const data = r.obj(await v2(http, fill("/api/v2/chats/{id}", stub.id)), "chat");
    const chat = r.obj(data.chat, "chat.chat");
    const history = r.obj(chat.history, "chat.chat.history");
    const projectId = r.optStr(data.project_id, "chat.project_id");
    return {
      provider: "qwen",
      id: r.str(data.id, "chat.id"),
      title: r.optStr(data.title, "chat.title") ?? "",
      createdAt: epoch(r, data.created_at, "chat.created_at"),
      updatedAt: epoch(r, data.updated_at, "chat.updated_at"),
      ...(projectId ? { projectId } : {}),
      messages: thread(r, history.messages, data.currentId ?? history.currentId, messageText),
    };
  },

  async projects(http) {
    return (await projectRows(http)).map((p, i) => {
      const instructions = r.optStr(p.custom_instruction, `projects[${i}].custom_instruction`);
      return { provider: "qwen", id: r.str(p.id, `projects[${i}].id`), name: r.str(p.name, `projects[${i}].name`), ...(instructions ? { instructions } : {}), files: [] };
    });
  },

  async memories(http) {
    const out = new Map<string, Memory>();
    for (let page = 1; ; page++) {
      if (page > MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `qwen: memories did not end after ${MAX_SUBPAGES} pages.`);
      const data = r.obj(await v2(http, "/api/v2/memories/", { page_size: MEMORY_PAGE, page_num: page }), "memories");
      const total = r.num(data.total, "memories.total");
      const nodes = r.arr(data.memory_nodes, "memories.memory_nodes").map((n, i) => r.obj(n, `memory_nodes[${i}]`));
      const before = out.size;
      for (const [i, n] of nodes.entries()) {
        const id = r.str(n.memory_node_id, `memory_nodes[${i}].memory_node_id`);
        out.set(id, { provider: "qwen", id, text: r.str(n.content, `memory_nodes[${i}].content`), createdAt: epoch(r, n.created_at, `memory_nodes[${i}].created_at`) });
      }
      if (nodes.length && out.size === before) throw new FoxcacheError("pagination-loop", `qwen: memories page ${page} gave the same memories again.`);
      if (nodes.length === 0 || out.size >= total) return [...out.values()];
    }
  },

  async preferences(http) {
    const data = r.obj(await v2(http, "/api/v2/users/user/settings"), "settings");
    // null when the user never set it.
    if (data.personalization === null || data.personalization === undefined) return [];
    const p = r.obj(data.personalization, "settings.personalization");
    const out: Preference[] = [];
    for (const [key, kind] of Object.entries(PERSONALIZATION)) {
      const text = r.optStr(p[key], `settings.personalization.${key}`)?.trim();
      if (text) out.push({ provider: "qwen", kind, text });
    }
    return out;
  },
};
