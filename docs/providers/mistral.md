# Le Chat (chat.mistral.ai)

Adapter: `src/adapters/mistral.ts`. Fixture: `tests/fixtures/mistral.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md). The assistant was renamed "Vibe" in August 2026 and
still runs at chat.mistral.ai.

Auth: the page's cookies only (an Ory session cookie). No header, no token.
([TotalRecalls](https://github.com/breakwater2026/TotalRecalls/blob/ae17f9350dd19728a1bd48e7e5731097eb03ff70/totalrecalls/adapters/mistral/http.py#L56-L64),
[ClaudeBar](https://github.com/tddworks/ClaudeBar/blob/40d7444c7a251e1a8aa5f0a21f202b74f9d959f0/docs/providers/mistral/design.md#L11-L12), confirmed)

Transport: reads are tRPC GET calls,
`/api/trpc/<proc1>,<proc2>?batch=1&input={"0":{"json":<input>},"1":...}`.
The answer is an array of `{result: {data: {json}}}` or
`{error: {json: {message, data: {code, httpStatus}}}}`. Every write is a POST,
and foxcache sends none.
([chatgpt-to-notion](https://github.com/L-a-r-t/chatgpt-to-notion/blob/54eca1ed27603921b08bedbbc4e792a09f7d4e7a/src/models/mistral/api/getConversation.ts#L20-L43),
[mistral-proxy](https://github.com/lordmacu/mistral-proxy/blob/658fdd38015a21d52fdd5fe4df15bb5924844ac9/api/routes/conversations.py#L18-L39),
[mikacli](https://github.com/vkop007/mikacli/blob/324874123916ca5e687531cd9b50345af68f9eac/src/platforms/llm/mistral/service.ts#L495-L560), confirmed)

| What | Procedure (GET) | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `user.session` with `{}` | `{user: {id}}`. A 401, a tRPC `UNAUTHORIZED`, or no `user.id`: signed out. | [mikacli](https://github.com/vkop007/mikacli/blob/324874123916ca5e687531cd9b50345af68f9eac/src/platforms/llm/mistral/service.ts#L311-L313), [mistral-proxy](https://github.com/lordmacu/mistral-proxy/blob/658fdd38015a21d52fdd5fe4df15bb5924844ac9/api/routes/users.py#L78-L84) | confirmed |
| List | `chat.last` with `{}`, then `{cursor}` | `{items: [{id, title, generatedTitle, userTitle, updatedAt}], nextCursor}`. The title is `userTitle`, else `generatedTitle`, else `title`. ISO times. The order is not documented, so foxcache reads the whole list each time. | [TotalRecalls](https://github.com/breakwater2026/TotalRecalls/blob/ae17f9350dd19728a1bd48e7e5731097eb03ff70/totalrecalls/adapters/mistral/adapter.py#L84-L137), [mistral-proxy](https://github.com/lordmacu/mistral-proxy/blob/658fdd38015a21d52fdd5fe4df15bb5924844ac9/api/routes/conversations.py#L42-L72) | confirmed (order: unverified) |
| One chat | `chat.byId,message.all` with `{id}`, `{chatId}` | `chat.byId`: `{id, createdAt, updatedAt, projectId}`. `message.all`: `{items: [{id, role, content, contentChunks, createdAt, model, turn, nextVersion}], nextCursor}`. | [chatgpt-to-notion types](https://github.com/L-a-r-t/chatgpt-to-notion/blob/54eca1ed27603921b08bedbbc4e792a09f7d4e7a/src/models/mistral/types/index.ts#L1-L73), [scrape](https://github.com/XBotzLauncher/scrape/blob/b37658f299b3c263ced5d89215d5c3dd3c9c531b/lib/mistral.js#L136-L153) | confirmed |
| More messages | `message.all` with `{chatId, cursor}` | Same shape. foxcache follows `nextCursor` until it is null. | [mistral-proxy](https://github.com/lordmacu/mistral-proxy/blob/658fdd38015a21d52fdd5fe4df15bb5924844ac9/api/routes/conversations.py#L75-L123) | single-source |
| Branches | (in the messages) | The visible thread keeps the messages whose `nextVersion` is null, sorted by `turn`, the user first. | [TotalRecalls](https://github.com/breakwater2026/TotalRecalls/blob/ae17f9350dd19728a1bd48e7e5731097eb03ff70/totalrecalls/adapters/mistral/adapter.py#L139-L153) | single-source |
| Message text | (in the message) | The `text` chunks of `contentChunks`, else `content`. References and tool calls are left out. | [chatgpt-to-notion functions](https://github.com/L-a-r-t/chatgpt-to-notion/blob/54eca1ed27603921b08bedbbc4e792a09f7d4e7a/src/models/mistral/functions/index.ts#L37-L61) | single-source |

## Not captured

- Attachments: messages have `files`, but no source shows its shape. foxcache
  stores no attachment metadata for Le Chat until one does.
- Projects (`project.list`), settings (`settings.get`) and agents
  (`agent.listLegacy`): the calls exist, but no source shows the answer.
  Unverified, so not read.
- Memories and libraries: no endpoint that lists them is known.
