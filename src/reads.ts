// The reads of a site: every request an adapter may send, one entry per
// endpoint, each with the place it is documented. http sends nothing that
// is not a read, so an adapter cannot reach a path that writes, even a GET
// one (H8), a value in a path cannot point it somewhere else (H10), and a
// POST carries only the read operations its entry names (H9).
import { FoxcacheError } from "./errors.js";

export type Query = Record<string, string | number | boolean | undefined>;
/** A POST body as the adapter gives it. http encodes it as the read's body rule says. */
export type Body = Readonly<Record<string, unknown>>;

/** What the body of a POST read must be. */
export type BodyRule =
  /**
   * A JSON object. Each key of match is a dotted path whose value must equal it: a GraphQL queryName, a persisted query hash, an IM cmd. `{}` takes any object.
   * keys, when given, are the only top-level keys the body may have, so a body that names a read cannot also carry a query text (H30).
   */
  | { type: "json"; match: Readonly<Record<string, string | number | boolean>>; keys?: readonly string[] }
  /** Form fields, all text. Each key of match must have that value. */
  | { type: "form"; match: Readonly<Record<string, string>> }
  /** Google batchexecute: form fields with f.req. Every rpc id that f.req calls must be listed, and the rpcids query must name exactly those ids. */
  | { type: "batchexecute"; rpcids: readonly string[] };

export interface Read {
  method: "GET" | "POST";
  /** One of the site's apiOrigins, for a read on an API host. Left out: the site's own origin. */
  origin?: string;
  /** The exact path. `{name}` stands for one segment of letters, digits and `-_.~:@`, not `.` or `..`. It may end in one `/`, as open-webui's lists do (`/api/v1/chats/`); then only that spelling matches. */
  path: string;
  /** The query keys the read may carry. None when left out. */
  query?: readonly string[];
  /** POST only, and required there: what the body must be. */
  body?: BodyRule;
  /**
   * Reads an answer that is not JSON: Google's )]}' prefix, stream frames,
   * HTML. It gets the whole text, after the size cap. A FoxcacheError it
   * throws passes on; any other throw becomes provider-schema (H15).
   * Left out: JSON.parse.
   */
  decode?: (text: string) => unknown;
  /**
   * Fixed headers the site's own page sends with this read, such as
   * Doubao's `agw-js-conv: str` (H16). A content-type here replaces the
   * body rule's. Never a token or a cookie: the auth kind adds those.
   */
  headers?: Readonly<Record<string, string>>;
  /** Where the endpoint is documented: an https URL. */
  source: string;
}

/** What http needs to know about a site. An Adapter is one. */
export interface Site {
  /** The origin of the site's page, such as https://chatgpt.com. */
  origin: string;
  /** Other origins the site's page calls for its API, such as https://api.individual.githubcopilot.com. Bare https origins. */
  apiOrigins?: readonly string[];
  /** Every request the adapter may send. Made with defineReads. */
  reads: readonly Read[];
}

/** Every origin a site reads from: its own first, then its API origins. Each needs a host grant (X12). */
export const originsOf = (site: Site): string[] => [site.origin, ...(site.apiOrigins ?? [])];

const LITERAL = /^[A-Za-z0-9\-_.~:@,]+$/;
const PLACEHOLDER = /^\{[a-z][A-Za-z0-9]*\}$/;
const VALUE = /^[A-Za-z0-9\-_.~:@]+$/;
const HEADER = /^[a-z0-9-]+$/;
/** Headers a read may not fix: the auth kind's, the browser's, or ones that would move the request. */
const NOT_FIXED = new Set(["authorization", "cookie", "host", "origin", "referer", "content-length"]);

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}
const frozen = (x: unknown): boolean => typeof x !== "object" || x === null || (Object.isFrozen(x) && Object.values(x).every(frozen));

/** True when keys are distinct names and each match path starts at one of them. */
const closedKeys = (keys: unknown, match: Readonly<Record<string, unknown>>): boolean =>
  Array.isArray(keys) && keys.every((k) => typeof k === "string" && k !== "") && new Set(keys).size === keys.length && Object.keys(match).every((p) => keys.includes(p.split(".")[0]));

