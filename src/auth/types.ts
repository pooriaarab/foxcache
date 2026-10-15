// How a site authenticates its own API calls. One file per kind in
// src/auth/, so a new kind is a new file. http opens the kind once per
// Http, in the tab; the token lives in the closure that open returns and
// goes only onto requests that are reads. It is never returned, never in
// an error, never in the event page, the store or an export (H5).

/** What an auth kind may use from the page it runs in. */
export interface AuthPage {
  /** The site's origin. */
  origin: string;
  /** The page's localStorage. */
  storage: { getItem(key: string): string | null };
  /** The page's document.cookie (cookies that are not HttpOnly). */
  cookie(): string;
  /** The text of each inline script of the page that is JavaScript: no src, and no type or text/javascript (H31). */
  scripts(): string[];
  /** Call a function the page's own script set on window, with no arguments, in the page, and give what it returns. undefined when there is none. */
  call(name: string): unknown;
  /** GET one of the kind's tokenPaths on the site's origin with the page cookies, and parse the JSON. */
  getJson(path: string): Promise<unknown>;
  /** GET one of the kind's tokenPaths, such as a page whose HTML holds tokens, and give the text. */
  getText(path: string): Promise<string>;
}

/** One request that is a read, before the auth adds its parts. */
export interface AuthRequest {
  method: "GET" | "POST";
  url: string;
  /** The encoded body of a POST. */
  body?: string;
}

/** What an auth kind adds to one request. */
export interface AuthParts {
  headers?: Record<string, string>;
  /** Query values, such as a page token. They are never in an error message. */
  query?: Record<string, string>;
  /** Form fields, for a form or batchexecute body only. */
  form?: Record<string, string>;
}

/** Sign one request. fresh is true on the one retry after a 401. */
export type Sign = (request: AuthRequest, fresh: boolean) => Promise<AuthParts>;

export interface Auth {
  /** The kind, as in the file name: cookie, page-session, localStorage-bearer, cookie-bearer, page-formkey, with-headers, google-page-tokens. */
  readonly kind: string;
  /** Paths on the site's origin that the kind reads itself because they hold the token. No read may name one (H7). */
  readonly tokenPaths: readonly string[];
  /** True when a 401 should get a fresh token and one retry. */
  readonly renews: boolean;
  /** Start the kind for one Http. */
  open(page: AuthPage): Sign;
}
