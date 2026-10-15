// chatgpt.com. Every /backend-api call carries the bearer token that the
// page's own script gets from /api/auth/session; http gets it the same way
// and keeps it (auth "chatgpt-session"). Endpoints and sources:
// docs/providers/chatgpt.md.
import type { Http } from "../http.js";
import type { Attachment, Message, Preference, PreferenceKind, Project } from "../schema.js";
import type { Adapter, ListPage, Stub } from "./types.js";
import { type Obj, pathToRoot, reader } from "./read.js";

const r = reader("chatgpt");
const LIMIT = 100;
const PROJECT_LIMIT = 50; // more answers 422 (since 2026-09-29)
/** Content that is not the visible reply: reasoning, tool traffic and the custom instructions block. */
const HIDDEN = new Set(["thoughts", "reasoning_recap", "user_editable_context", "model_editable_context", "tether_browsing_display", "tether_quote", "execution_output", "system_error"]);
const PREFERENCES: Array<[string, PreferenceKind]> = [
  ["about_user_message", "about-me"],
  ["about_model_message", "response-style"],
  ["name_user_message", "name"],
  ["role_user_message", "occupation"],
];

/** Where the list is: the main list, the archived list, then each project's list. */
type Cursor = { src: "main" | "archived"; offset: number } | { src: "projects"; ids?: string[]; i: number; at: string };

function stub(x: unknown, where: string): Stub {
  const o = r.obj(x, where);
  return { id: r.str(o.id, `${where}.id`), title: r.optStr(o.title, `${where}.title`) ?? "", updatedAt: r.time(o.update_time, `${where}.update_time`) };
}

/** The ids of the user's projects, from every page of the sidebar. */
async function projectIds(http: Http): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let cursor: string | undefined; ; ) {
    const page = r.obj(await http.get("/backend-api/gizmos/snorlax/sidebar", { owned_only: true, conversations_per_gizmo: 0, limit: PROJECT_LIMIT, cursor }), "snorlax/sidebar");
    for (const [i, item] of r.arr(page.items, "snorlax/sidebar.items").entries()) {
      // Sources disagree on the nesting: items[].gizmo or items[].gizmo.gizmo.
      const g = r.obj(r.obj(item, `snorlax/sidebar.items[${i}]`).gizmo, `snorlax/sidebar.items[${i}].gizmo`);
      const gizmo = typeof g.gizmo === "object" && g.gizmo !== null ? r.obj(g.gizmo, `snorlax/sidebar.items[${i}].gizmo.gizmo`) : g;
      ids.push(r.str(gizmo.id, `snorlax/sidebar.items[${i}].gizmo.id`));
    }
    const next = r.optStr(page.cursor, "snorlax/sidebar.cursor");
    if (!next || seen.has(next)) return ids;
    seen.add(next);
    cursor = next;
  }
}

function contentText(content: Obj, where: string): string | undefined {
  const type = r.str(content.content_type, `${where}.content_type`);
  if (HIDDEN.has(type)) return undefined;
  if (Array.isArray(content.parts)) return content.parts.filter((p): p is string => typeof p === "string").join("\n\n");
  if (typeof content.text === "string") return content.text;
  throw r.fail(`${where}`, `has content_type ${JSON.stringify(type)} with no text`);
}

function attachments(meta: Obj, where: string): Attachment[] {
  return r.arr(meta.attachments ?? [], `${where}.metadata.attachments`).map((a, i) => {
    const o = r.obj(a, `${where}.metadata.attachments[${i}]`);
    const size = r.optSize(o.size);
    const mimeType = r.optStr(o.mime_type, `${where}.metadata.attachments[${i}].mime_type`);
    return { name: r.str(o.name, `${where}.metadata.attachments[${i}].name`), ...(typeof o.id === "string" ? { id: o.id } : {}), ...(mimeType ? { mimeType } : {}), ...(size !== undefined ? { size } : {}) };
  });
}

