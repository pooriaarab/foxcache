// www.genspark.ai. Every chat or agent run is a "project", and the HttpOnly
// session_id cookie is the only auth (auth cookie). Endpoints and sources:
// docs/providers/genspark.md.
//
// Genspark deletes a project with a GET (/api/project/delete?project_id=),
// so "a GET changes nothing" does not hold on this site. The reads list
// three exact paths, and http refuses any other before a request (H8).
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import type { Http, Query } from "../http.js";
import { defineReads } from "../reads.js";
import type { Message } from "../schema.js";
import type { Adapter, ListPage } from "./types.js";
import { type Obj, reader } from "./read.js";

const r = reader("genspark");
const LIMIT = 50;

const DOCS = "https://github.com/arosyihuddin/genspark-api/blob/d866ef003c87c7d32f5ada899bc9931daaf5521b/docs/GENSPARK_API_DOCS.md";
const SCRAPER = "https://github.com/DSciAILab/genspark_test/blob/19ef366b3641d7e6303a48911a6a630d1afe9ca8/src/scraper.ts";

/** GET a read and unwrap {status: 0, data}. */
async function read(http: Http, path: string, query?: Query): Promise<Obj> {
  const env = r.obj(await http.get(path, query), path);
  if (env.status !== 0) throw new FoxcacheError("provider-error", `genspark: ${path} answered status ${String(env.status)}: ${String(env.message ?? "")}`);
  return r.obj(env.data, `${path} data`);
}

function message(x: unknown, where: string): Message | undefined {
  const m = r.obj(x, where);
  const role = r.str(m.role, `${where}.role`);
  if (role === "tool" || role === "system") return undefined;
  if (role !== "user" && role !== "assistant") throw r.fail(`${where}.role`, `is ${JSON.stringify(role)}`);
  // An assistant turn that only calls a tool has content null.
  const text = r.optStr(m.content, `${where}.content`);
  return text === undefined ? undefined : { role, text, attachments: [] };
}

export const genspark: Adapter = {
  id: "genspark",
  label: "Genspark",
  origin: "https://www.genspark.ai",
  auth: cookie,
  // Nothing else under /api/project/: delete is a GET there.
  reads: defineReads([
    { method: "GET", path: "/api/is_login", source: "https://github.com/SharpWizard/genspark-py/blob/e0cb3be2c6ab5855cd5bf874e2ae35f16b568b22/src/genspark/client.py#L129-L133" },
    { method: "GET", path: "/api/project/my", query: ["from", "offset", "limit"], source: `${DOCS}#L94-L125` },
    { method: "GET", path: "/api/project", query: ["id"], source: `${SCRAPER}#L125-L135` },
  ]),
  // No source says how the list is sorted.
  newestFirst: false,

  async detect(http) {
    try {
      return r.bool((await read(http, "/api/is_login")).is_login, "/api/is_login data.is_login");
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor): Promise<ListPage> {
    const offset = cursor ? Number(cursor) : 0;
    const data = await read(http, "/api/project/my", { from: "agents", offset, limit: LIMIT });
    const rows = r.arr(data.projects, "project/my projects").map((p, i) => r.obj(p, `projects[${i}]`));
    // The list has no update time: ctime is the only time it gives.
    const items = rows.map((p, i) => ({ id: r.str(p.id, `projects[${i}].id`), title: r.optStr(p.name, `projects[${i}].name`) ?? "", updatedAt: r.time(p.ctime, `projects[${i}].ctime`) }));
    return { items, next: rows.length === LIMIT ? String(offset + LIMIT) : undefined };
  },

  async getConversation(http, s) {
    const p = await read(http, "/api/project", { id: s.id });
    const where = `project ${s.id}`;
    // A project that is not a chat (slides, docs) can have no session_state.
    const state = p.session_state === null || p.session_state === undefined ? {} : r.obj(p.session_state, `${where}.session_state`);
    const messages = r.arr(state.messages ?? [], `${where}.session_state.messages`).flatMap((m, i) => message(m, `${where}.messages[${i}]`) ?? []);
    const createdAt = r.time(p.ctime, `${where}.ctime`);
    const model = r.optStr(p.chat_model, `${where}.chat_model`);
    return {
      provider: "genspark",
      id: r.str(p.id, `${where}.id`),
      title: r.optStr(p.name, `${where}.name`) ?? "",
      createdAt,
      updatedAt: createdAt,
      ...(model ? { model } : {}),
      messages,
    };
  },
};