/** A reads table, frozen all the way down. */
export const defineReads = (reads: Read[]): readonly Read[] => deepFreeze(reads);

/** Throws when a site's reads table is wrong (H11). createHttp calls it. */
export function checkSite(site: Site): void {
  const bad = (why: string) => new Error(`The reads of ${site.origin} are wrong: ${why}.`);
  if (!frozen(site.reads)) throw bad("the table is not frozen; make it with defineReads");
  if (!/^https:\/\/[a-z0-9.-]+$/.test(site.origin)) throw bad("the origin is not a bare https origin");
  const apis = site.apiOrigins ?? [];
  for (const api of apis) if (!/^https:\/\/[a-z0-9.-]+$/.test(api) || api === site.origin || apis.indexOf(api) !== apis.lastIndexOf(api)) throw bad(`the API origin ${api} is not a bare https origin of its own`);
  const seen = new Set<string>();
  for (const read of site.reads) {
    const at = `${read.method} ${read.origin ?? ""}${read.path}`;
    if (read.origin !== undefined && !apis.includes(read.origin)) throw bad(`${at} names an origin that is not one of the apiOrigins`);
    if (read.method !== "GET" && read.method !== "POST") throw bad(`${at} has a method foxcache does not send`);
    if ((read.method === "POST") !== (read.body !== undefined)) throw bad(`${at} needs a body rule for a POST, and none for a GET`);
    const rule = read.body;
    if (rule && rule.type !== "json" && rule.type !== "form" && rule.type !== "batchexecute") throw bad(`${at} has a body rule foxcache does not know`);
    if ((rule?.type === "json" || rule?.type === "form") && (typeof rule.match !== "object" || rule.match === null)) throw bad(`${at} has no match; write {} to take any body`);
    if (rule?.type === "json" && rule.keys !== undefined && !closedKeys(rule.keys, rule.match)) throw bad(`${at} has keys that are not distinct names holding each match path`);
    if (rule?.type === "batchexecute" && (!Array.isArray(rule.rpcids) || rule.rpcids.length === 0)) throw bad(`${at} lists no rpc id`);
    if (rule?.type === "batchexecute" && !read.query?.includes("rpcids")) throw bad(`${at} must allow the rpcids query`);
    const segments = read.path.split("/");
    // One trailing "/" is part of the exact path; no other segment may be empty.
    const named = segments.length > 2 && segments.at(-1) === "" ? segments.slice(1, -1) : segments.slice(1);
    if (segments[0] !== "" || segments.length < 2 || !named.every((s) => PLACEHOLDER.test(s) || (LITERAL.test(s) && s !== "." && s !== ".."))) throw bad(`${at} is not an exact path`);
    if (!/^https:\/\/\S+$/.test(read.source)) throw bad(`${at} has no https source`);
    if (read.decode !== undefined && typeof read.decode !== "function") throw bad(`${at} has a decode that is not a function`);
    for (const [name, value] of Object.entries(read.headers ?? {})) if (!HEADER.test(name) || NOT_FIXED.has(name) || typeof value !== "string" || !/^[\x20-\x7e]*$/.test(value)) throw bad(`${at} has a fixed header foxcache does not send: ${JSON.stringify(name)}`);
    if (read.method === "GET" && seen.has(at)) throw bad(`${at} is listed twice`);
    seen.add(at);
  }
}

const matches = (template: string, path: string): boolean => {
  const want = template.split("/");
  const have = path.split("/");
  return want.length === have.length && want.every((w, i) => (PLACEHOLDER.test(w) ? VALUE.test(have[i]!) && have[i] !== "." && have[i] !== ".." : w === have[i]));
};

const fits = (site: Site, read: Read, method: string, origin: string, path: string, keys: readonly string[]): boolean =>
  read.method === method && (read.origin ?? site.origin) === origin && matches(read.path, path) && keys.every((k) => read.query?.includes(k));

/**
 * The first read whose method, origin, path and query keys fit a request
 * URL, or undefined. It does not look at a body: http checks that when it
 * sends. The E2E uses it on the requests it intercepts.
 */
