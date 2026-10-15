// The only way an adapter reaches the network: GET on a path of its own
// origin, with the page's cookies. No other method exists here, so an
// adapter cannot send, edit or delete anything on the provider (H1).
//
// Some sites send a bearer token that their own script gets from the page.
// http gets it the same way, keeps it in this closure, and adds it to its
// own requests. It never returns it and never puts it in an error (H5).
import { FoxcacheError } from "./errors.js";

export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

/**
 * How a site authenticates its own API calls:
 *   chatgpt-session  the bearer token from GET /api/auth/session (chatgpt.com does this)
 *   deepseek-local   the bearer token in localStorage "userToken" (chat.deepseek.com does this)
 * No auth: the session cookies alone.
 */
export type AuthKind = "chatgpt-session" | "deepseek-local";

export type Query = Record<string, string | number | boolean | undefined>;
export interface Http {
  /** GET a path of the origin and parse the JSON answer. */
  get(path: string, query?: Query): Promise<unknown>;
}
export interface HttpOptions {
  origin: string;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  auth?: AuthKind;
  /** The page's localStorage, for deepseek-local. */
  storage?: { getItem(key: string): string | null };
}

const SESSION_PATH = "/api/auth/session";

/** Seconds from a Retry-After header: a number or an HTTP date. */
function retryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/** The body as text, read as a stream: reading stops once the bytes pass the limit (H4). */
async function readCapped(res: Response, where: string): Promise<string> {
  const tooLarge = () => new FoxcacheError("too-large", `${where} sent more than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB.`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_RESPONSE_BYTES) throw tooLarge();
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

export function createHttp(options: HttpOptions): Http {
  const origin = new URL(options.origin).origin;
  let token: string | undefined;

  function url(path: string, query: Query = {}): URL {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) throw new FoxcacheError("not-allowed", `${path} is not a path on ${origin}.`);
    const u = new URL(path, origin);
    if (u.origin !== origin) throw new FoxcacheError("not-allowed", `${path} is not a path on ${origin}.`);
    for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, String(v));
    return u;
  }

  async function send(u: URL, auth?: string): Promise<unknown> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (auth) headers.authorization = `Bearer ${auth}`;
    const res = await options.fetch(u.href, { method: "GET", credentials: "include", redirect: "manual", headers });
    const where = `${origin}${u.pathname}`;
    // redirect: "manual" gives an opaque redirect: a login page is where it goes.
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new FoxcacheError("logged-out", `${where} redirected: sign in to ${origin}.`);
    if (res.status === 401 || res.status === 403) throw new FoxcacheError("logged-out", `${where} answered ${res.status}: sign in to ${origin}.`, { status: res.status });
    if (res.status === 429) throw new FoxcacheError("rate-limited", `${where} answered 429.`, { status: 429, retryAfter: retryAfter(res.headers.get("retry-after")) });
    if (res.status === 404) throw new FoxcacheError("not-found", `${where} answered 404.`, { status: 404 });
    if (res.status < 200 || res.status >= 300) throw new FoxcacheError("provider-error", `${where} answered ${res.status}.`, { status: res.status });
    const text = await readCapped(res, where);
    try {
      return JSON.parse(text);
    } catch {
      throw new FoxcacheError("provider-schema", `${where} did not answer JSON (a challenge or login page?). Reload the tab and try again.`);
    }
  }

  async function bearer(fresh: boolean): Promise<string | undefined> {
    if (options.auth === "deepseek-local") {
      const raw = options.storage?.getItem("userToken");
      let value: unknown;
      try {
        value = raw ? (JSON.parse(raw) as { value?: unknown }).value : undefined;
      } catch {
        value = undefined;
      }
      if (typeof value !== "string" || !value) throw new FoxcacheError("logged-out", `No session on ${origin}: sign in.`);
      return value;
    }
    if (options.auth === "chatgpt-session") {
      if (token && !fresh) return token;
      const session = (await send(url(SESSION_PATH))) as { accessToken?: unknown } | null;
      if (typeof session?.accessToken !== "string" || !session.accessToken) throw new FoxcacheError("logged-out", `No session on ${origin}: sign in.`);
      token = session.accessToken;
      return token;
    }
    return undefined;
  }

  return {
    async get(path, query) {
      const u = url(path, query);
      if (options.auth === "chatgpt-session" && u.pathname === SESSION_PATH) throw new FoxcacheError("not-allowed", `${SESSION_PATH} holds the session token; foxcache does not read it out.`);
      try {
        return await send(u, await bearer(false));
      } catch (error) {
        // A token can expire during a long capture: get a new one once.
        if (options.auth !== "chatgpt-session" || !(error instanceof FoxcacheError) || error.code !== "logged-out" || error.status !== 401) throw error;
        return send(u, await bearer(true));
      }
    },
  };
}
