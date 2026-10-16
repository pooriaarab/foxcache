# Adding a provider

One provider, one PR, under 500 counted lines and 40 files. The http layer
(`src/http.ts`, `src/reads.ts`, `src/auth/`) already has what most sites
need, so the PR only adds files and appends one line to a few lists.

## Before you write code

1. Research the site and write `docs/providers/<id>.md` first. Copy the
   shape of [deepseek.md](deepseek.md): the auth, then one table row per
   endpoint (what, method and exact path, the shape foxcache reads, the
   source with a commit-pinned URL, the confidence), then **Never call**
   (every write on an endpoint or path the reads share: a batchexecute rpc
   id that deletes, a GET that deletes, a `DELETE` on a read path), then
   **Not captured**, then **Failure modes** (rows `<ID>1`, `<ID>2` ... for
   the ways this site can fail, each with its test). A failure mode that
   every provider shares goes into [../failure-modes.md](../failure-modes.md).
2. Write the unit tests and the fixture (below) before the adapter. They
   fail first.

## The files

New files:

| File | What |
|---|---|
| `src/adapters/<id>.ts` | The adapter: the template below. |
| `docs/providers/<id>.md` | The research, as above. |
| `tests/fixtures/<id>.json` | Synthetic answers in the documented shapes. No real chat, no real token. |
| `tests/<id>.test.ts` | Unit tests through the adapter's own reads (`fixtureHttp`). |
| `e2e/providers/<id>.mjs` | One E2E check. Copy [e2e/providers/mistral.mjs](../../e2e/providers/mistral.mjs). |

One line each, in lists that hold one entry per line. Add yours at the end
so a rebase conflict is one line:

| File | Line |
|---|---|
| `src/schema.ts` | the id in `PROVIDERS`, if it is not there |
| `src/adapters/index.ts` | the import, and the adapter in `ADAPTERS` |
| `extension/manifest.json` | `"https://<host>/*"` in `optional_host_permissions`, and one per API origin |
| `docs/providers/README.md` | the table row, and the label in the GET-only or the POST list |
| `README.md` | a Coverage row `<Label> adapter`, and the label in the Compare table's Sites (`tests/docs.test.ts`, P60) |
| `extension/amo-metadata.json` | in the description: the site in the list of sites, each host you added to the manifest under **Permissions**, and the site in the POST sentence if it reads by POST. `pnpm check:amo` fails on a manifest host the listing does not name (R60). Keep [../amo-data.md](../amo-data.md) in step. |

`tests/reads.test.ts` and `tests/registry.test.ts` then check your reads
table and your manifest lines with no edit.

## Choose the parts

**Reads** (`src/reads.ts`). List every request the adapter sends, with a
`source`. http refuses anything else before it is sent.

- GET: the exact `path`, with `{name}` for one id segment (letters, digits
  and `-_.~:@`), and every `query` key it sends.
- POST: a `body` rule. `json` with `match` (dotted paths and the values they
  must have: the GraphQL `queryName`, a persisted query hash, an IM `cmd`),
  `form` with `match`, or `batchexecute` with `rpcids` (list `rpcids` in
  `query` too). `match: {}` takes any body: use it only for an endpoint that
  only reads.
- An API host: add it to `apiOrigins` and give the read its `origin`. Call
  `http.get("https://api.host/path")`. Read [../cors.md](../cors.md) first.
  The API must answer CORS for the site's page. Confirm it with a live smoke
  run before the PR.
- Google batchexecute: one `batchRead({ path, rpcid, source })` per rpc id,
  called with `callBatch` (`src/batchexecute.ts`), and the
  `google-page-tokens` auth.
- An answer that is not JSON: give the read a `decode(text)`. Throw
  `r.fail(...)` from it for a changed shape.
- A header the site's page sends on a read (Doubao's `agw-js-conv: str`,
  a content-type with `encoding=utf-8`): give the read `headers`. They
  are fixed text, sent on that read only; a token is the auth kind's.
- Volatile ids (Google rpc ids, Poe query hashes, Meta doc ids): one constant
  each at the top of the adapter. A changed id must fail with
  `provider-schema` through `reader`, never fall back.