export function findRead(site: Site, method: string, url: string): Read | undefined {
  const u = new URL(url);
  // forEach, not an iterator: in a Firefox content script, searchParams is not iterable.
  const keys: string[] = [];
  u.searchParams.forEach((_, k) => keys.push(k));
  return site.reads.find((r) => fits(site, r, method, u.origin, u.pathname, keys));
}

/** True when a read of any method on the site's own origin names this path. */
export const readsPath = (site: Site, path: string): boolean => site.reads.some((r) => r.origin === undefined && matches(r.path, path));

const at = (x: unknown, dotted: string): unknown => dotted.split(".").reduce<unknown>((o, k) => (typeof o === "object" && o !== null && Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined), x);

/** The rpc ids that a batchexecute f.req calls, or undefined when it is not one. */
function rpcCalls(fReq: unknown): string[] | undefined {
  if (typeof fReq !== "string") return undefined;
  let calls: unknown;
  try {
    calls = (JSON.parse(fReq) as unknown[])[0];
  } catch {
    return undefined;
  }
  if (!Array.isArray(calls) || calls.length === 0) return undefined;
  const ids = calls.map((c) => (Array.isArray(c) && typeof c[0] === "string" ? c[0] : undefined));
  return ids.every((id) => id !== undefined) ? (ids as string[]) : undefined;
}

/** The body on the wire when it fits the rule, or undefined. */
function encode(rule: BodyRule, body: Body, query: Query): { type: string; text: string } | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined;
  if (rule.type === "json") {
    if (rule.keys && !Object.keys(body).every((k) => rule.keys!.includes(k))) return undefined;
    return Object.entries(rule.match).every(([k, v]) => at(body, k) === v) ? { type: "application/json", text: JSON.stringify(body) } : undefined;
  }
  if (!Object.values(body).every((v) => typeof v === "string")) return undefined;
  const form = { type: "application/x-www-form-urlencoded;charset=UTF-8", text: new URLSearchParams(body as Record<string, string>).toString() };
  if (rule.type === "form") return Object.entries(rule.match).every(([k, v]) => body[k] === v) ? form : undefined;
  const ids = rpcCalls(body["f.req"]);
  return ids?.every((id) => rule.rpcids.includes(id)) && query.rpcids === [...new Set(ids)].join(",") ? form : undefined;
}

/** A request that is a read: its URL, its body on the wire for a POST, the read's fixed headers and its decoder. */
export interface Prepared {
  url: URL;
  body?: { type: string; text: string };
  headers?: Readonly<Record<string, string>>;
  decode?: (text: string) => unknown;
}

/**
 * The request when it is a read, or not-allowed before any request (H1,
 * H8, H9, H10, H12). target is a path of the site's origin, or an API
 * origin followed by a path.
 */
export function prepare(site: Site, method: "GET" | "POST", target: string, query: Query = {}, body?: Body): Prepared {
  const refuse = () => new FoxcacheError("not-allowed", `${method} ${target} is not one of the reads foxcache lists for ${site.origin}.`);
  const origin = (site.apiOrigins ?? []).find((o) => target.startsWith(`${o}/`)) ?? site.origin;
  const path = origin === site.origin ? target : target.slice(origin.length);
  if (!path.startsWith("/") || /[?#\\]/.test(path)) throw refuse();
  const u = new URL(path, origin);
  // URL parsing drops dot segments and would move the request: refuse instead.
  if (u.origin !== origin || u.pathname !== path) throw refuse();
  // The keys come from the query object: in a Firefox content script, searchParams.keys() is not iterable.
  const keys = Object.keys(query).filter((k) => query[k] !== undefined);
  for (const read of site.reads) {
    if (!fits(site, read, method, origin, path, keys)) continue;
    const wire = read.body && encode(read.body, body ?? {}, query);
    if (read.body && !wire) continue;
    for (const k of keys) u.searchParams.set(k, String(query[k]));
    return { url: u, ...(wire ? { body: wire } : {}), ...(read.headers ? { headers: read.headers } : {}), ...(read.decode ? { decode: read.decode } : {}) };
  }
  throw refuse();
}
