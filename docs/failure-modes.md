# Failure modes

This file lists every way foxcache can fail. Each row names the wanted
behavior and the test that checks it. The rows come before the code, and the
tests commit with the code that makes them pass, never after it.

All errors are `FoxcacheError` with a `code`. The codes are in the rows.

## Schema

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| S1 | A record misses a required field, has a wrong type, an unknown provider, an unknown role or a time that is not ISO-8601. | `checkConversation` and the other checks throw `invalid-record` and name the field path. | `tests/schema.test.ts` |
| S2 | A record carries extra keys, such as raw provider JSON. | The check drops every key the schema does not name. | `tests/schema.test.ts` |
| S3 | A message text holds HTML or a script, such as `<img src=x onerror=alert(1)>`. | The text is kept as it is. Every output escapes it (O2, X6). | `tests/schema.test.ts` |
| S4 | A conversation is huge: 100 000 messages, or one message of 10 million characters. | A message text over 1 000 000 characters is cut and marked `truncated: true`. A conversation over 20 000 messages throws `too-large`. | `tests/schema.test.ts` |
| S5 | A text holds a NUL or a lone surrogate, which breaks JSON tools and IndexedDB keys. | The check removes NUL and replaces a lone surrogate with U+FFFD. | `tests/schema.test.ts` |
| S6 | An id is empty, very long, or holds `/`, `..` or a control character. | The check throws `invalid-record`. Ids are 1-200 printable characters without `/`. | `tests/schema.test.ts` |

## Store

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| ST1 | The same conversation is captured twice. | One record. The copy with the newer `updatedAt` wins. An equal `updatedAt` keeps the stored copy. | `tests/store.test.ts` |
| ST2 | The same memory comes twice without an id. | One record: the key is a hash of the provider and the text. | `tests/store.test.ts` |
| ST3 | A stored record fails its check (an older or broken write). | Reads skip it and count it in `problems`. It is not deleted. Other records still load. | `tests/store.test.ts` |
| ST4 | Delete all is called. | Every kind and the checkpoints are empty after it. | `tests/store.test.ts` |
| ST5 | A search has an empty or very long query. | An empty query throws `bad-query`. A query over 200 characters throws `bad-query`. | `tests/store.test.ts` |
| ST6 | A search term appears in thousands of messages. | The search returns at most `limit` hits (default 50), each with one short snippet. | `tests/store.test.ts` |
| ST7 | A memory, a preference or a project is edited or deleted on the site. A memory with no id gets a new key when its text changes. | `keep` deletes the stored records of one provider and kind whose key is not in the list it gets. Other providers, other kinds and records that fail their check stay. | `tests/store.test.ts` |

## Archive file

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| A1 | The file is not JSON, or its `schema` is not `foxcache/v1`. | `parseArchive` throws `bad-archive` and says what it found. | `tests/archive.test.ts` |
| A2 | The file is larger than 256 MiB. | `parseArchive` and `foxcache import` throw `too-large` before they parse it. | `tests/archive.test.ts`, `tests/cli.test.ts` |
| A3 | One record in the file is invalid. | The import fails as a whole with `bad-archive` and names the record. Nothing is written. | `tests/archive.test.ts` |
| A4 | The file has the same record twice. | The newer copy wins, as in ST1. | `tests/archive.test.ts` |
| A5 | An export and an import round trip. | The records come back equal. | `tests/archive.test.ts` |

## Outputs

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| O1 | A conversation title holds `../`, `/`, a drive letter, control characters or 300 characters. | The Markdown file name is a safe slug of at most 60 characters in `<provider>/`. Two titles that slug the same get `-2`, `-3`. | `tests/outputs.test.ts` |
| O2 | A message holds HTML or Markdown that would run or render as markup. | The Markdown output escapes `<`, `>` and `&`, and disarms `javascript:`, `vbscript:` and `data:` links, inline or as a reference definition, so a viewer shows the text and runs nothing. | `tests/outputs.test.ts` |
| O3 | A memory text has line breaks, or starts with `- ` or `#`. | The memory list keeps one memory per line: line breaks become spaces. | `tests/outputs.test.ts` |
| O4 | The zip holds a name with `..`, or the same name twice. | Names come from O1 only. The zip is valid: `unzip -t` passes in the test. | `tests/outputs.test.ts` |

