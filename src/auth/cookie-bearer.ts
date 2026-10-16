// A bearer token that the page keeps in a cookie its script can read
// (not HttpOnly), such as Manus "session_id". The value is URI-decoded;
// with field, it is JSON and the token is at that dotted path. It is read
// for each request.
import type { Auth } from "./types.js";
import { bearer, field } from "./token.js";

function cookieValue(jar: string, name: string): string | undefined {
  for (const part of jar.split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      try {
        return decodeURIComponent(part.slice(at + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function cookieBearer(o: { name: string; field?: string }): Auth {
  return {
    kind: "cookie-bearer",
    tokenPaths: [],
    renews: false,
    open: (page) => async () => {
      const raw = cookieValue(page.cookie(), o.name);
      return bearer(raw !== undefined && o.field ? field(raw, o.field) : raw, page.origin);
    },
  };
}
