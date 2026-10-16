// The bearer header for a token value that a page keeps, shared by the
// kinds that read one. A missing or empty value means signed out (H14),
// and no message names the value.
import { FoxcacheError } from "../errors.js";
import type { AuthParts } from "./types.js";

/** The value at a dotted path, or undefined. */
export const at = (x: unknown, path: string): unknown => path.split(".").reduce<unknown>((o, k) => (typeof o === "object" && o !== null ? (o as Record<string, unknown>)[k] : undefined), x);

/** The value at a dotted path of a JSON text, or undefined when it is not JSON. */
export function field(json: string, path: string): unknown {
  try {
    return at(JSON.parse(json), path);
  } catch {
    return undefined;
  }
}

/** Authorization: <scheme> <token>, or logged-out when the token is not a non-empty string. */
export function bearer(token: unknown, origin: string, scheme = "Bearer"): AuthParts {
  if (typeof token !== "string" || !token) throw new FoxcacheError("logged-out", `No session on ${origin}: sign in.`);
  return { headers: { authorization: `${scheme} ${token}` } };
}
