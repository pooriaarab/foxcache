// GitHub Copilot Chat on github.com/copilot. The API is another site,
// api.individual.githubcopilot.com, which answers CORS for the github.com
// page. The page caches its chat token in localStorage COPILOT_AUTH_TOKEN
// ({value, expiration}) and sends "Authorization: GitHub-Bearer <value>"
// (auth localStorage-bearer, sent only before its expiration). Endpoints
// and sources: docs/providers/github-copilot.md.
import { localStorageBearer } from "../auth/localStorage-bearer.js";
import { field } from "../auth/token.js";
import type { Auth } from "../auth/types.js";
import { FoxcacheError } from "../errors.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Message, type Role } from "../schema.js";
import { reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("github-copilot");
const API = "https://api.individual.githubcopilot.com";
const ZIUCHEN = "https://github.com/ZiuChen/userscript/blob/b94faaae83704e8bb928c291af97a487d2b85007/src/userscript/github-copilot-enhanced/index.user.js#L26";
const ROLES: Record<string, Role> = { user: "user", assistant: "assistant" };
const KEY = "COPILOT_AUTH_TOKEN";

/** The page's cached token, sent only while its expiration is in the future, as the ZiuChen script checks (GC40). */
function cachedToken(): Auth {
  const inner = localStorageBearer({ key: KEY, field: "value", scheme: "GitHub-Bearer" });
  return {
    ...inner,
    open: (page) => {
      const sign = inner.open(page);
      return async (request, fresh) => {
        const raw = page.storage.getItem(KEY);
        const expiration = raw === null ? undefined : field(raw, "expiration");
        // A date string or epoch ms, as the script's new Date(expiration) takes. No time, or not a time, is past: NaN > now is false.
        const at = typeof expiration === "string" ? Date.parse(expiration) : typeof expiration === "number" ? expiration : Number.NaN;
        if (raw !== null && !(Number.isFinite(at) && at > Date.now())) throw new FoxcacheError("logged-out", "The GitHub Copilot token in this tab expired: open github.com/copilot to renew it.");
        return sign(request, fresh);
      };
    },
  };
}

export const githubCopilot: Adapter = {
  id: "github-copilot",
  label: "GitHub Copilot",
  origin: "https://github.com",
  apiOrigins: [API],
  auth: cachedToken(),
  reads: defineReads([
    { method: "GET", origin: API, path: "/github/chat/threads", source: ZIUCHEN },
    { method: "GET", origin: API, path: "/github/chat/threads/{id}/messages", source: ZIUCHEN },
  ]),
  // No source says how the list is sorted.
  newestFirst: false,

  async detect(http) {
    try {
      r.arr(r.obj(await http.get(`${API}/github/chat/threads`), "threads answer").threads, "threads");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      // A bad token answered 400 in a live call; this GET has no parameters to be wrong (GC40).
      if (error instanceof FoxcacheError && error.status === 400) return false;
      throw error;
    }
  },

  // One call answers every thread.
  async listConversations(http) {
    const items = r.arr(r.obj(await http.get(`${API}/github/chat/threads`), "threads answer").threads, "threads").map((x, i) => {
      const t = r.obj(x, `threads[${i}]`);
      return { id: r.str(t.id, `threads[${i}].id`), title: r.optStr(t.name, `threads[${i}].name`) ?? "", updatedAt: r.time(t.updatedAt, `threads[${i}].updatedAt`) };
    });
    return { items, next: undefined };
  },

  async getConversation(http, stub) {
    const answer = r.obj(await http.get(`${API}/github/chat/threads/${stub.id}/messages`), "messages answer");
    const t = r.obj(answer.thread, "thread");
    const rows = r.arr(answer.messages, "messages");
    if (rows.length > MAX_MESSAGES) throw new FoxcacheError("too-large", `github-copilot: the thread has more than ${MAX_MESSAGES} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
    const messages: Message[] = rows.map((x, i) => {
      const m = r.obj(x, `messages[${i}]`);
      const role = ROLES[r.str(m.role, `messages[${i}].role`)];
      if (!role) throw r.fail(`messages[${i}].role`, `is ${JSON.stringify(m.role)}`);
      return { role, text: r.optStr(m.content, `messages[${i}].content`) ?? "", createdAt: r.time(m.createdAt, `messages[${i}].createdAt`), attachments: [] };
    });
    return {
      provider: "github-copilot",
      id: r.str(t.id, "thread.id"),
      title: r.optStr(t.name, "thread.name") ?? "",
      createdAt: r.time(t.createdAt, "thread.createdAt"),
      updatedAt: r.time(t.updatedAt, "thread.updatedAt"),
      messages,
    };
  },
};
