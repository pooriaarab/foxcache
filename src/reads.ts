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
  /** A JSON object. Each key of match is a dotted path whose value must equal it: a GraphQL queryName, a persisted query hash, an IM cmd. `{}` takes any object. */
  | { type: "json"; match: Readonly<Record<string, string | number | boolean>> }
  /** Form fields, all text. Each key of match must have that value. */
  | { type: "form"; match: Readonly<Record<string, string>> }
  /** Google batchexecute: form fields with f.req. Every rpc id that f.req calls must be listed, and the rpcids query must name exactly those ids. */
  | { type: "batchexecute"; rpcids: readonly string[] };

export interface Read {
  method: "GET" | "POST";
  /** The exact path. `{name}` stands for one segment of letters, digits and `-_.~:@`, not `.` or `..`. */
  path: string;
  /** The query keys the read may carry. None when left out. */
  query?: readonly string[];
  /** POST only, and required there: what the body must be. */
  body?: BodyRule;
  /** Where the endpoint is documented: an https URL. */
  source: string;
}

/** What http needs to know about a site. An Adapter is one. */
export interface Site {
  /** The origin of the site's page, such as https://chatgpt.com. */
  origin: string;
  /** Every request the adapter may send. Made with defineReads. */
  reads: readonly Read[];
}

const LITERAL = /^[A-Za-z0-9\-_.~:@,]+$/;
const PLACEHOLDER = /^\{[a-z][A-Za-z0-9]*\}$/;
const VALUE = /^[A-Za-z0-9\-_.~:@]+$/;

function deepFreeze<T>(x: T): T {
  if (typeof x === "object" && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}
const frozen = (x: unknown): boolean => typeof x !== "object" || x === null || (Object.isFrozen(x) && Object.values(x).every(frozen));

/** A reads table, frozen all the way down. */
export const defineReads = (reads: Read[]): readonly Read[] => deepFreeze(reads);

/** Throws when a site's reads table is wrong (H11). createHttp calls it. */
export function checkSite(site: Site): void {
  const bad = (why: string) => new Error(`The reads of ${site.origin} are wrong: ${why}.`);
  if (!frozen(site.reads)) throw bad("the table is not frozen; make it with defineReads");
  const seen = new Set<string>();
  for (const read of site.reads) {
    const at = `${read.method} ${read.path}`;
    if (read.method !== "GET" && read.method !== "POST") throw bad(`${at} has a method foxcache does not send`);
    if ((read.method === "POST") !== (read.body !== undefined)) throw bad(`${at} needs a body rule for a POST, and none for a GET`);
    const rule = read.body;
    if (rule && rule.type !== "json" && rule.type !== "form" && rule.type !== "batchexecute") throw bad(`${at} has a body rule foxcache does not know`);
    if ((rule?.type === "json" || rule?.type === "form") && (typeof rule.match !== "object" || rule.match === null)) throw bad(`${at} has no match; write {} to take any body`);
    if (rule?.type === "batchexecute" && (!Array.isArray(rule.rpcids) || rule.rpcids.length === 0)) throw bad(`${at} lists no rpc id`);
    if (rule?.type === "batchexecute" && !read.query?.includes("rpcids")) throw bad(`${at} must allow the rpcids query`);
    const segments = read.path.split("/");
    if (segments[0] !== "" || segments.length < 2 || !segments.slice(1).every((s) => PLACEHOLDER.test(s) || (LITERAL.test(s) && s !== "." && s !== ".."))) throw bad(`${at} is not an exact path`);
    if (!/^https:\/\/\S+$/.test(read.source)) throw bad(`${at} has no https source`);
    if (read.method === "GET" && seen.has(at)) throw bad(`${at} is listed twice`);
    seen.add(at);
  }
}

const matches = (template: string, path: string): boolean => {
  const want = template.split("/");
  const have = path.split("/");
  return want.length === have.length && want.every((w, i) => (PLACEHOLDER.test(w) ? VALUE.test(have[i]!) && have[i] !== "." && have[i] !== ".." : w === have[i]));
};

/**
 * The first read whose method, path and query keys fit a request, or
 * undefined. It does not look at a body: http checks that when it sends.
 * The E2E uses it on the requests it intercepts.
 */
export function findRead(site: Site, method: string, path: string, keys: readonly string[]): Read | undefined {
  return site.reads.find((r) => r.method === method && matches(r.path, path) && keys.every((k) => r.query?.includes(k)));
}

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
  if (rule.type === "json") return Object.entries(rule.match).every(([k, v]) => at(body, k) === v) ? { type: "application/json", text: JSON.stringify(body) } : undefined;
  if (!Object.values(body).every((v) => typeof v === "string")) return undefined;
  const form = { type: "application/x-www-form-urlencoded;charset=UTF-8", text: new URLSearchParams(body as Record<string, string>).toString() };
  if (rule.type === "form") return Object.entries(rule.match).every(([k, v]) => body[k] === v) ? form : undefined;
  const ids = rpcCalls(body["f.req"]);
  return ids?.every((id) => rule.rpcids.includes(id)) && query.rpcids === [...new Set(ids)].join(",") ? form : undefined;
}

/** A request that is a read: its URL, and its body on the wire for a POST. */
export interface Prepared {
  url: URL;
  body?: { type: string; text: string };
}

/** The request when it is a read, or not-allowed before any request (H1, H8, H9, H10). */
export function prepare(site: Site, method: "GET" | "POST", path: string, query: Query = {}, body?: Body): Prepared {
  const origin = new URL(site.origin).origin;
  const refuse = () => new FoxcacheError("not-allowed", `${method} ${path} on ${origin} is not one of the reads foxcache lists for this site.`);
  if (!path.startsWith("/") || /[?#\\]/.test(path)) throw refuse();
  const u = new URL(path, origin);
  // URL parsing drops dot segments and would move the request: refuse instead.
  if (u.origin !== origin || u.pathname !== path) throw refuse();
  // The keys come from the query object: in a Firefox content script, searchParams.keys() is not iterable.
  const keys = Object.keys(query).filter((k) => query[k] !== undefined);
  for (const read of site.reads) {
    if (read.method !== method || !matches(read.path, path) || !keys.every((k) => read.query?.includes(k))) continue;
    const wire = read.body && encode(read.body, body ?? {}, query);
    if (read.body && !wire) continue;
    for (const k of keys) u.searchParams.set(k, String(query[k]));
    return wire ? { url: u, body: wire } : { url: u };
  }
  throw refuse();
}
