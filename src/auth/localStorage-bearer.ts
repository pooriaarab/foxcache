// A bearer token that the page keeps in localStorage, such as DeepSeek's
// "userToken" ({"value": ...}) or Kimi's "access_token" (plain text). With
// field, the value is JSON and the token is at that dotted path. It is
// read for each request, so a token the page renews is the one sent.
// scheme is the word before the token in Authorization, when the page
// sends another than Bearer, such as GitHub Copilot's "GitHub-Bearer".
import type { Auth } from "./types.js";
import { bearer, field } from "./token.js";

export function localStorageBearer(o: { key: string; field?: string; scheme?: string }): Auth {
  if (o.scheme !== undefined && !/^[A-Za-z][A-Za-z0-9-]*$/.test(o.scheme)) throw new Error(`The localStorage-bearer scheme ${JSON.stringify(o.scheme)} is not one word.`);
  return {
    kind: "localStorage-bearer",
    tokenPaths: [],
    renews: false,
    open: (page) => async () => {
      const raw = page.storage.getItem(o.key);
      return bearer(raw !== null && o.field ? field(raw, o.field) : raw, page.origin, o.scheme);
    },
  };
}
