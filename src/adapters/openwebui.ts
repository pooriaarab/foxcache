// The parts that open-webui based sites share (chat.qwen.ai, chat.z.ai):
// the page keeps a bearer in localStorage "token" (auth localStorage-bearer),
// and a chat holds its messages as a map with parent links.
// Upstream: https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/models/chats.py#L277-L293
import { FoxcacheError } from "../errors.js";
import type { Attachment, Message } from "../schema.js";
import { type Obj, pathToRoot, type reader } from "./read.js";

type Reader = ReturnType<typeof reader>;

/**
 * A path from one of an adapter's read templates: "{id}" becomes the id.
 * http refuses an id that would leave the segment (H10). An empty id is
 * refused here, because open-webui's `/chats/{id}` with no id is the list
 * path `/chats/`, a read of its own.
 */
export function fill(template: string, id: string): string {
  if (!template.includes("{id}")) throw new FoxcacheError("not-allowed", `${template} takes no id.`);
  if (!id) throw new FoxcacheError("not-allowed", `${template} needs an id.`);
  return template.replace("{id}", id);
}

/** Epoch seconds as a number or as a numeric string (Qwen sends both), as ISO-8601 UTC (P4). */
export function epoch(r: Reader, x: unknown, where: string): string {
  return r.seconds(typeof x === "string" && /^\d+(\.\d+)?$/.test(x) ? Number(x) : x, where);
}

/** File metadata of a message: name, id and size. The URL and the contents are left out (P5). */
function files(r: Reader, m: Obj, where: string): Attachment[] {
  return r.arr(m.files ?? [], `${where}.files`).map((f, i) => {
    const o = r.obj(f, `${where}.files[${i}]`);
    const size = r.optSize(o.size);
    return { name: r.str(o.name ?? o.file_name, `${where}.files[${i}].name`), ...(typeof o.id === "string" ? { id: o.id } : {}), ...(size !== undefined ? { size } : {}) };
  });
}

/**
 * The visible thread of a chat: from the leaf up `parentId` to the root
 * (`parentId` null), root first. `messages` is the map of id to message.
 * `text` gives the text of one message; each site has its own shape.
 */
export function thread(r: Reader, messages: unknown, leaf: unknown, text: (m: Obj, where: string) => string): Message[] {
  const map = r.obj(messages, "chat.history.messages");
  const byId = new Map(Object.entries(map).map(([id, m]) => [id, r.obj(m, `message ${id}`)]));
  if (byId.size === 0) return [];
  if (typeof leaf !== "string" || !byId.has(leaf)) throw r.fail("currentId", "is not a message of the chat (no leaf)");
  const parentOf = (id: string) => {
    const p = byId.get(id)!.parentId;
    if (p === null || p === undefined) return undefined;
    return r.str(p, `message ${id}.parentId`);
  };
  return pathToRoot(leaf, parentOf, (id) => byId.has(id), r.fail).map((id) => {
    const m = byId.get(id)!;
    const where = `message ${id}`;
    const role = r.str(m.role, `${where}.role`);
    if (role !== "user" && role !== "assistant" && role !== "system") throw r.fail(`${where}.role`, `is ${JSON.stringify(role)}`);
    const createdAt = m.timestamp === null || m.timestamp === undefined ? undefined : epoch(r, m.timestamp, `${where}.timestamp`);
    return { role, text: text(m, where), ...(createdAt ? { createdAt } : {}), attachments: files(r, m, where) };
  });
}
