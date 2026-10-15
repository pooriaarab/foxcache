// chat.mistral.ai (Le Chat, now also called Vibe). Cookies only. Reads are
// tRPC GET calls: /api/trpc/<proc>?batch=1&input={"0":{"json":...}}.
// Endpoints and sources: docs/providers/mistral.md.
import { FoxcacheError } from "../errors.js";
import type { Http } from "../http.js";
import type { Message, Role } from "../schema.js";
import type { Adapter } from "./types.js";
import { type Obj, reader } from "./read.js";

const r = reader("mistral");
const ROLES: Record<string, Role> = { user: "user", assistant: "assistant", system: "system" };

/** Call one or more tRPC procedures in one GET and return their payloads. */
async function trpc(http: Http, procs: string[], inputs: unknown[]): Promise<unknown[]> {
  const name = procs.join(",");
  const input = JSON.stringify(Object.fromEntries(inputs.map((json, i) => [String(i), { json }])));
  const batch = r.arr(await http.get(`/api/trpc/${name}`, { batch: 1, input }), name);
  if (batch.length !== procs.length) throw r.fail(name, `gave ${batch.length} answers for ${procs.length} calls`);
  return batch.map((entry, i) => {
    const o = r.obj(entry, `${procs[i]} answer`);
    if (o.error !== undefined) {
      const e = r.obj(r.obj(o.error, `${procs[i]} error`).json, `${procs[i]} error.json`);
      const data = (e.data ?? {}) as Obj;
      const message = `mistral: ${procs[i]} failed: ${String(e.message ?? data.code ?? "unknown error")}`;
      if (data.code === "UNAUTHORIZED" || data.httpStatus === 401 || data.httpStatus === 403) throw new FoxcacheError("logged-out", `${message}. Sign in to chat.mistral.ai.`);
      throw new FoxcacheError("provider-error", message);
    }
    return r.obj(r.obj(o.result, `${procs[i]} result`).data, `${procs[i]} result.data`).json;
  });
}

const title = (c: Obj, where: string) => r.optStr(c.userTitle, `${where}.userTitle`) ?? r.optStr(c.generatedTitle, `${where}.generatedTitle`) ?? r.optStr(c.title, `${where}.title`) ?? "";

function messageText(m: Obj, where: string): string {
  if (Array.isArray(m.contentChunks) && m.contentChunks.length > 0) {
    return m.contentChunks
      .map((c, i) => r.obj(c, `${where}.contentChunks[${i}]`))
      .filter((c) => c.type === "text")
      .map((c, i) => r.str(c.text, `${where}.contentChunks[${i}].text`))
      .join("");
  }
  return r.optStr(m.content, `${where}.content`) ?? "";
}

export const mistral: Adapter = {
  id: "mistral",
  label: "Le Chat",
  origin: "https://chat.mistral.ai",
  // No source confirms the order of chat.last.
  newestFirst: false,

  async detect(http) {
    try {
      const [session] = await trpc(http, ["user.session"], [{}]);
      const user = (session as Obj | null)?.user as Obj | null | undefined;
      return typeof user?.id === "string" && user.id !== "";
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const [page] = await trpc(http, ["chat.last"], [cursor ? { cursor } : {}]);
    const o = r.obj(page, "chat.last");
    const items = r.arr(o.items, "chat.last.items").map((x, i) => {
      const c = r.obj(x, `chat.last.items[${i}]`);
      return { id: r.str(c.id, `chat.last.items[${i}].id`), title: title(c, `chat.last.items[${i}]`), updatedAt: r.time(c.updatedAt, `chat.last.items[${i}].updatedAt`) };
    });
    const next = r.optStr(o.nextCursor, "chat.last.nextCursor");
    return { items, next: items.length > 0 ? next : undefined };
  },

  async getConversation(http, stub) {
    const [chat, first] = await trpc(http, ["chat.byId", "message.all"], [{ id: stub.id }, { chatId: stub.id }]);
    const c = r.obj(chat, "chat.byId");
    const rows: Obj[] = [];
    const seen = new Set<string>();
    for (let page = r.obj(first, "message.all"); ; ) {
      rows.push(...r.arr(page.items, "message.all.items").map((m, i) => r.obj(m, `message.all.items[${i}]`)));
      const next = r.optStr(page.nextCursor, "message.all.nextCursor");
      if (!next) break;
      if (seen.has(next)) throw r.fail("message.all.nextCursor", "came again (a loop)");
      seen.add(next);
      const [more] = await trpc(http, ["message.all"], [{ chatId: stub.id, cursor: next }]);
      page = r.obj(more, "message.all");
    }
    // The visible thread: the latest version of each message, by turn, the user first.
    const visible = rows
      .filter((m) => m.nextVersion === null || m.nextVersion === undefined)
      .map((m) => {
        const where = `message ${String(m.id)}`;
        const role = ROLES[r.str(m.role, `${where}.role`)];
        if (!role) throw r.fail(`${where}.role`, `is ${JSON.stringify(m.role)}`);
        // A missing turn must not reorder the thread (P6).
        const turn = r.num(m.turn, `${where}.turn`);
        return { m, role, turn, at: r.time(m.createdAt, `${where}.createdAt`), where };
      })
      .toSorted((a, b) => a.turn - b.turn || (a.role === "user" ? 0 : 1) - (b.role === "user" ? 0 : 1) || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    const messages: Message[] = visible.map(({ m, role, at, where }) => ({ role, text: messageText(m, where), createdAt: at, attachments: [] }));
    const model = visible.filter((v) => v.role === "assistant").map((v) => r.optStr(v.m.model, `${v.where}.model`)).findLast(Boolean);
    const projectId = r.optStr(c.projectId, "chat.byId.projectId");
    return {
      provider: "mistral",
      id: r.str(c.id, "chat.byId.id"),
      title: title(c, "chat.byId"),
      createdAt: r.time(c.createdAt, "chat.byId.createdAt"),
      updatedAt: r.time(c.updatedAt, "chat.byId.updatedAt"),
      ...(model ? { model } : {}),
      ...(projectId ? { projectId } : {}),
      messages,
    };
  },
};
