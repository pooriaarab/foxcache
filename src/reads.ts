// The reads of a site: every request an adapter may send, one entry per
// endpoint, each with the place it is documented. http sends nothing that
// is not a read, so an adapter cannot reach a path that writes, even a GET
// one (H8), and a value in a path cannot point it somewhere else (H10).
import { FoxcacheError } from "./errors.js";

export type Query = Record<string, string | number | boolean | undefined>;

export interface Read {
  method: "GET";
  /** The exact path. `{name}` stands for one segment of letters, digits and `-_.~:@`, not `.` or `..`. */
  path: string;
  /** The query keys the read may carry. None when left out. */
  query?: readonly string[];
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
    if (read.method !== "GET") throw bad(`${at} has a method foxcache does not send`);
    const segments = read.path.split("/");
    if (segments[0] !== "" || segments.length < 2 || !segments.slice(1).every((s) => PLACEHOLDER.test(s) || (LITERAL.test(s) && s !== "." && s !== ".."))) throw bad(`${at} is not an exact path`);
    if (!/^https:\/\/\S+$/.test(read.source)) throw bad(`${at} has no https source`);
    if (seen.has(at)) throw bad(`${at} is listed twice`);
    seen.add(at);
  }
}

const matches = (template: string, path: string): boolean => {
  const want = template.split("/");
  const have = path.split("/");
  return want.length === have.length && want.every((w, i) => (PLACEHOLDER.test(w) ? VALUE.test(have[i]!) && have[i] !== "." && have[i] !== ".." : w === have[i]));
};

/** The read that allows this request, or undefined. keys are the query keys it carries. */
export function findRead(site: Site, method: string, path: string, keys: readonly string[]): Read | undefined {
  return site.reads.find((r) => r.method === method && matches(r.path, path) && keys.every((k) => r.query?.includes(k)));
}

/** The URL of a request that is a read, or not-allowed before any request (H1, H8, H10). */
export function readUrl(site: Site, method: string, path: string, query: Query = {}): URL {
  const origin = new URL(site.origin).origin;
  const refuse = () => new FoxcacheError("not-allowed", `${method} ${path} on ${origin} is not one of the reads foxcache lists for this site.`);
  if (!path.startsWith("/") || /[?#\\]/.test(path)) throw refuse();
  const u = new URL(path, origin);
  // URL parsing drops dot segments and would move the request: refuse instead.
  if (u.origin !== origin || u.pathname !== path) throw refuse();
  // The keys come from the query object: in a Firefox content script, searchParams.keys() is not iterable.
  const keys = Object.keys(query).filter((k) => query[k] !== undefined);
  if (!findRead(site, method, path, keys)) throw refuse();
  for (const k of keys) u.searchParams.set(k, String(query[k]));
  return u;
}
