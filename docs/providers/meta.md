# Meta AI (www.meta.ai)

Adapter: `src/adapters/meta.ts`. Fixture: `tests/fixtures/meta.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md).

Source: the site's own JS, the content-hashed chunks under
`https://www.meta.ai/_next/static/immutable/chunks/` (served 2026-10-15, last-modified that day). They hold
the Relay artifacts: each persisted query's `doc_id`, its name, its
`operationKind` and the fields it selects. The fields were read from the
artifacts without running them. No request was sent to `/api/graphql`, so
the shapes are what the queries select, not captured answers. Single
source, the site's own: medium confidence throughout.

Auth: the page's cookies alone. The page's Relay network layer
(`https://www.meta.ai/_next/static/immutable/chunks/3sllsib7seige.js`) sends
`fetch("/api/graphql", {method: "POST", credentials: "include", body: JSON.stringify({doc_id, variables})})`
with `Content-Type: application/json`, and adds `Authorization: Bearer` only
for a signed-out temporary user (`tempUserAccessToken`). A 401 means signed
out. (auth `cookie`). The 2025 flow in
[hermes](https://github.com/compnew2006/MetaAI-Free-Hermes-Agent/blob/75c08940be19d86a2255298dd2ee5ec2ba494dd4/metaai-go/graphql.go#L44-L83) (an `ecto1` OAuth token and the doc_ids
`e6214ae9…`, `9f7f4e20…`) is stale: none of its read ids is in the
current bundle.

None of these queries uses `@defer` or `@stream`, so each answer is one
JSON object, `{data}`, or `{errors}` for a changed doc_id.

| What | doc_id (POST /api/graphql) | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in, list | `f9f2f515cf675e127f619401193b6992` `EctoConversationListWithPaginationRouterQuery`, query, `{}` | `data.pinnedConversations` (`conversations(first: 20, pinned: true)`) and `data.unpinnedConversations` (`first: 40, pinned: false`): `edges[].node{id, updatedAt, title, displayTitle, conversationId, lastSendMessageTimestampMs, pinned}`, `pageInfo{endCursor, hasNextPage}`. The chat link is `/prompt/<node.id>` (`2an1zazfutdvz.js`). `updatedAt` is text the page reads with `Date.parse`. | [21xl7171h-_0s.js](https://www.meta.ai/_next/static/immutable/chunks/21xl7171h-_0s.js) | medium |
| More pinned | `28e9d6b1d7fe4b32a62f622dbd33ddc3` `EctoPinnedConversationsRouterRefetchQuery`, query, `{pinnedAfter, pinnedFirst: 20}` | `data.pinnedConversations`, the same connection. | [1k4fkow1u-kuz.js](https://www.meta.ai/_next/static/immutable/chunks/1k4fkow1u-kuz.js) | medium |
| More unpinned | `4d89d5db4e7318d2437d24b406f69199` `EctoUnpinnedConversationsRouterRefetchQuery`, query, `{unpinnedAfter, unpinnedFirst: 40}` | `data.unpinnedConversations`, the same connection. | [21xl7171h-_0s.js](https://www.meta.ai/_next/static/immutable/chunks/21xl7171h-_0s.js) | medium |
| One chat | `a40d4674ba65ae2760857ff01494762d` `EctoMergedMessageListPaginationQuery`, query, `{conversationId, before, last: 10}` (`before: null` first) | `data.conversation{id, latestBranchPath, messages{edges[]{cursor, node{id, __typename (UserMessage or AssistantMessage), turnId, branchPath, content, createdAt}}, pageInfo{hasPreviousPage, startCursor}}}`. foxcache pages back by `before: startCursor`. `AssistantMessage.content` is the text the page's Copy button copies (`3ozskn5i1ljag.js`: `useAssistantMessageContext().content`); the rendered answer (`contentRenderer`, about 40 primitive kinds) is not read. | [1co5ovyqc5vs_.js](https://www.meta.ai/_next/static/immutable/chunks/1co5ovyqc5vs_.js) | medium |

The page opens a chat with `EctoMergedMessageListPreloadQuery`
(`ed0a6600311ebed4c626788ebbda138b`, `{conversationId}`, `messages(last: 10)`),
the same selection without `before`. foxcache uses the pagination query for
every page, so it lists one read for messages, not two.

## Never call

Every write is a POST to the same `/api/graphql`, and the bundle labels 77
operations `mutation`. foxcache lists the four doc_ids above and `http`
refuses every other. Among the writes: `useEctoDeleteConversationMutation`
`ad35bda8475e29ba4264ef0d6cc0958a`, `useEctoRenameConversationMutation`
`2775bdbd0886fb2056fae9c68d323368`, `useEctoPinConversationMutation`
`ee1968033ea19d57f428774cf65b0b5d`, `useMarkConversationLastSeenMessageMutation`
`0b2cb3a499606dfe326807a2b8b7ee20` (it marks a chat as read),
`useConversationWarmupMutation` `e7f802582dbfed8e181b012e010993eb` and
`useTriggerHeisenbergCheckMutation` `954e9b193487fa4af750af87906e4313`
(it rotates the session cookie).

## Not captured

- Branches: an edited prompt makes a new `branchPath`. foxcache keeps every
  message the query gives, in its order, and does not pick the branch the
  page shows (`latestBranchPath`): its rules are not documented.
- The rendered answer: images, videos, code blocks, tables and widgets in
  `contentRenderer`. foxcache keeps `content`, which is empty for an
  answer that is only media.
- Attachments, media library, memory and settings: not read.
- Live check: no read here has been sent from a signed-in tab. The owner
  should run the live smoke check (`e2e/live-smoke.mjs`) before release.

## Failure modes

| ID | Failure | What foxcache does | Test |
|---|---|---|---|
| ME1 | A deploy changed a doc_id: the answer is `{errors}` with no data. | `provider-schema` naming the query, without the site's error text. | `tests/meta.test.ts` |
| ME2 | More than 20 pinned chats, or more than 40 unpinned. | The list goes on with the pinned, then the unpinned refetch query; the cursor holds both end cursors. A repeated cursor ends in `pagination-loop` (C4). | `tests/meta.test.ts` |
| ME3 | A message of another type (`__typename` not `UserMessage` or `AssistantMessage`). | `provider-schema` naming the message. | `tests/meta.test.ts` |
| ME4 | An answer with no text (only an image). | The message is kept with empty text. | `tests/meta.test.ts` |
| ME5 | The message pages give a `startCursor` they gave before. | `provider-schema` (a loop); `pagination-loop` after 1 000 pages; `too-large` past 20 000 messages. | `tests/meta.test.ts` |
