// Codex cloud tasks on chatgpt.com (chatgpt.com/codex). They use the
// ChatGPT session token, so the ChatGPT adapter lists them after its
// projects and reads each one here. Endpoints and sources:
// docs/providers/codex.md.
import { FoxcacheError } from "../errors.js";
import type { Http, Read } from "../http.js";
import type { Conversation, Message } from "../schema.js";
import type { Stub } from "./types.js";
import { type Obj, reader } from "./read.js";

const r = reader("chatgpt codex");
const LIMIT = 20;

const CLIENT = "https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/src/client.rs";

/** The reads Codex capture adds to the ChatGPT adapter's. The list comes first: "list" would fit {taskId} too. */
export const CODEX_READS: Read[] = [
  { method: "GET", path: "/backend-api/wham/tasks/list", query: ["limit", "task_filter", "cursor"], source: `${CLIENT}#L440-L490` },
  { method: "GET", path: "/backend-api/wham/tasks/{taskId}", source: `${CLIENT}#L492-L508` },
];

/** A Codex task id, such as task_e_..., never a conversation uuid. */
export const isCodexTask = (id: string) => id.startsWith("task_");

/** One page of the task list. An account with no Codex (403 or 404 on the list) has no tasks. */
export async function codexPage(http: Http, cursor?: string): Promise<{ items: Stub[]; next?: string }> {
  let page: Obj;
  try {
    page = r.obj(await http.get("/backend-api/wham/tasks/list", { limit: LIMIT, task_filter: "current", cursor }), "tasks/list");
  } catch (error) {
    if (error instanceof FoxcacheError && (error.status === 403 || error.status === 404)) return { items: [] };
    throw error;
  }
  const items = r.arr(page.items, "tasks/list.items").map((x, i) => {
    const t = r.obj(x, `tasks/list.items[${i}]`);
    const id = r.str(t.id, `tasks/list.items[${i}].id`);
    if (!isCodexTask(id)) throw r.fail(`tasks/list.items[${i}].id`, `is ${JSON.stringify(id)}, not a task_ id`);
    // The list gives updated_at, or created_at alone (as the Codex CLI reads it).
    return { id, title: r.optStr(t.title, `tasks/list.items[${i}].title`) ?? "", updatedAt: r.seconds(t.updated_at ?? t.created_at, `tasks/list.items[${i}].updated_at`) };
  });
  const next = r.optStr(page.cursor, "tasks/list.cursor");
  return { items, next: items.length > 0 ? next : undefined };
}

/** The text of a content list: plain strings and {content_type: "text", text} parts. */
function texts(list: unknown, where: string): string[] {
  return r.arr(list ?? [], where).flatMap((f, i) => {
    if (typeof f === "string") return f.trim() ? [f] : [];
    const o = r.obj(f, `${where}[${i}]`);
    const type = r.optStr(o.content_type, `${where}[${i}].content_type`);
    const text = r.optStr(o.text, `${where}[${i}].text`);
    return type?.toLowerCase() === "text" && text ? [text] : [];
  });
}

/** The message items of a turn, as text. Diffs and other items are left out. */
function turnTexts(turn: Obj, key: "input_items" | "output_items", where: string): string[] {
  return r.arr(turn[key] ?? [], `${where}.${key}`).flatMap((x, i) => {
    const item = r.obj(x, `${where}.${key}[${i}]`);
    if (item.type !== "message") return [];
    if (key === "input_items" && typeof item.role === "string" && item.role.toLowerCase() !== "user") return [];
    return texts(item.content, `${where}.${key}[${i}].content`);
  });
}

function turnOf(d: Obj, key: string): Obj | undefined {
  return d[key] === null || d[key] === undefined ? undefined : r.obj(d[key], key);
}

/** One task: the prompt of the current user turn and the reply of the current assistant turn. */
export async function codexTask(http: Http, s: Stub): Promise<Conversation> {
  const d = r.obj(await http.get(`/backend-api/wham/tasks/${encodeURIComponent(s.id)}`), `task ${s.id}`);
  const task = r.obj(d.task, `task ${s.id}.task`);
  const messages: Message[] = [];
  const user = turnOf(d, "current_user_turn");
  const prompt = user ? turnTexts(user, "input_items", "current_user_turn") : [];
  if (user && prompt.length) {
    const createdAt = r.optSeconds(user.created_at, "current_user_turn.created_at");
    messages.push({ role: "user", text: prompt.join("\n\n"), ...(createdAt ? { createdAt } : {}), attachments: [] });
  }
  const reply: string[] = [];
  for (const key of ["current_diff_task_turn", "current_assistant_turn"]) {
    const turn = turnOf(d, key);
    if (!turn) continue;
    reply.push(...turnTexts(turn, "output_items", key));
    const log = turn.worklog === null || turn.worklog === undefined ? { messages: [] } : r.obj(turn.worklog, `${key}.worklog`);
    for (const [i, x] of r.arr(log.messages ?? [], `${key}.worklog.messages`).entries()) {
      const m = r.obj(x, `${key}.worklog.messages[${i}]`);
      const author = m.author === null || m.author === undefined ? {} : r.obj(m.author, `${key}.worklog.messages[${i}].author`);
      const content = m.content === null || m.content === undefined ? {} : r.obj(m.content, `${key}.worklog.messages[${i}].content`);
      if (author.role === "assistant") reply.push(...texts(content.parts, `${key}.worklog.messages[${i}].content.parts`));
    }
  }
  if (reply.length) messages.push({ role: "assistant", text: reply.join("\n\n"), attachments: [] });
  return {
    provider: "chatgpt",
    id: r.str(task.id, `task ${s.id}.task.id`),
    title: r.optStr(task.title, `task ${s.id}.task.title`) ?? s.title,
    createdAt: r.optSeconds(task.created_at, `task ${s.id}.task.created_at`) ?? s.updatedAt,
    updatedAt: s.updatedAt,
    messages,
  };
}
