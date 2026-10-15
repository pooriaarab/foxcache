# Poe (poe.com)

Adapter: `src/adapters/poe.ts`. Fixture: `tests/fixtures/poe.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md).

Auth: the page's cookies (`p-b`, `p-lat`) plus two headers on every
GraphQL call (auth `page-formkey`):

- `poe-formkey`: the first 32 characters of what a page function returns.
  Its name changes with each build; paw finds it in the page's inline
  scripts with `window\.([a-zA-Z0-9]+)=function\(\)\{return window`, and
  ChatALL calls `window.ereNdsRqhp2Rd3LEW()` in the page. foxcache finds it
  the same way and calls it in the page (Firefox `wrappedJSObject`).
  ([paw bundles.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/bundles.py#L7-L83),
  [ChatALL background.js](https://github.com/ai-shifu/ChatALL/blob/6d089c2ab72dde2ba1010cc1e910ceb766458546/src/background.js#L344-L347),
  [poe-api](https://github.com/ading2210/poe-api/blob/9286c02017f3102dc665afb631a3ebd00bd566ee/src/poe/__init__.py#L214-L248), confirmed)
- `poe-tag-id`: `md5(body + formkey + "4LxgHM6KpFqokX0Ox")` over the JSON
  body as sent. The salt can rotate (2023: `3L346H46q37gXddko`).
  ([paw api.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/api.py#L117-L141),
  [ChatALL PoeBot.js](https://github.com/ai-shifu/ChatALL/blob/6d089c2ab72dde2ba1010cc1e910ceb766458546/src/bots/poe/PoeBot.js#L26-L53),
  [LLMCookieBridge](https://github.com/tkgo11/LLMCookieBridge/blob/aba36f6473f6168d00c04bcc07cf3c95313f97eb/src/llm_cookie_bridge/providers/poe.py#L55-L102), confirmed)

foxcache does not send `poe-tchannel` (the realtime channel; LLMCookieBridge
reads without it) or `poe-queryname` (ericblue sends it; unverified whether
Poe needs it).

Every operation is `POST /api/gql_POST` with
`{"queryName", "variables", "extensions": {"hash"}}`, a persisted query
([paw queries.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/queries.py#L161-L171), confirmed). Each read below
matches both the name and the hash.

| What | Operation (POST /api/gql_POST) | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `ChatHistoryListPaginationQuery` with `{count: 1, cursor: null}` | `data.chats` is an object. A 401, a 403 or a redirect: signed out. | as the list | single-source (what Poe answers a signed-out page is not documented) |
| List | `ChatHistoryListPaginationQuery`, hash `6ce01455b0201e625489da90c65f87a2809d212ea41ab6e39412b6913990e81f`, `{count: 50, cursor}` (`null` first) | `data.chats.edges[].node{id, chatId, chatCode, title, defaultBotObject.displayName}`, `data.chats.pageInfo{hasNextPage, endCursor}`. No time. | [ericblue](https://github.com/ericblue/poe-chat-exporter/blob/49df39b9b6436b7986ca15a2a50535f3c3027f6e/poe-exporter.py#L98-L131), [paw api.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/api.py#L390-L420), [hash: paw queries.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/queries.py#L21), [ericblue](https://github.com/ericblue/poe-chat-exporter/blob/49df39b9b6436b7986ca15a2a50535f3c3027f6e/poe-exporter.py#L14-L17) | confirmed (the same hash in 2025 and March 2026) |
| One chat | `ChatListPaginationQuery` (one chat's messages, despite the name), hash `c1a8fd96dd6e0a4679814182951b1e256e175587513c81b223addf931833a692`, `{count: 100, cursor, id: <list node id>}` | `data.node.messagesConnection.edges[].node{messageId, author ("human" or the bot handle), text, contentType, creationTime (epoch µs), state}`, oldest first inside a page; `pageInfo{hasNextPage, startCursor}` pages back to older messages. | [paw api.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/api.py#L1002-L1056), [ericblue](https://github.com/ericblue/poe-chat-exporter/blob/49df39b9b6436b7986ca15a2a50535f3c3027f6e/poe-exporter.py#L134-L163), [hash: paw queries.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/queries.py#L24) | confirmed |
| Rate limit | (any) | HTTP 429; ericblue waits 10 s. foxcache's runner backs off (C3). | [ericblue](https://github.com/ericblue/poe-chat-exporter/blob/49df39b9b6436b7986ca15a2a50535f3c3027f6e/poe-exporter.py#L79-L83) | single-source |

## Never call

Every write is a POST to the same `/api/gql_POST`, so foxcache lists name
and hash together, and `http` refuses any other pair. Writes include
`SendMessageMutation`, `SubscriptionsMutation` (the wrappers send it on
connect), `DeleteUserMessagesMutation`, `DeleteMessageMutation`, and
`DeleteChat`, a delete whose name does not end in `Mutation`
([paw queries.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/queries.py#L40-L48), [paw api.py](https://github.com/snowby666/poe-api-wrapper/blob/bbb6831eb1ccbc2bed7bae89cfbd29a106bdd707/poe_api_wrapper/api.py#L944-L966)).
So a name ending in `Query` is not enough: only the two pairs above pass.

## Not captured

- Times on the list: the list node has none, so every capture reads every
  chat again (each stub gets the capture's time). A chat's times are its
  first and last message's.
- Bots (`AvailableBotsSelectorModalPaginationQuery`,
  `HandleProfilePageQuery`): sourced, but medium confidence and not in
  foxcache/v1's chat records; a later library read.
- Attachments, chat breaks (`SendChatBreakMutation` exists; how a break
  shows in the messages is not documented), the per-bot list.
- Memories, projects and custom instructions: no source found.
- Live check: no read here has been sent from a signed-in tab. The owner
  should run the live smoke check (`e2e/live-smoke.mjs`) before release.

## Failure modes

| ID | Failure | What foxcache does | Test |
|---|---|---|---|
| PO1 | The page names no formkey function, or it gives a key of the wrong shape (a new build). | `provider-schema` before any request (H17). | `tests/poe.test.ts`, `tests/auth.test.ts` |
| PO2 | A persisted hash changed: Poe answers `{data: null, errors}`. | `provider-schema` naming the operation, without the site's error text. | `tests/poe.test.ts` |
| PO3 | The list has no time. | Every stub gets the capture's time, so each chat is read again; nothing is skipped by a guessed time. | `tests/poe.test.ts` |
| PO4 | The message pages give a `startCursor` they gave before. | `provider-schema` (a loop); `pagination-loop` after 1 000 pages; `too-large` past 20 000 messages. | `tests/poe.test.ts` |
| PO5 | A chat with no messages. | `provider-schema`: no time to give it. | `tests/poe.test.ts` |