**Auth** (`src/auth/`). Pick the kind the site's own page uses:

| Kind | For | Call |
|---|---|---|
| `cookie` | the session cookies alone | `cookie` |
| `page-session` | a token the page reads from a session endpoint | `pageSession({ path, field })` |
| `localStorage-bearer` | a token in localStorage | `localStorageBearer({ key, field?, scheme? })` |
| `page-formkey` | a key a page function computes (its name changes per build), plus an md5 tag of each POST body | `pageFormkey({ fn, length, header, tag })` |
| `with-headers` | fixed headers the page adds, on top of a token kind | `withHeaders(kind, { name: value })` |
| `google-page-tokens` | Google batchexecute: `at`, `bl` and `f.sid` in the HTML of a page | `googlePageTokens({ path })` |

`field` is a dotted path into a JSON value. `scheme` is the word the page
puts before the token in `Authorization` when it is not `Bearer`. A site that needs another kind
(page tokens, a header the page sends, a signature) gets a new file
`src/auth/<kind>.ts` that exports an `Auth`, with its own
`tests/auth-<kind>.test.ts`. Its `sign` can return headers, query values
and form fields. It names the paths that hold its token in `tokenPaths`.
The token stays in the closure `open` returns: never in a record, an
error message, the event page, the store or an export (H5).

**Secrets in answers.** The adapter copies only the fields it maps into
foxcache/v1, and `check` drops every other key (S2). Never put a raw
provider object into a text field. When the site sends a token or a user's
API key in an answer the adapter reads, put a placeholder for it in the
fixture and test that no record holds it.

## Template: `src/adapters/<id>.ts`

The template is not a file in `src/` because the repo keeps no dead code.
Replace `example`, the origin and the reads with the site's.

