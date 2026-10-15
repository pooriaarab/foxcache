// A key the page's own script computes with a function it sets on window,
// such as Poe's poe-formkey. The function's name changes with each build,
// so the kind finds it in the page's inline JavaScript with a pattern whose
// first group is the name, calls it in the page, and keeps the first
// `length` characters. It sends the key in a header on every read, and on
// a POST also tag.header = md5(body + key + salt). A missing function or
// a key of the wrong shape means the site changed (H17). A data block,
// such as __NEXT_DATA__, can quote the pattern in a bot's text, so the
// kind reads only JavaScript and needs exactly one match (H31).
import { FoxcacheError } from "../errors.js";
import { md5 } from "../md5.js";
import type { Auth, AuthPage } from "./types.js";

const NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** Visible ASCII only: a key goes into a header. */
const KEY = /^[\x21-\x7e]+$/;

/** The text of each inline script that is JavaScript: no src, and no type or text/javascript. Not a data block (H31). */
export const inlineScripts = (scripts: Iterable<{ src: string; type: string; text: string }>): string[] =>
  [...scripts].filter((s) => !s.src && ["", "text/javascript"].includes(s.type.trim().toLowerCase())).map((s) => s.text);

function formkey(page: AuthPage, fn: RegExp, length: number): string {
  const changed = (why: string) => new FoxcacheError("provider-schema", `The page of ${page.origin} ${why}. The site may have changed; foxcache needs an update.`);
  const every = new RegExp(fn.source, fn.flags.includes("g") ? fn.flags : `${fn.flags}g`);
  const names = page.scripts().flatMap((s) => [...s.matchAll(every)].map((m) => m[1]));
  if (names.length > 1) throw changed("names more than one formkey function");
  const name = names[0];
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
