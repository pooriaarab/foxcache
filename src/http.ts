// The only way an adapter reaches the network: a GET or POST on its own
// origin or one of its API origins, from the tab with the page's cookies
// (docs/cors.md), and only a request its reads list
// (src/reads.ts): the exact path, the query keys and, for a POST, the read
// operation in the body. So an adapter cannot send, edit or delete
// anything on the provider (H1, H8, H9).
//
// Some sites send a bearer token that their own script gets from the page.
// The site's auth kind (src/auth/) gets it the same way, inside this
// closure, and http adds it to reads only. It never returns it and never
// puts it in an error (H5).
import type { Auth, AuthParts } from "./auth/types.js";
import { FoxcacheError } from "./errors.js";
import { type Body, type Prepared, type Query, type Site, checkSite, prepare, readsPath } from "./reads.js";

export { type Body, type BodyRule, type Query, type Read, type Site, defineReads, findRead, originsOf } from "./reads.js";

export const MAX_RESPONSE_BYTES = 50 * 1024 * 1024;

export interface Http {
  /** GET a path of the origin that is one of the site's reads, and parse the JSON answer (or the read's decode). */
  get(path: string, query?: Query): Promise<unknown>;
  /** POST a body that one of the site's POST reads allows, and parse the JSON answer (or the read's decode). */
  post(path: string, body: Body, query?: Query): Promise<unknown>;
}
/** A site with the way it authenticates. */
export interface HttpSite extends Site {
  auth: Auth;
}
/** What http uses from the page it runs in. */
export interface Page {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The page's localStorage. */
  storage: { getItem(key: string): string | null };
  /** The page's document.cookie. */
  cookie(): string;
}


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

export function createHttp(site: HttpSite, page: Page): Http {
  checkSite(site);
  const origin = site.origin;
  for (const path of site.auth.tokenPaths) {
    if (readsPath(site, path)) throw new Error(`The reads of ${origin} are wrong: a read names ${path}, which holds the ${site.auth.kind} token.`);
  }

  async function send({ url, body, decode }: Prepared, parts: AuthParts = {}): Promise<unknown> {
    const u = new URL(url);
    for (const [k, v] of Object.entries(parts.query ?? {})) u.searchParams.set(k, v);
    let wire = body?.text;
    if (parts.form) {
      if (!body?.type.startsWith("application/x-www-form-urlencoded")) throw new Error(`The ${site.auth.kind} auth adds form fields, but ${u.pathname} has no form body.`);
      const form = new URLSearchParams(body.text);
      for (const [k, v] of Object.entries(parts.form)) form.set(k, v);
      wire = form.toString();
    }
    const headers: Record<string, string> = { accept: decode ? "*/*" : "application/json", ...parts.headers };
    if (body) headers["content-type"] = body.type;
    // Never the query: an auth kind may put a token there.
    const where = `${u.origin}${u.pathname}`;
    let res: Response;
    try {
      res = await page.fetch(u.href, { method: body ? "POST" : "GET", credentials: "include", redirect: "manual", headers, ...(wire !== undefined ? { body: wire } : {}) });
    } catch {
      // Firefox gives the same TypeError for a network error and a CORS refusal (H13).
      throw new FoxcacheError("provider-error", `Could not reach ${where}: the network failed, or the site does not let this page read it (CORS).`);
    }
    // redirect: "manual" gives an opaque redirect: a login page is where it goes.
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) throw new FoxcacheError("logged-out", `${where} redirected: sign in to ${origin}.`);
    if (res.status === 401 || res.status === 403) throw new FoxcacheError("logged-out", `${where} answered ${res.status}: sign in to ${origin}.`, { status: res.status });
    if (res.status === 429) throw new FoxcacheError("rate-limited", `${where} answered 429.`, { status: 429, retryAfter: retryAfter(res.headers.get("retry-after")) });
    if (res.status === 404) throw new FoxcacheError("not-found", `${where} answered 404.`, { status: 404 });
    if (res.status < 200 || res.status >= 300) throw new FoxcacheError("provider-error", `${where} answered ${res.status}.`, { status: res.status });
    const text = await readCapped(res, where);
    if (decode) {
      try {
        return decode(text);
      } catch (error) {
        // Not the decoder's message: it may quote the answer, and the answer may hold a key (H15).
        if (error instanceof FoxcacheError) throw error;
        throw new FoxcacheError("provider-schema", `${where} answered in a shape foxcache cannot read. The site may have changed; foxcache needs an update.`);
      }
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new FoxcacheError("provider-schema", `${where} did not answer JSON (a challenge or login page?). Reload the tab and try again.`);
    }
  }

  // The token stays in this closure. tokenPaths are read here with the cookies only, and no read names one (H7).
  const sign = site.auth.open({
    origin,
    storage: page.storage,
    cookie: () => page.cookie(),
    getJson: async (path) => {
      if (!site.auth.tokenPaths.includes(path)) throw new FoxcacheError("not-allowed", `${path} is not a token path of the ${site.auth.kind} auth.`);
      return send({ url: new URL(path, origin) });
    },
  });

  async function read(request: Prepared): Promise<unknown> {
    const signed = { method: request.body ? ("POST" as const) : ("GET" as const), url: request.url.href, ...(request.body ? { body: request.body.text } : {}) };
    try {
      return await send(request, await sign(signed, false));
    } catch (error) {
      // A token can expire during a long capture: get a new one once.
      if (!site.auth.renews || !(error instanceof FoxcacheError) || error.code !== "logged-out" || error.status !== 401) throw error;
      return send(request, await sign(signed, true));
    }
  }

  return {
    get: async (path, query) => read(prepare(site, "GET", path, query)),
    post: async (path, body, query) => read(prepare(site, "POST", path, query, body)),
  };
}
