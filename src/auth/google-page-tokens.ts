// Google page tokens for batchexecute (Gemini, NotebookLM). The page's own
// HTML holds WIZ_global_data with SNlM0e (the XSRF token, sent as form field
// "at"), cfb2h (the build label, query "bl") and FdrFJe (the session id,
// query "f.sid"). The kind GETs that page with the cookies, as the exporters
// do, keeps the three values, and sends them with X-Same-Domain: 1. A guest
// page has no SNlM0e: signed out. After a 401 it reads the page again.
// Sources: Gemini-API get_access_token.py, notebooklm-py extraction.py.
import { FoxcacheError } from "../errors.js";
import type { Auth } from "./types.js";

interface Tokens {
  at: string;
  bl: string;
  sid: string;
}

/** The value of one WIZ_global_data key in the page, or undefined. */
const wiz = (html: string, key: string): string | undefined => new RegExp(`"${key}":\\s*"([^"\\\\]*)"`).exec(html)?.[1];

function tokensOf(html: string, origin: string): Tokens {
  const at = wiz(html, "SNlM0e");
  if (!at) throw new FoxcacheError("logged-out", `No session on ${origin}: sign in.`);
  const bl = wiz(html, "cfb2h");
  const sid = wiz(html, "FdrFJe");
  // Never the values: the message names the missing key only (H5).
  for (const [key, value] of [["cfb2h", bl], ["FdrFJe", sid]] as const) {
    if (!value) throw new FoxcacheError("provider-schema", `The ${origin} page has no ${key}. The site may have changed; foxcache needs an update.`);
  }
  return { at, bl: bl!, sid: sid! };
}

export function googlePageTokens(o: { path: string }): Auth {
  return {
    kind: "google-page-tokens",
    tokenPaths: [o.path],
    renews: true,
    open(page) {
      let tokens: Tokens | undefined;
      return async (_, fresh) => {
        if (!tokens || fresh) tokens = tokensOf(await page.getText(o.path), page.origin);
        return { headers: { "x-same-domain": "1" }, query: { bl: tokens.bl, "f.sid": tokens.sid }, form: { at: tokens.at } };
      };
    },
  };
}
