// A bearer token that the page keeps in localStorage, such as DeepSeek's
// "userToken" ({"value": ...}) or Kimi's "access_token" (plain text). With
// field, the value is JSON and the token is at that dotted path. It is
// read for each request, so a token the page renews is the one sent.
import type { Auth } from "./types.js";
import { bearer, field } from "./token.js";

export function localStorageBearer(o: { key: string; field?: string }): Auth {
  return {
    kind: "localStorage-bearer",
    tokenPaths: [],
    renews: false,
    open: (page) => async () => {
      const raw = page.storage.getItem(o.key);
      return bearer(raw !== null && o.field ? field(raw, o.field) : raw, page.origin);
    },
  };
}