export const chatgpt: Adapter = {
  id: "chatgpt",
  label: "ChatGPT",
  origin: "https://chatgpt.com",
  auth: "chatgpt-session",
  // Three lists in a row, so a page with no change does not end the capture.
  newestFirst: false,

  async detect(http) {
    try {
      r.obj(await http.get("/backend-api/me"), "/backend-api/me");
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor): Promise<ListPage> {
    const c: Cursor = cursor ? (JSON.parse(cursor) as Cursor) : { src: "main", offset: 0 };
    if (c.src !== "projects") {
      const query = { offset: c.offset, limit: LIMIT, order: "updated", is_archived: c.src === "archived", hide_snorlax: true };
      const page = r.obj(await http.get("/backend-api/conversations", query), "conversations");
      const items = r.arr(page.items, "conversations.items").map((s, i) => stub(s, `conversations.items[${i}]`));
      const total = typeof page.total === "number" ? page.total : 0;
      const more = items.length > 0 && c.offset + LIMIT < total;
      const next: Cursor = more ? { src: c.src, offset: c.offset + LIMIT } : c.src === "main" ? { src: "archived", offset: 0 } : { src: "projects", i: 0, at: "0" };
      return { items, next: JSON.stringify(next) };
    }
    const ids = c.ids ?? (await projectIds(http));
    const id = ids[c.i];
    if (id === undefined) return { items: [] };
    const page = r.obj(await http.get(`/backend-api/gizmos/${encodeURIComponent(id)}/conversations`, { cursor: c.at, limit: PROJECT_LIMIT }), `project ${id} conversations`);
    const items = r.arr(page.items, `project ${id} conversations.items`).map((s, i) => stub(s, `project ${id} conversations.items[${i}]`));
    const at = r.optStr(page.cursor, `project ${id} conversations.cursor`);
    const next: Cursor | undefined = at && items.length > 0 ? { src: "projects", ids, i: c.i, at } : c.i + 1 < ids.length ? { src: "projects", ids, i: c.i + 1, at: "0" } : undefined;
    return { items, next: next && JSON.stringify(next) };
  },

  async getConversation(http, s) {
    const c = r.obj(await http.get(`/backend-api/conversation/${encodeURIComponent(s.id)}`), "conversation");
    const mapping = r.obj(c.mapping, "mapping");
    const node = (id: string) => r.obj(mapping[id], `mapping.${id}`);
    const leaf = r.str(c.current_node, "current_node");
    if (!(leaf in mapping)) throw r.fail("current_node", "is not a node of the mapping");
    const ids = pathToRoot(leaf, (id) => node(id).parent as string | null, (id) => id in mapping, r.fail);
    const messages: Message[] = [];
    for (const id of ids) {
      const m = node(id).message;
      if (m === null || m === undefined) continue;
      const where = `message ${id}`;
      const msg = r.obj(m, where);
      const meta = msg.metadata === null || msg.metadata === undefined ? {} : r.obj(msg.metadata, `${where}.metadata`);
      const role = r.str(r.obj(msg.author, `${where}.author`).role, `${where}.author.role`);
      if (meta.is_visually_hidden_from_conversation === true || role === "system" || role === "tool") continue;
      if (role !== "user" && role !== "assistant") throw r.fail(`${where}.author.role`, `is ${JSON.stringify(role)}`);
      if (role === "assistant" && (msg.recipient ?? "all") !== "all") continue;
      const text = contentText(r.obj(msg.content, `${where}.content`), `${where}.content`);
      const files = attachments(meta, where);
      if (text === undefined || (text === "" && files.length === 0)) continue;
      const createdAt = r.optSeconds(msg.create_time, `${where}.create_time`);
      messages.push({ role, text, ...(createdAt ? { createdAt } : {}), attachments: files });
    }
    const updated = r.seconds(c.update_time, "update_time");
    const model = r.optStr(c.default_model_slug, "default_model_slug");
    const gizmo = r.optStr(c.gizmo_id, "gizmo_id");
    return {
      provider: "chatgpt",
      id: r.str(c.conversation_id ?? s.id, "conversation_id"),
      title: r.optStr(c.title, "title") ?? "",
      createdAt: r.seconds(c.create_time, "create_time"),
      // The list time and this time can differ by a rounding; keep the later one, so a second capture skips it.
      updatedAt: s.updatedAt && s.updatedAt > updated ? s.updatedAt : updated,
      ...(model ? { model } : {}),
      ...(gizmo?.startsWith("g-p-") ? { projectId: gizmo } : {}),
      messages,
    };
  },

  async projects(http) {
    const out: Project[] = [];
    for (const id of await projectIds(http)) {
      const detail = r.obj(await http.get(`/backend-api/gizmos/${encodeURIComponent(id)}`), `project ${id}`);
      const g = r.obj(detail.gizmo, `project ${id}.gizmo`);
      const files = r.arr(detail.files ?? [], `project ${id}.files`).map((f, i) => {
        const o = r.obj(f, `project ${id}.files[${i}]`);
        const fileId = r.optStr(o.file_id ?? o.id, `project ${id}.files[${i}].file_id`);
        const mimeType = r.optStr(o.type, `project ${id}.files[${i}].type`);
        const size = r.optSize(o.size);
        return { name: r.str(o.name, `project ${id}.files[${i}].name`), ...(fileId ? { id: fileId } : {}), ...(mimeType ? { mimeType } : {}), ...(size !== undefined ? { size } : {}) };
      });
      const instructions = r.optStr(g.instructions, `project ${id}.instructions`);
      out.push({ provider: "chatgpt", id, name: r.str(r.obj(g.display, `project ${id}.display`).name, `project ${id}.display.name`), ...(instructions ? { instructions } : {}), files });
    }
    return out;
  },

  async memories(http) {
    const page = r.obj(await http.get("/backend-api/memories", { include_memory_entries: true }), "memories");
    return r.arr(page.memories, "memories.memories").map((x, i) => {
      const m = r.obj(x, `memories[${i}]`);
      const createdAt = r.optSeconds(m.created_timestamp, `memories[${i}].created_timestamp`);
      return { provider: "chatgpt" as const, id: r.str(m.id, `memories[${i}].id`), text: r.str(m.content, `memories[${i}].content`), ...(createdAt ? { createdAt } : {}) };
    });
  },

  async preferences(http) {
    const o = r.obj(await http.get("/backend-api/user_system_messages"), "user_system_messages");
    const out: Preference[] = [];
    for (const [key, kind] of PREFERENCES) {
      const text = r.optStr(o[key], `user_system_messages.${key}`);
      if (text?.trim()) out.push({ provider: "chatgpt", kind, text });
    }
    return out;
  },
};
