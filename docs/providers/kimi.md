# Kimi (www.kimi.com)

Adapter: `src/adapters/kimi.ts`. Fixture: `tests/fixtures/kimi.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md). `https://www.kimi.com` is the site Moonshot serves
in China, and `kimi.moonshot.cn` redirects to it (checked 2026-10-15 with
an unauthenticated `curl -I`). The international site `https://www.kimi.ai`
is another origin: see **Not captured**.

Auth: the page keeps a bearer token in `localStorage` under `access_token`
(plain text, a JWT), and its own script sends it as `Authorization: Bearer`.
The cookies alone answer 401. foxcache's `http` reads it in the tab for
each request and never passes it on (auth `localStorage-bearer`).
([multi-ai api_client.py](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/extractor/api_client.py#L1-L80),
[multi-ai discovery.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/discovery.md#L6-L16),
the AMO add-on "Kimi Chat Exporter" 1.0.0 `background.js` L116, confirmed)

Transport: every read is a Connect unary call,
`POST /apiv2/<package>.<Service>/<Method>` with a JSON body and a JSON
answer. Each method is its own path, so the reads list the three paths
exactly and take any body. Connect JSON leaves out empty fields: an empty
list has no `chats`, a first message has no `parentId`. An error can come
as `{error_type, message}`; `auth.token.invalid` means signed out.
([Chat2API checkResult](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/kimi.ts#L92-L108),
[multi-ai discovery.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/discovery.md#L23-L27),
[multi-ai server-behavior.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/server-behavior.md#L1-L17), confirmed)

| What | POST path and body | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/apiv2/kimi.chat.v1.ChatService/ListChats` with `{page_size: 1, query: ""}` | Any answer that is not an error. 401, or `error_type: auth.token.invalid`: signed out. | [multi-ai auth probe](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/server-behavior.md#L32-L37), [Chat2API](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/kimi.ts#L92-L108) | confirmed |
| List | `/apiv2/kimi.chat.v1.ChatService/ListChats` with `{page_size: 100, query: "", page_token?}` | `{chats: [{id, name, createTime, updateTime, files, messageContent}], nextPageToken}`. ISO times. The next page sends `page_token`; an empty or missing token ends the list. The order is not documented. | [Chat2API listChats](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/kimi.ts#L392-L421), [multi-ai list_chats_page](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/extractor/api_client.py#L82-L107), [multi-ai schema](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/discovery.md#L80-L100) | confirmed |
| One chat | `/apiv2/kimi.chat.v1.ChatService/GetChat` with `{chatId}` | `{chat: {id, name, createTime, updateTime, files, lastRequest}}`. foxcache reads the times. | [multi-ai get_chat](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/extractor/api_client.py#L109-L112), [multi-ai schema](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/discovery.md#L102-L115) | single-source |
| Messages | `/apiv2/kimi.chat.v1.ChatService/ListMessages` with `{chatId}` | `{messages: [{id, parentId, role: user\|assistant\|system, status, createTime, blocks: [{text: {content}} \| {tool} \| {file}]}]}`. One answer holds the whole chat (276 KB for 19 messages); no paging was seen. | [multi-ai list_messages](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/extractor/api_client.py#L114-L118), [multi-ai schema](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/kimi/discovery.md#L117-L138), [multi-ai parser](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/parser.py#L1-L25) | confirmed (path), single-source (fields) |
| Branches | (in the messages) | A tree on `parentId`. foxcache takes the newest message as the leaf and walks `parentId` to the root: no `parentId`, `""`, or the all-zero uuid. | [multi-ai parser](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/parser.py#L76-L111), the AMO add-on `walkMsgs` | inferred (no source names the current leaf) |
| Message text | (in the message) | The `text.content` of each block, joined by a blank line. Tool and file blocks are left out. | [multi-ai parser](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/kimi/parser.py#L256-L307) | single-source |

## Never call

Every write is a POST under `/apiv2/` too. The reads name exact paths, so
none of these can be sent:

- `/apiv2/kimi.chat.v1.ChatService/DeleteChat` and `.../BatchDeleteChats`
  ([Chat2API](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/kimi.ts#L365-L440)).
- `/apiv2/kimi.gateway.chat.v1.ChatService/Chat`, which sends a message
  ([Chat2API](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/proxy/adapters/kimi.ts#L336-L340)).
- `GET /api/auth/token/refresh`, which rotates the page's tokens
  ([Kimi-Free-API](https://github.com/xiaoY233/Kimi-Free-API/blob/04fe21fee63c843caedff12a2b6e6b07a7a844a6/src/api/controllers/chat.ts#L116-L140)).
  On a 401 the user reloads the tab, as multi-ai does.

## Not captured

- `https://www.kimi.ai`, the international site since 2026-08-30. It is
  another origin, and an adapter has one. The reads are the same paths
  (multi-ai server-behavior.md L1-17).
- Attachments: `files` carry `signUrl` links that expire and grant access,
  and no source shows the file blocks of a message. foxcache keeps none.
- Projects (`ProjectService/ListProjects`), memories
  (`MemoryService/ListMemories`) and settings (`GetUserSetting`): the item
  shapes are not known (multi-ai discovery.md L60-71).
- The model: messages carry a `scenario` such as `SCENARIO_K2D5`, which is
  a mode, not a model name.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| K1 | No `access_token`, a 401, or HTTP 200 with `error_type: auth.token.invalid`. | `detect` says signed out. | `tests/kimi.test.ts` |
| K2 | Another `error_type`. | `provider-error` that names it. | `tests/kimi.test.ts` |
| K3 | Connect JSON leaves out an empty field: no `chats`, no `messages`, no `parentId`, no `name`. | Read as empty, not as a changed shape. A field of the wrong type still throws `provider-schema`. | `tests/kimi.test.ts` |
| K4 | A chat has branches (an edit, a regenerated answer). | The newest message back to the root. A parent that is not in the chat throws `provider-schema` (P7). | `tests/kimi.test.ts` |
| K5 | `ListMessages` sends a `nextPageToken`. | `provider-schema`: foxcache does not cut the chat short without a word. | `tests/kimi.test.ts` |
| K6 | `ListChats` gives a page token or a page it gave before. | The capture stops with `pagination-loop` (C4). | `tests/kimi.test.ts` |
| K7 | A chat has more than 20 000 messages. | `too-large` (S4). | `tests/kimi.test.ts` |
| K8 | A chat file carries a `signUrl`. | No record holds it. | `tests/kimi.test.ts` |
| K40 | A `ListChats` page has no chats but a `nextPageToken`, as an empty Grok page can (GR40). | The list follows the token; only a missing or empty token ends it. A token that repeats still ends in `pagination-loop` (K6). | `tests/kimi.test.ts` |
