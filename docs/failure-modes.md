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
| O2 | A message holds HTML or Markdown that would run or render as markup. | The Markdown output escapes `<`, `>` and `&`, so a viewer shows the text and runs nothing. | `tests/outputs.test.ts` |
| O3 | A memory text has line breaks, or starts with `- ` or `#`. | The memory list keeps one memory per line: line breaks become spaces. | `tests/outputs.test.ts` |
| O4 | The zip holds a name with `..`, or the same name twice. | Names come from O1 only. The zip is valid: `unzip -t` passes in the test. | `tests/outputs.test.ts` |

## Provider requests (`http`)

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| H1 | An adapter asks for a method other than GET, an absolute URL, `//host/...` or another origin. | `http` throws `not-allowed` before any request. | `tests/http.test.ts` |
| H2 | The user is signed out: 401 or 403, or a redirect to a login page. | `http` throws `logged-out`. | `tests/http.test.ts` |
| H3 | The provider answers 429. | `http` throws `rate-limited` with the `Retry-After` seconds. The runner handles it (C3). | `tests/http.test.ts` |
| H4 | The answer is not JSON (an HTML challenge page) or is over 50 MB. | `http` throws `provider-schema` or `too-large`. | `tests/http.test.ts` |
| H5 | A bearer token that the site uses (ChatGPT) leaks into a record, an error message or a log. | The token stays inside `http`. No result and no error text holds it. | `tests/http.test.ts` |
| H6 | The answer is 5xx. | `http` throws `provider-error` with the status. | `tests/http.test.ts` |

## Capture runner

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| C1 | `detect` says signed out. | The capture ends at once with `logged-out`. No other request is sent. | `tests/capture.test.ts` |
| C2 | Requests go out in parallel or with no pause. | One request at a time, with `delayMs` between them. | `tests/capture.test.ts` |
| C3 | A 429 storm: every request answers 429. | The runner waits `Retry-After`, or 2, 4, 8 ... up to 60 s, and stops with `rate-limited` after 6 tries. The checkpoint lets a later run resume. | `tests/capture.test.ts` |
| C4 | The list never ends: the provider returns the same page or the same cursor again. | The runner stops with `pagination-loop`. It also stops after 2 000 pages. | `tests/capture.test.ts` |
| C5 | The provider changed its schema: a list page or a conversation has a shape the adapter does not know. | A list page throws `provider-schema` and ends the capture. One bad conversation is skipped and counted in `errors`. Three in a row end the capture with `provider-schema`. | `tests/capture.test.ts` |
| C6 | The user clicks Stop. | The runner sends no request after it: not in the pause between requests, not after a backoff wait, and not inside an optional kind that makes many requests. A long wait ends at once. The status is `stopped`. A checkpoint the agent saves cannot undo the click. | `tests/capture.test.ts`, E2E |
| C7 | A capture stopped halfway is started again. | It resumes from the checkpoint and does not fetch done conversations again. | `tests/capture.test.ts` |
| C8 | A second capture runs after the first finished. | It fetches only conversations whose `updatedAt` is newer than the stored copy. On a newest-first list, and only when the caller allows it, it stops at the first page with no change. | `tests/capture.test.ts` |
| C10 | A capture stops early at a page with no change, but older conversations were never stored: the run is a resume, or the last capture had errors. | The early stop is off unless the caller allows it, and a resumed run never stops early, so the rest of the list is read. | `tests/capture.test.ts` |
| C9 | An optional kind (memories, projects ...) fails. | Its error is counted, and the conversations are still captured. A `logged-out` there ends the capture. | `tests/capture.test.ts` |

## Adapters

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| P1 | The documented response shape gives a field the adapter needs as missing or of the wrong type. | The adapter throws `provider-schema`, naming the provider and the field. | `tests/<provider>.test.ts` |
| P2 | A ChatGPT conversation has branches (edits, regenerations), hidden system nodes and tool calls. | The messages are the visible thread from `current_node` back to the root: no hidden node, no tool call. A cycle in the parent links throws `provider-schema`. | `tests/chatgpt.test.ts` |
| P3 | A Claude conversation has branches. | The messages follow `current_leaf_message_uuid` back to the root. | `tests/claude.test.ts` |
| P4 | A time is epoch seconds on one site and ISO-8601 on another. | Every adapter gives ISO-8601 UTC. | `tests/<provider>.test.ts` |
| P5 | An attachment has file contents or extracted text. | Only name, id, type and size are kept. | `tests/<provider>.test.ts` |

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
| CL1 | A command or a flag is unknown, or `show` gets an id that does not exist. | Bad usage exits 2 with the usage text. A foxcache error exits 1 with one line that says what is wrong. | `tests/cli.test.ts` |
| CL2 | `export --md` targets a folder that has files. | It refuses with `not-empty` and writes nothing. | `tests/cli.test.ts` |
| CL3 | A title or a message holds terminal escape codes (`\x1b[...`), which could rewrite the terminal. | The CLI removes control characters, except line breaks and tabs, from all it prints. | `tests/cli.test.ts` |
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
| X5 | Capture sends a request other than GET to the provider. | Never: the E2E checks every intercepted request. | E2E |
| X6 | The archive page shows a message with HTML in it. | It shows the text. No element from the message is in the page. | E2E |
| X7 | Delete all runs while a capture is writing a record. | The record that raced the delete is removed again, and the capture is told to stop. | E2E (delete all) |
| X8 | A capture fails again and again at the same place on Resume, for example a project that no longer exists. | The popup offers Start over next to Resume. Start over leaves the old checkpoint behind. | E2E |
