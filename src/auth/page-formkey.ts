// A key the page's own script computes with a function it sets on window,
// such as Poe's poe-formkey. The function's name changes with each build,
// so the kind finds it in the page's inline scripts with a pattern whose
// first group is the name, calls it in the page, and keeps the first
// `length` characters. It sends the key in a header on every read, and on
// a POST also tag.header = md5(body + key + salt). A missing function or
// a key of the wrong shape means the site changed (H17).
import { FoxcacheError } from "../errors.js";
import { md5 } from "../md5.js";
import type { Auth, AuthPage } from "./types.js";

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Visible ASCII only: a key goes into a header. */
const KEY = /^[\x21-\x7e]+$/;

function formkey(page: AuthPage, fn: RegExp, length: number): string {
  const changed = (why: string) => new FoxcacheError("provider-schema", `The page of ${page.origin} ${why}. The site may have changed; foxcache needs an update.`);
  const name = page.scripts().map((s) => fn.exec(s)?.[1]).find((n) => n !== undefined);
  if (name === undefined || !NAME.test(name)) throw changed("names no formkey function");
  let value: unknown;
  try {
    value = page.call(name);
  } catch {
    // Not the page's message: it may quote the key.
    throw changed("failed to give its formkey");
  }
  const key = typeof value === "string" ? value.slice(0, length) : "";
  if (key.length !== length || !KEY.test(key)) throw changed("gave a formkey foxcache cannot use");
  return key;
}

export function pageFormkey(o: { fn: RegExp; length: number; header: string; tag: { header: string; salt: string } }): Auth {
  return {
    kind: "page-formkey",
    tokenPaths: [],
    renews: true,
    open(page) {
      let key: string | undefined;
      return async (request, fresh) => {
        if (key === undefined || fresh) key = formkey(page, o.fn, o.length);
        return { headers: { [o.header]: key, ...(request.body === undefined ? {} : { [o.tag.header]: md5(request.body + key + o.tag.salt) }) } };
      };
    },
  };
}