```ts
// chat.example.com. The page keeps a bearer token in localStorage "token"
// (auth localStorage-bearer). Endpoints and sources:
// docs/providers/example.md.
import { localStorageBearer } from "../auth/localStorage-bearer.js";
import { FoxcacheError } from "../errors.js";
import { defineReads } from "../reads.js";
import type { Message } from "../schema.js";
import { reader } from "./read.js";
import type { Adapter } from "./types.js";

const r = reader("example");
const SRC = "https://github.com/someone/exporter/blob/0123456789abcdef0123456789abcdef01234567/src/api.ts";
const PAGE = 50;

export const example: Adapter = {
  id: "example",
  label: "Example",
  origin: "https://chat.example.com",
  auth: localStorageBearer({ key: "token" }),
  reads: defineReads([
    { method: "GET", path: "/api/v1/user", source: `${SRC}#L10-L20` },
    { method: "GET", path: "/api/v1/chats", query: ["offset", "limit"], source: `${SRC}#L30-L60` },
    // One endpoint, many operations: the read names its own. The writes are under "Never call" in the doc.
    { method: "POST", path: "/api/v1/rpc", body: { type: "json", match: { op: "chat.history" } }, source: `${SRC}#L70-L90` },
  ]),
  // True only when the list is sorted by updatedAt, newest first.
  newestFirst: true,

  async detect(http) {
    try {
      r.obj(await http.get("/api/v1/user"), "/api/v1/user");
      return true;
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  async listConversations(http, cursor) {
    const offset = Number(cursor ?? 0);
    const page = r.obj(await http.get("/api/v1/chats", { offset, limit: PAGE }), "chats");
    const items = r.arr(page.items, "chats.items").map((x, i) => {
      const o = r.obj(x, `chats.items[${i}]`);
      return { id: r.str(o.id, `chats.items[${i}].id`), title: r.optStr(o.title, `chats.items[${i}].title`) ?? "", updatedAt: r.time(o.updated_at, `chats.items[${i}].updated_at`) };
    });
    return { items, next: r.bool(page.has_more, "chats.has_more") && items.length > 0 ? String(offset + items.length) : undefined };
  },

  async getConversation(http, stub) {
    const c = r.obj(await http.post("/api/v1/rpc", { op: "chat.history", chat_id: stub.id }), "chat.history");
    const messages: Message[] = r.arr(c.messages, "chat.history.messages").map((x, i) => {
      const m = r.obj(x, `messages[${i}]`);
      const role = r.str(m.role, `messages[${i}].role`);
      if (role !== "user" && role !== "assistant") throw r.fail(`messages[${i}].role`, `is ${JSON.stringify(role)}`);
      return { role, text: r.str(m.text, `messages[${i}].text`), attachments: [] };
    });
    return { provider: "example", id: stub.id, title: stub.title, createdAt: r.time(c.created_at, "created_at"), updatedAt: r.time(c.updated_at, "updated_at"), messages };
  },
};
```

`projects`, `memories`, `preferences` and `library` are optional; add the
ones the site has.

## Fixture: `tests/fixtures/<id>.json`

Keys are `<path>?<query>` with the query decoded, in the order the adapter
sends it, or `<path>` for any query. A POST is `POST <path>?<query>` or
`POST <path>`. Unit tests also match `POST <path>?<query> <exact body>`
first, so one endpoint can answer each operation. The E2E sees no POST
body, so it serves the `POST <path>` answer. `{"$status": 401}` answers
that status. A site with API origins names them in the fixture's
`apiOrigins` list: the E2E serves the same routes there, with the CORS
answer (`Access-Control-Allow-Origin: <origin>` and credentials) a real
API gives its site's page. Firefox sends the interceptor no preflight, so
a bearer header's preflight is proven only by the live smoke check.

```json
{
 "provider": "example",
 "origin": "https://chat.example.com",
 "note": "Synthetic data in the documented chat.example.com shapes (docs/providers/example.md). No real chat.",
 "routes": {
  "/api/v1/user": {"id": "user-synthetic"},
  "/api/v1/chats?offset=0&limit=50": {"items": [{"id": "c1", "title": "Trip plan", "updated_at": "2026-10-01T10:00:00Z"}], "has_more": false},
  "POST /api/v1/rpc": {"created_at": "2026-10-01T09:00:00Z", "updated_at": "2026-10-01T10:00:00Z", "messages": [{"role": "user", "text": "Plan a trip"}, {"role": "assistant", "text": "Day 1: Alfama."}]}
 }
}
```

## Unit tests: `tests/<id>.test.ts`

`fixtureHttp(adapter, routes, storage?)` gives the adapter an Http with its
own reads, so a request the reads do not list fails the test.

```ts
import { describe, expect, it } from "vitest";
import { check } from "../src/index.js";
import { example } from "../src/adapters/example.js";
import { fixture, fixtureHttp } from "./fixture-http.js";

const token = { getItem: (k: string) => (k === "token" ? "synthetic-token" : null) };
const open = (routes = fixture("example")) => fixtureHttp(example, routes, token);

describe("example", () => {
  it("is signed in with a token, and signed out without one", async () => {
    expect(await example.detect(open().http)).toBe(true);
    expect(await example.detect(fixtureHttp(example, fixture("example")).http)).toBe(false);
  });
  it("P1 names the field when the list changed", async () => {
    await expect(example.listConversations(open({ "/api/v1/chats": { rows: [] } }).http)).rejects.toThrow(/example: chats.items is not a list/);
  });
  it("reads a thread that passes the foxcache/v1 check", async () => {
    const f = open();
    const [stub] = (await example.listConversations(f.http)).items;
    const c = check("conversations", await example.getConversation(f.http, stub!));
    expect(c.messages.map((m) => m.text)).toEqual(["Plan a trip", "Day 1: Alfama."]);
  });
});
```

## The E2E check: `e2e/providers/<id>.mjs`

`e2e/run.mjs` serves every fixture at its origin, grants every optional
origin but DeepSeek's, and runs each file in `e2e/providers/` with
`{ fox, net, ask, check, until, ended, running }`. Open a tab at the
origin, start a capture, wait for it to end, and check the counts and one
record, as `mistral.mjs` does. The E2E then checks that every request
matched one of your reads.

## Before the PR

- `pnpm ci:local` passes, and `pnpm e2e` passes on Ichabod.
- The live smoke check (`e2e/live-smoke.mjs`) on a real login, for an
  adapter with an API origin, a POST read or a new auth kind.
- Adult-first sites: ask the owner first. The AMO listing stays neutral.
