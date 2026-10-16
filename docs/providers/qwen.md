# Qwen Chat (chat.qwen.ai)

Adapter: `src/adapters/qwen.ts`, on the shared open-webui parts in
`src/adapters/openwebui.ts`. Fixture: `tests/fixtures/qwen.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md). The reads in the adapter list these GET paths
and nothing else.

Qwen Chat is a fork of [open-webui](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/chats.py#L293-L332)
with its own `/api/v2`. Every v2 answer is `{success, request_id, data}`,
and a failure can come with HTTP 200, so foxcache checks `success`. A
`success: false` whose `data` says unauthorized, login or token means
signed out (inferred; the expired-token answer is described in
[multi-ai server-behavior](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/qwen/server-behavior.md#L6-L16)
but not shown).

Auth: the page keeps a bearer in `localStorage` under `token` (a plain
string) and sends it as `Authorization: Bearer`, with the header
`source: web`. foxcache's `http` reads the token in the tab and never passes
it on (auth `localStorage-bearer`, key `token`), and sends `source: web` as
the page does (auth `with-headers` around it). Confirmed by
[multi-ai api_client](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/api_client.py#L1-L64),
[qwenDataExport](https://github.com/R1y3n/qwenDataExport/blob/6a727185744e83c342b615380d153dadf9056fb3/main.py#L13-L50)
and [Chat2API](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/oauth/tokenExtractionConfig.ts#L133-L148).
foxcache never calls the refresh endpoint on auth.qwen.ai.

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/api/v1/auths/` | The user (`id`), bare as upstream or in the v2 envelope. A 401 means signed out. | [multi-ai api_client L8](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/api_client.py#L8), [gpt4free Qwen.py L1153](https://github.com/xtekky/gpt4free/blob/74661d164023bb3d4830fe51aa6e76749c781bc2/g4f/Provider/Qwen.py#L1153) | confirmed (path); the bare shape is upstream's |
| List | `/api/v2/chats/?page=N` | `data: [{id, title, created_at, updated_at, project_id, pinned}]`, page from 1, newest first; an empty page ends it. Chats in a project are not in it, and pinned chats may not be: upstream open-webui leaves them out by default. | [multi-ai L74-164](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/api_client.py#L74-L164), [qwenDataExport L66-108](https://github.com/R1y3n/qwenDataExport/blob/6a727185744e83c342b615380d153dadf9056fb3/main.py#L66-L108), [discovery](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/qwen/discovery.md#L9-L19) | confirmed |
| Pinned | `/api/v2/chats/pinned` | `data: [{id, title, created_at, updated_at, pinned}]`, one list with no paging, in the list's row shape. foxcache reads it with list page 1, each chat once (QWEN40). | [multi-ai L154-163](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/api_client.py#L154-L163), [discovery L13](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/qwen/discovery.md#L13) | single-source |
| Project chats | `/api/v2/chats/?page=N&project_id={id}` | Same shape, one list per project, read after the main list. | [multi-ai L83-121](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/api_client.py#L83-L121) | single-source |
| One chat | `/api/v2/chats/{id}` | `data: {id, title, created_at, updated_at, project_id, currentId, chat: {history: {messages: {id: {parentId, role, content, content_list, timestamp, files}}}}}`. foxcache walks from `currentId` up `parentId`. Times are epoch seconds, as a number or a numeric string. | [multi-ai parser L204-211](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/parser.py#L204-L211), [qwenDataExport L111-126](https://github.com/R1y3n/qwenDataExport/blob/6a727185744e83c342b615380d153dadf9056fb3/main.py#L111-L126) | confirmed |
| Message text | (in the chat) | The `content_list[].content` blocks, or the flat `content`. `reasoning_content` is left out. | [multi-ai helpers L34-50](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/_parser_helpers.py#L34-L50) | single-source |
| Attachments | (in the message) | `files[]`: `name` (or `file_name`), `id`, `size`. The presigned `url` is left out. | [multi-ai helpers L145-154](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/_parser_helpers.py#L145-L154) | single-source |
| Projects | `/api/v2/projects/` | `data: [{id, name, custom_instruction}]`. | [multi-ai L171-176](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/api_client.py#L171-L176), [parser docstring](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/parser.py#L1-L20) | single-source |
| Memories | `/api/v2/memories/?page_size=50&page_num=N` | `data: {memory_nodes: [{memory_node_id, content, chat_id, created_at, updated_at}], total}`, page from 1, until `total` or an empty page. | [multi-ai account_memory L23-40](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/extractor/account_memory.py#L23-L40) | single-source |
| Personalization | `/api/v2/users/user/settings` | `data.personalization`: `name`, `description` (about me), `instruction`, `style`; `null` when never set. | [multi-ai memory_parser L105-120](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/qwen/memory_parser.py#L105-L120), [discovery L33-38](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/qwen/discovery.md#L33-L38) | single-source |

## Never call

- `DELETE /api/v2/chats/` with no id deletes every chat
  ([Chat2API qwen-ai.ts](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/qwen-ai.ts#L206-L224)).
  Every read is a GET, so `http` cannot send them.

## Not captured

- Project files: `/api/v2/projects/{id}/files` gives presigned URLs; the
  names are not read yet.
- Folders: not verified on Qwen.
- Whether the bearer and `source: web` are both needed is unverified;
  foxcache sends both, as the page does. The page also sends `bx-v`, a
  build version, which foxcache does not copy.
- Rate limits: none documented.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| QWEN1 | A v2 answer reports a failure with HTTP 200 (`success: false`). | Unauthorized, login or token in `data` means `logged-out`; any other is `provider-error`. A `success` that is not true or false is `provider-schema`. | `tests/qwen.test.ts` |
| QWEN2 | A chat id is empty, or would leave `/api/v2/chats/{id}`. | `not-allowed` before any request (H10). An empty id would read the list path `/api/v2/chats/`. | `tests/qwen.test.ts` |
| QWEN3 | The memory pages repeat. | `pagination-loop`, after `MAX_SUBPAGES` pages at most. | `tests/qwen.test.ts` |
| QWEN40 | A pinned chat is not in the main list: the cited multi-ai client reads pinned chats from `GET /api/v2/chats/pinned`, and upstream open-webui leaves them out of `/chats/` by default. | The first list page is the pinned chats and main page 1 in one, each chat once, so a pinned chat is read whether or not the main list holds it, and no page repeats the one before it (C4). Not checked with a real login. | `tests/qwen.test.ts` |
| QWEN41 | A `success: false` answer echoes back site text: a prompt, a chat title, a request id with a token in it. | The error names the path only, never the site's text, so the text stays out of the checkpoint and the popup. The Meta and Poe adapters follow the same rule. | `tests/qwen.test.ts` |
| QWEN42 | `/api/v1/auths/` answers `success: false` for a reason that is not the session, such as a rate limit. | `detect` reads it as QWEN1 does: unauthorized, login or token is signed out; any other reason throws `provider-error`, so a capture does not say "sign in" to a signed-in user. | `tests/qwen.test.ts` |