## Provider requests (`http`)

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| H1 | An adapter asks for an absolute URL, `//host/...` or an origin that is neither its own nor one of its `apiOrigins`. | `http` throws `not-allowed` before any request. | `tests/http.test.ts` |
| H2 | The user is signed out: 401 or 403, or a redirect to a login page. | `http` throws `logged-out`. | `tests/http.test.ts` |
| H3 | The provider answers 429. | `http` throws `rate-limited` with the `Retry-After` seconds. The runner handles it (C3). | `tests/http.test.ts` |
| H4 | The answer is not JSON (an HTML challenge page), or is over 50 MB, with or without a Content-Length. | `http` throws `provider-schema` or `too-large`. It reads the body as a stream and stops once the bytes pass the limit. | `tests/http.test.ts` |
| H5 | A bearer token the site uses (any auth kind: `page-session`, `localStorage-bearer`, `cookie-bearer`) leaks into a record, an error message, the event page, the store, an export or a log. | The token stays in the auth closure inside `http`, in the tab. No result, no error text and no JSON of `http` holds it, and it goes only to requests that match a read. | `tests/auth.test.ts` |
| H6 | The answer is 5xx. | `http` throws `provider-error` with the status. | `tests/http.test.ts` |
| H7 | An adapter asks for the answer that holds the page-session token (ChatGPT `/api/auth/session`) under another spelling: `/api/auth/session/`, `/api/AUTH/session`, `/api/auth/%73ession`, `/api/auth/session;x`, or an encoded `..`, `/` or `\` after a listed prefix. | Only exact reads pass, so every spelling throws `not-allowed` before any request. A reads table that names a path the auth kind keeps private fails when `http` is created. | `tests/auth.test.ts` |
| H8 | An adapter sends a GET that is not a read: a GET that deletes (Genspark `/api/project/delete?project_id=`), a path no read names, or a query key the read does not list. | `http` throws `not-allowed` before any request. Each adapter lists every GET it sends, path by path. | `tests/http.test.ts` |
| H9 | An adapter sends a POST that is not a read: a path no read names, a JSON body whose operation (`queryName`, a persisted query hash, an IM `cmd`) is not listed, a batchexecute `f.req` with an rpc id that writes (NotebookLM `J7Gthc` deletes chat history), an `rpcids` query that does not equal the ids in `f.req`, or a form field that is not text. | `http` throws `not-allowed` before any request. | `tests/http.test.ts` |
| H10 | A value in a `{placeholder}` segment holds `/`, `%2F`, `..`, `.`, any `%` escape, or is empty, or the path is one that URL parsing would change (`/a/./b`). | `http` throws `not-allowed` before any request. | `tests/http.test.ts` |
| H11 | A reads table is wrong: not frozen, a GET with a body rule, a POST without one, an entry with no https source, an origin that is not in `apiOrigins`, a batchexecute read that does not allow the `rpcids` query, two GET reads of one path, or an API origin that is not a bare https origin. | `createHttp` throws, so the adapter fails on its first use. A unit test creates `http` for every adapter. | `tests/reads.test.ts` |
| H12 | An adapter reads from an API host of the same site (`neo.character.ai`) or of another site (`api.individual.githubcopilot.com`). | The request goes from the tab with `credentials: "include"`. Firefox sends the page's `Origin` and applies the API's CORS answer, as for the page's own calls ([cors.md](cors.md)). | `tests/http.test.ts`, E2E |
| H13 | `fetch` itself fails: the network is down, or CORS refuses because the API does not allow the page's origin. | `http` throws `provider-error` that names the origin and path, not a bare `TypeError`. | `tests/http.test.ts`, E2E |
| H14 | An auth kind finds no token: the localStorage key or the cookie is missing, is not JSON when a field is named, or the field is missing or empty; the session answer has no token. | `http` throws `logged-out` and sends no request to the read. The message names the site, never the value. | `tests/auth.test.ts` |
| H15 | A read answers text that is not JSON (batchexecute with its `)]}'` line, stream frames, HTML), which the adapter decodes itself, and the decoder throws, or the text is over 50 MB. | A `FoxcacheError` from the decoder passes on as it is. Any other throw becomes `provider-schema`, with no answer text in the message. The size cap is the one of H4. | `tests/http.test.ts` |
| H16 | A site's reads need a header its page sends: Doubao's IM reads answer `712012002` ("unsupported encoding") without `content-type: application/json; encoding=utf-8`, and its page sends `agw-js-conv: str`. | A read names fixed `headers`, and `http` sends them on that read only, with the auth kind's headers after them. A reads table whose fixed header is `authorization`, `cookie`, `host`, `origin`, `referer` or `content-length`, is not a lowercase name, or has a value with a control character fails when `http` is created. | `tests/http.test.ts`, `tests/reads.test.ts` |

