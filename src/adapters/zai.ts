// chat.z.ai, on open-webui with the upstream /api/v1. The page keeps a
// bearer in localStorage "token" (auth localStorage-bearer). Endpoints and
// sources: docs/providers/zai.md.
import { localStorageBearer } from "../auth/localStorage-bearer.js";
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import { defineReads } from "../reads.js";
import type { Adapter } from "./types.js";
import { epoch, fill, thread } from "./openwebui.js";
import { type Obj, reader } from "./read.js";

const r = reader("zai");

const OW = "https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers";
/** open-webui keeps a model's thinking in the content as these blocks; foxcache leaves them out. */
const REASONING = /<details\s+type="reasoning"[^>]*>[\s\S]*?<\/details>\s*/g;

function messageText(m: Obj, where: string): string {
  // Z.ai can send a message as a stub that only a POST (/messages/batch) fills in; foxcache reads by GET only.
  if (m.content === undefined) throw r.fail(`${where}.content`, "is missing (a stub that only a POST would fill in)");
  return r.str(m.content, `${where}.content`).replace(REASONING, "");
}

async function signedIn(http: Http): Promise<boolean> {
  try {
    const user = r.obj(await http.get("/api/v1/auths/"), "auths");
    r.str(user.id, "auths.id");
    // The site gives a visitor a guest token; a guest has no saved chats of its own.
    return user.role !== "guest";
  } catch (error) {
    if (error instanceof FoxcacheError && error.code === "logged-out") return false;
    throw error;
  }
}

export const zai: Adapter = {
  id: "zai",
  label: "Z.ai",
  origin: "https://chat.z.ai",
  auth: localStorageBearer({ key: "token" }),
  // GET only. DELETE /api/v1/chats/ deletes every chat, and POST /api/v1/auths/guest makes a guest: docs/providers/zai.md.
  reads: defineReads([
    { method: "GET", path: "/api/v1/auths/", source: `${OW}/auths.py#L173-L230` },
    { method: "GET", path: "/api/v1/chats/", query: ["page", "type", "include_pinned", "include_folders"], source: `${OW}/chats.py#L293-L332` },
    { method: "GET", path: "/api/v1/chats/archived", query: ["page"], source: `${OW}/chats.py#L1122-L1155` },
    { method: "GET", path: "/api/v1/chats/{id}", source: `${OW}/chats.py#L1409-L1425` },
    { method: "GET", path: "/api/v1/users/user/settings", source: `${OW}/users.py#L459-L475` },
  ]),
  // Each list is newest first, but the archived one comes after the main one (ZAI40).
  newestFirst: false,

  async detect(http) {
    return signedIn(http);
  },

  // The cursor is "<page>" in the main list, then "archived:<page>": upstream leaves archived chats out of the main list (ZAI40).
  async listConversations(http, cursor) {
    const archived = cursor?.startsWith("archived:") === true;
    const page = cursor ? Number(archived ? cursor.slice("archived:".length) : cursor) : 1;
    const answer = archived ? await http.get("/api/v1/chats/archived", { page }) : await http.get("/api/v1/chats/", { page, type: "default", include_pinned: true, include_folders: true });
    const rows = r.arr(answer, "chats").map((s, i) => r.obj(s, `chats[${i}]`));
    const items = rows.map((s, i) => ({ id: r.str(s.id, `chats[${i}].id`), title: r.optStr(s.title, `chats[${i}].title`) ?? "", updatedAt: epoch(r, s.updated_at, `chats[${i}].updated_at`) }));
    if (items.length) return { items, next: archived ? `archived:${page + 1}` : String(page + 1) };
    return { items, next: archived ? undefined : "archived:1" };
  },

  async getConversation(http, stub) {
    let answer: unknown;
    try {
      answer = await http.get(fill("/api/v1/chats/{id}", stub.id));
    } catch (error) {
      // Upstream answers a chat it cannot find with 401: a chat deleted since the list, if the session still holds (ZAI41).
      if (!(error instanceof FoxcacheError) || error.code !== "logged-out" || error.status !== 401 || !(await signedIn(http))) throw error;
      throw new FoxcacheError("not-found", `zai: chat ${stub.id} answered 401 while the session holds; it was deleted.`);
    }
    const data = r.obj(answer, "chat");
    const history = r.obj(r.obj(data.chat, "chat.chat").history, "chat.chat.history");
    return {
      provider: "zai",
      id: r.str(data.id, "chat.id"),
      title: r.optStr(data.title, "chat.title") ?? "",
      createdAt: epoch(r, data.created_at, "chat.created_at"),
      updatedAt: epoch(r, data.updated_at, "chat.updated_at"),
      messages: thread(r, history.messages, history.currentId ?? data.current_message_id, messageText),
    };
  },

  async preferences(http) {
    // null when the user never saved a setting.
    const settings = await http.get("/api/v1/users/user/settings");
    if (settings === null) return [];
    const ui = r.obj(settings, "settings").ui;
    if (ui === null || ui === undefined) return [];
    const text = r.optStr(r.obj(ui, "settings.ui").system, "settings.ui.system")?.trim();
    return text ? [{ provider: "zai", kind: "instructions", text }] : [];
  },
};
