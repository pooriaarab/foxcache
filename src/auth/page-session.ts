// A bearer token that the page's own script gets from a session endpoint
// with the cookies, such as ChatGPT's GET /api/auth/session accessToken
// (field is a dotted path in the answer).
// The kind gets it the same way, keeps it, and gets a new one after a 401.
import type { Auth } from "./types.js";
import { at, bearer } from "./token.js";

export function pageSession(o: { path: string; field: string }): Auth {
  return {
    kind: "page-session",
    tokenPaths: [o.path],
    renews: true,
    open(page) {
      let token: unknown;
      return async (_, fresh) => {
        if (!token || fresh) token = at(await page.getJson(o.path), o.field);
        return bearer(token, page.origin);
      };
    },
  };
}