## Capture runner

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| C1 | `detect` says signed out. | The capture ends at once with `logged-out`. No other request is sent. | `tests/capture.test.ts` |
| C2 | Requests go out in parallel or with no pause. | One request at a time, with `delayMs` between them. | `tests/capture.test.ts` |
| C3 | A 429 storm: every request answers 429. | The runner waits `Retry-After`, or 2, 4, 8 ... up to 60 s, and stops with `rate-limited` after 6 tries. The checkpoint lets a later run resume. | `tests/capture.test.ts` |
| C4 | The list never ends: the provider returns the same page or the same cursor again. A list in parts (DeepSeek: pinned chats, then the rest) can repeat an id in a later part, which is not a loop. | The runner stops with `pagination-loop` only when a page has the same ids as the page before it, or a cursor comes again. It also stops after 2 000 pages. | `tests/capture.test.ts` |
| C5 | The provider changed its schema: a list page or a conversation has a shape the adapter does not know. | A list page throws `provider-schema` and ends the capture. One bad conversation is skipped and counted in `errors`. Three in a row end the capture with `provider-schema`. | `tests/capture.test.ts` |
| C6 | The user clicks Stop. | The runner sends no request after it: not in the pause between requests, not after a backoff wait, and not inside an optional kind that makes many requests. A long wait ends at once. The status is `stopped`. A checkpoint the agent saves cannot undo the click. | `tests/capture.test.ts`, E2E |
| C7 | A capture stopped halfway is started again. | It resumes from the checkpoint and does not fetch done conversations again. | `tests/capture.test.ts` |
| C8 | A second capture runs after the first finished. | It fetches only conversations whose `updatedAt` is newer than the stored copy. On a newest-first list, and only when the caller allows it, it stops at the first page with no change. | `tests/capture.test.ts` |
| C10 | A capture stops early at a page with no change, but older conversations were never stored: the run is a resume, or the last capture had errors. | The early stop is off unless the caller allows it, and a resumed run never stops early, so the rest of the list is read. | `tests/capture.test.ts` |
| C9 | An optional kind (memories, projects ...) fails. | Its error is counted, and the conversations are still captured. A `logged-out` there ends the capture. | `tests/capture.test.ts` |
| C11 | An optional kind that was read in full no longer has a record the store holds: an edited Claude memory, a deleted ChatGPT memory, a cleared preference. | After it stores every record of the kind, the runner sends `keep` with their keys, and the event page deletes the rest of that provider and kind (ST7). A kind that failed or was stopped sends no `keep`, so nothing is deleted on a partial read. | `tests/capture.test.ts`, E2E |

