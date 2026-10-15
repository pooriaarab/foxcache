// Readers for provider JSON. Each one throws provider-schema with the
// provider and the field path, so a changed site fails loudly (P1).
import { FoxcacheError } from "../errors.js";

export type Obj = Record<string, unknown>;

/** A size in bytes, or undefined for anything that is not one. */
const optSize = (x: unknown): number | undefined => (typeof x === "number" && Number.isSafeInteger(x) && x >= 0 ? x : undefined);

export function reader(provider: string) {
  const fail = (where: string, why: string) => new FoxcacheError("provider-schema", `${provider}: ${where} ${why}. The site may have changed; foxcache needs an update.`);
  const obj = (x: unknown, where: string): Obj => {
    if (typeof x !== "object" || x === null || Array.isArray(x)) throw fail(where, "is not an object");
    return x as Obj;
  };
  const arr = (x: unknown, where: string): unknown[] => {
    if (!Array.isArray(x)) throw fail(where, "is not a list");
    return x;
  };
  const str = (x: unknown, where: string): string => {
    if (typeof x !== "string") throw fail(where, "is not text");
    return x;
  };
  const bool = (x: unknown, where: string): boolean => {
    if (typeof x !== "boolean") throw fail(where, "is not true or false");
    return x;
  };
  const num = (x: unknown, where: string): number => {
    if (typeof x !== "number" || !Number.isFinite(x)) throw fail(where, "is not a number");
    return x;
  };
  /** Text, or undefined for null, undefined and "". */
  const optStr = (x: unknown, where: string): string | undefined => (x === null || x === undefined || x === "" ? undefined : str(x, where));
  /** An ISO-8601 string, as ISO-8601 UTC (P4). A time with no zone is UTC. */
  const time = (x: unknown, where: string): string => {
    const ms = typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) ? Date.parse(/(Z|[+-]\d{2}:?\d{2})$/.test(x) ? x : `${x}Z`) : Number.NaN;
    if (Number.isNaN(ms)) throw fail(where, "is not a time");
    return new Date(ms).toISOString();
  };
  /** Epoch seconds (a float), as ISO-8601 UTC (P4). */
  const seconds = (x: unknown, where: string): string => {
    if (typeof x !== "number" || !Number.isFinite(x) || x < 0) throw fail(where, "is not a time in seconds");
    return new Date(Math.round(x * 1000)).toISOString();
  };
  const optTime = (x: unknown, where: string): string | undefined => (x === null || x === undefined ? undefined : time(x, where));
  const optSeconds = (x: unknown, where: string): string | undefined => (x === null || x === undefined ? undefined : seconds(x, where));
  return { fail, obj, arr, str, bool, num, optStr, time, optTime, seconds, optSeconds, optSize };
}

/**
 * Walk parent links from a leaf to the root and return the ids root first.
 * A cycle or an unknown parent throws provider-schema (P2, P3).
 */
export function pathToRoot(leaf: string, parentOf: (id: string) => string | undefined | null, has: (id: string) => boolean, fail: (where: string, why: string) => Error): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined | null = leaf; at && has(at); at = parentOf(at)) {
    if (seen.has(at)) throw fail(`message ${at}`, "is in a parent cycle");
    seen.add(at);
    out.push(at);
  }
  return out.toReversed();
}
