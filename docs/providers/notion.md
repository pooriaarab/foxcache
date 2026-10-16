# Notion AI (app.notion.com)

Adapter: `src/adapters/notion.ts`. Fixture: `tests/fixtures/notion.json`
(synthetic). Researched 2026-10-15. Confidence: **high** = two or more
independent sources, **medium** = one good source.

Auth: the session cookie `token_v2` (HttpOnly), which a same-origin fetch
from the tab sends (auth `cookie`). Every read is a JSON `POST` under
`/api/v3/`. The page also sends `x-notion-active-user-header` and
`x-notion-space-id`. Both are optional: the active-user header picks one of
several signed-in accounts, and clients that run in a Notion tab or with
the cookie alone call `/api/v3` without them
([cmux notion.js](https://github.com/manaflow-ai/cmux/blob/b09cbe7279e48ab24b0ffedc84f26073ac5651d4/Resources/browser-repl/sites/notion.js#L11-L24),
[notion-py](https://github.com/jamalex/notion-py/blob/f31081edef26882298eb0c31cf023e810a2a9a09/notion/client.py#L124-L144),
[react-notion-x](https://github.com/NotionX/react-notion-x/blob/03c5e88ecd2fee40cf1dea35d082397c0b296619/packages/notion-client/src/notion-api.ts#L860-L867)).
foxcache sends neither, so it reads the account Notion treats as active.

The origin is `https://app.notion.com`, where the web app and its session
live now; `www.notion.so` has the same API for older sessions
([connector](https://github.com/roman-prizrakjj/notion-agent-connector/blob/89a8ac1c65223cf3f98a76c805a0029998ad4f80/notion_client.py#L117-L136),
[cmux notion.js](https://github.com/manaflow-ai/cmux/blob/b09cbe7279e48ab24b0ffedc84f26073ac5651d4/Resources/browser-repl/sites/notion.js#L141-L160)).

Records come in a `recordMap`, each as `{value: {value: record, role}}` or
the older `{value: record}`. foxcache reads both.

| What | POST path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in, user, workspaces | `/api/v3/loadUserContent` body `{}` | `recordMap.notion_user` (one key per user), `recordMap.user_root[userId].space_view_pointers[].spaceId`. foxcache reads every workspace. | [notion-py](https://github.com/jamalex/notion-py/blob/f31081edef26882298eb0c31cf023e810a2a9a09/notion/client.py#L124-L133), [notion-ai-mcp](https://github.com/nmt3325/notion-ai-mcp/blob/7f2ff404059f8abb90ec2a3ef7ad6637b763cd07/src/notion-client.ts#L529-L537) | high |
| AI chat list | `/api/v3/getInferenceTranscriptsForUser` body `{threadParentPointer: {table: "space", id, spaceId}, limit: 50, includeWriterChats: false, includeWorkflowThreads: true, cursor?}` | `{transcripts: [{id, title, created_at, updated_at}], hasMore, nextCursor}`, times in epoch ms. | [agent-notion](https://github.com/shhac/agent-notion/blob/7b645eabf4596dd933cb405101e4f127cba73917/design-docs/reference/v3-ai-api.md#L227-L255), [notion-ai-mcp](https://github.com/nmt3325/notion-ai-mcp/blob/7f2ff404059f8abb90ec2a3ef7ad6637b763cd07/src/notion-client.ts#L549-L551), [connector](https://github.com/roman-prizrakjj/notion-agent-connector/blob/89a8ac1c65223cf3f98a76c805a0029998ad4f80/notion_client.py#L193-L215) | high (`nextCursor` paging: medium, notion-ai-mcp) |
| One thread | `/api/v3/syncRecordValuesSpaceInitial` body `{requests: [{pointer: {table: "thread", id, spaceId}, version: -1}], spacePointer: {table: "space", id}}` | `recordMap.thread[id]`: `messages` (the ordered `thread_message` ids), `created_time`, `updated_time` (ms), `data.title`. | [connector](https://github.com/roman-prizrakjj/notion-agent-connector/blob/89a8ac1c65223cf3f98a76c805a0029998ad4f80/notion_client.py#L217-L243), [notion-ai-mcp](https://github.com/nmt3325/notion-ai-mcp/blob/7f2ff404059f8abb90ec2a3ef7ad6637b763cd07/src/notion-client.ts#L594) (same body on `syncRecordValuesMain`) | high |
| Its messages | the same path, `table: "thread_message"`, 50 ids a request | `recordMap.thread_message[id]`: `created_time`, `step: {type, value, displayValue?, displayMessage?}`. `user` is rich text (`[[text, marks]]`), `agent-inference` a list of `{type: "text", content}`. foxcache keeps `user`, `user-injected` with a `displayMessage`, `agent-inference` text, `markdown-chat` and `fast-researcher-chat`; it leaves out `config`, `context`, tool results and thinking, as the Notion page does. | [connector visible_messages](https://github.com/roman-prizrakjj/notion-agent-connector/blob/89a8ac1c65223cf3f98a76c805a0029998ad4f80/notion_client.py#L67-L113), [notion-ai-mcp](https://github.com/nmt3325/notion-ai-mcp/blob/7f2ff404059f8abb90ec2a3ef7ad6637b763cd07/src/notion-client.ts#L342-L355) | high |

The conversation id is `<spaceId>:<threadId>`, because reading a thread
needs its workspace.

## Never call

Writes on `/api/v3/` that sit next to the reads:
`runInferenceTranscript` (sends a message), `markInferenceTranscriptSeen`,
`saveTransactions` and `saveTransactionsFanout` (edit records),
`createAgentThread`, `getCompletion`, `warmVectorDBCache` and
`warmSearchCache`
([agent-notion](https://github.com/shhac/agent-notion/blob/7b645eabf4596dd933cb405101e4f127cba73917/design-docs/reference/v3-ai-api.md#L14-L30),
[connector](https://github.com/roman-prizrakjj/notion-agent-connector/blob/89a8ac1c65223cf3f98a76c805a0029998ad4f80/notion_client.py#L273)).
The reads table lists three paths, so http refuses all of these.

## Not captured

- Legacy AI chats (`getChatTranscriptSessionHistoryForUser`): one source,
  and the step shape differs.
- AI instructions or memory: no source shows an endpoint.
- Pages, databases and other Notion content: not AI chat.
- Model names: Notion stores rotating codenames, not model names.

## Failure modes

| ID | Failure | What happens | Test |
|---|---|---|---|
| N1 | Notion answers 401 or 403, or `loadUserContent` has no user. | `detect` is false. | `tests/notion.test.ts` |
| N2 | The list, a thread or a step changed shape. | `provider-schema` names the field. | `tests/notion.test.ts` |
| N3 | The list says `hasMore` with no `nextCursor`, or gives a cursor again. | `provider-schema`, or the capture's `pagination-loop` (C4). | `tests/notion.test.ts` |
| N4 | A thread names a message that the record answer does not hold. | `provider-schema` names it; no thread with a hole is stored. | `tests/notion.test.ts` |
| N5 | A thread has more message ids than foxcache keeps. | `too-large` before any message is read (S4). | `tests/notion.test.ts` |
| N6 | The user has several workspaces. | Each one is listed in turn, and each id names its workspace. | `tests/notion.test.ts` |
| N7 | Notion answers 429. | `rate-limited` passes on, so the capture waits (C3). | `tests/notion.test.ts` |
| N8 | A message holds HTML or a script. | It stays text. | `tests/notion.test.ts` |