## Adapters

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| P1 | The documented response shape gives a field the adapter needs as missing or of the wrong type. | The adapter throws `provider-schema`, naming the provider and the field. | `tests/<provider>.test.ts` |
| P2 | A ChatGPT conversation has branches (edits, regenerations), hidden system nodes and tool calls. | The messages are the visible thread from `current_node` back to the root: no hidden node, no tool call. A cycle in the parent links throws `provider-schema`. | `tests/chatgpt.test.ts` |
| P3 | A Claude conversation has branches. | The messages follow `current_leaf_message_uuid` back to the root. | `tests/claude.test.ts` |
| P4 | A time is epoch seconds on one site and ISO-8601 on another. | Every adapter gives ISO-8601 UTC. | `tests/<provider>.test.ts` |
| P5 | An attachment has file contents or extracted text. | Only name, id, type and size are kept. | `tests/<provider>.test.ts` |
| P6 | A Le Chat message has no `turn`, or a `turn` that is not a number. | The adapter throws `provider-schema` and names the message. It does not guess an order, which would store the thread out of order and never fix it. | `tests/mistral.test.ts` |
| P7 | A message in the thread names a parent that is not in the conversation. | The adapter throws `provider-schema` and names the message and the parent. It does not store the part below the gap. Each adapter names its own root: `parent: null` (ChatGPT), `parent_id: null` (DeepSeek), the all-zero uuid (Claude). | `tests/chatgpt.test.ts`, `tests/deepseek.test.ts`, `tests/claude.test.ts` |
| P8 | The ChatGPT project sidebar gives a cursor it gave before. | The adapter throws `pagination-loop`. It does not return the projects read so far, which would drop the rest and their chats with no error (C4). | `tests/chatgpt.test.ts` |
| P9 | A list inside one call never ends: the ChatGPT project sidebar or the Le Chat `message.all` pages give a new cursor each time. | The adapter throws `pagination-loop` after 1 000 pages. Le Chat throws `too-large` once a chat passes 20 000 messages, while it reads them, not after (S4). | `tests/chatgpt.test.ts`, `tests/mistral.test.ts` |
| P10 | Claude's `detect` gets an answer that is not JSON (a "Just a moment..." challenge page) or a changed shape. | `detect` throws that error, so the capture ends with `provider-schema` and does not tell the user to sign in. Only a 401, a 403 or an account with no chat organization means signed out. | `tests/claude.test.ts` |

## SCENT

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| SC1 | A sender that is not `foxscope@pooriaarab` sends `scent.list` or `scent.read`. | No answer: the event page rejects with Firefox's "Receiving end does not exist", the same as an add-on that is not installed. | `tests/scent.test.ts`, E2E |
| SC2 | foxscope asks for `cache.conversations`. | It is listed as private and never returned. | `tests/scent.test.ts`, E2E |
| SC3 | foxscope asks for `cache.projects`. | Names only: no instructions and no files. | `tests/scent.test.ts` |
| SC4 | `scent.read` has bad fields: not a list, not strings, or over 100. | The answer is `{ error }`. | `tests/scent.test.ts` |

## Node store, CLI and MCP

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| N1 | `archive.json` is not valid JSON. | Every command throws `corrupt-store` with the path. The file is not overwritten. | `tests/node.test.ts` |
| N2 | A write fails halfway. | The old file is whole. No `.tmp` file is left. | `tests/node.test.ts` |
| N3 | `FOXCACHE_HOME` is set. | The store is in that directory, not in `~/.foxcache/`. | `tests/node.test.ts` |
| N4 | The store directory is created. | It has mode 0700 and the file 0600, set at creation only. | `tests/node.test.ts` |
| N5 | An import, or a save through `foxcache/node`, would make `archive.json` larger than 256 MiB, which no command could open again. | The save throws `too-large` and writes nothing. The old file stays as it was, and every command still opens it. | `tests/node-size.test.ts` |
| N6 | Two imports run at once. Each reads the file, merges and renames its own copy over it, so the last one wins and the records of the other are lost. | A write takes `archive.json.lock` before it reads the file, so the second import waits and merges into the first one's result. A lock left by a process that no longer runs stops the import with `locked`, which names the file to delete. | `tests/cli.test.ts` |
| CL1 | A command or a flag is unknown, or `show` gets an id that does not exist. | Bad usage exits 2 with the usage text. A foxcache error exits 1 with one line that says what is wrong. | `tests/cli.test.ts` |
| CL2 | `export --md` targets a folder that has files. | It refuses with `not-empty` and writes nothing. | `tests/cli.test.ts` |
| CL3 | A title, a message or an id holds terminal escape codes (`\x1b[...`, or the C1 code U+009B), which could rewrite the terminal. | Ids may not hold control characters. The CLI removes control characters, except line breaks and tabs, from all text it prints, and JSON output escapes DEL and C1 codes. | `tests/cli.test.ts`, `tests/schema.test.ts` |
| CL4 | A file system call fails: a path is not a folder (`ENOTDIR`), the disk is full, access is denied. | The command exits 1 with one `foxcache:` line that holds the system message, never a stack trace. | `tests/cli.test.ts` |
| M1 | The MCP server starts without `--allow conversations`. | It has no conversation tools. `tools/list` shows only `list_memories` and `list_preferences`. | `tests/mcp.test.ts` |
| M2 | A tool call has bad arguments. | A tool error, not a crash. | `tests/mcp.test.ts` |
| M3 | A client asks for a write. | There is no write tool. | `tests/mcp.test.ts` |

## Extension (E2E)

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| X1 | A content script, a provider page or another extension sends the event page a store or capture message. | Only the extension's own pages may read, export or delete. Only the agent in the capture tab, from the provider origin, may add records. | E2E |
| X2 | The origin permission is not granted. | The provider shows "Allow in settings". Nothing is injected. | E2E |
| X3 | No tab of the provider is open. | The provider shows "Open <site>". | E2E |
| X4 | The provider tab is closed during a capture. | The capture is marked interrupted and can be resumed. | E2E |
| X5 | Capture sends a request that no read of the adapter lists, or a request other than GET from an adapter that has no POST read. | Never: the E2E checks every intercepted request against the adapter's reads, and that the four adapters send GET only. | E2E |
| X6 | The archive page shows a message with HTML in it. | It shows the text. No element from the message is in the page. | E2E |
| X7 | Delete all runs while a capture is writing a record. | The record that raced the delete is removed again, and the capture is told to stop. | `tests/background.test.ts`, E2E (delete all) |
| X8 | A capture fails again and again at the same place on Resume, for example a project that no longer exists. | The popup offers Start over next to Resume. Start over leaves the old checkpoint behind. | E2E |
| X9 | Delete all runs while the agent saves a checkpoint, or while the event page marks a capture interrupted: the write read the capture before the delete and lands after it. | The checkpoint is removed again and the agent is told to stop. Its next record is refused and not stored. Delete all leaves nothing. | `tests/background.test.ts` |
| X10 | The extension exports a JSON archive that `foxcache import` refuses: over 256 MiB, or made larger by indentation. | The JSON export is compact. One over 256 MiB is refused with `too-large`, and the archive page says so and points to the Markdown export. | `tests/background-export.test.ts` |
| X11 | The user turns a site off in the settings (or in about:addons) while its capture runs. The agent is in the tab already, and its same-origin fetches need no host grant. | The capture stops at once and is marked stopped. The event page stores no record and no checkpoint from an agent whose site is not allowed. | E2E |
| X12 | An adapter reads from an API origin, and the user allowed the site's page but not its API host, or turns one of the two off. | A site is allowed only when all its origins are. The settings switch asks for all of them at once, the popup shows "Allow in settings" until all are granted, and removing any of them stops the capture (X11). A unit test checks that the manifest's `optional_host_permissions` are exactly the adapters' origins. | `tests/registry.test.ts`, `tests/background.test.ts` |

## Release

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| R1 | A push to `release` publishes a version whose Firefox E2E failed or never ran, because `release.yml` ran only `ci:local` and does not wait for CI. | `release.yml` runs `pnpm e2e` before `npm publish` and `web-ext sign`, and a failed E2E stops the release. | `tests/release.test.ts` |
| R2 | The release job holds `contents: write` and `id-token: write` while it installs packages (with their build scripts), builds, runs vitest, web-ext and third-party actions, so any of them could push or mint an OIDC token. | Those run in a `check` job with `contents: read`, which hands `dist/` and `dist-ext/` over as an artifact. Only the `publish` job holds the write scopes, and it installs with `--ignore-scripts`, builds nothing and tests nothing. | `tests/release.test.ts` |
