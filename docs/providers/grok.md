# Grok (grok.com)

Adapter: `src/adapters/grok.ts`. Fixture: `tests/fixtures/grok.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md). The Grok tab on x.com is another product with its
own history, and foxcache does not read it.

Auth: the page's cookies only. No token in localStorage, no header on reads.
([multi-ai discovery](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/grok/discovery.md#L5-L10),
[agent-tincan](https://github.com/mvanhorn/agent-tincan/blob/98cc6ebe104933c6a49ae204c7916fd35fe23e60/extension/ops.js#L937-L945), confirmed)

| What | Method and path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | GET `/rest/app-chat/conversations?pageSize=1` | `{conversations: [...]}`. A 401 or 403: signed out. A signed-out page may chat anonymously, and no source shows what the list answers then. | [agent-tincan](https://github.com/mvanhorn/agent-tincan/blob/98cc6ebe104933c6a49ae204c7916fd35fe23e60/extension/ops.js#L951-L965) | single-source |
| List | GET `/rest/app-chat/conversations?pageSize=60`, then `&pageToken=T` | `{conversations: [{conversationId, title, createTime, modifyTime}], nextPageToken}`. The list ends when `nextPageToken` is missing or empty. ISO times. The order is not documented, so foxcache reads the whole list each time. | [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/extractor/api_client.py#L55-L86), [ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/grok-exporter/src/grok/endpoints.ts#L5-L10), [schema](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/grok/discovery.md#L37-L56) | confirmed |
| One chat | GET `/rest/app-chat/conversations_v2/{id}` | `{conversation: {conversationId, title, createTime, modifyTime}}`. | [ai-chat-exporter](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/lib/grok-api.ts#L130-L145), [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/extractor/api_client.py#L88-L92) | confirmed |
| Message tree | GET `/rest/app-chat/conversations/{id}/response-node?includeThreads=true` | `{responseNodes: [{responseId, sender, parentResponseId}]}`. The root has no `parentResponseId`. | [agent-tincan](https://github.com/mvanhorn/agent-tincan/blob/98cc6ebe104933c6a49ae204c7916fd35fe23e60/extension/ops.js#L1272-L1287), [ctxport types](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/grok/types.ts#L1-L12), [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/extractor/api_client.py#L94-L97) | confirmed |
| Message text | POST `/rest/app-chat/conversations/{id}/load-responses` with `{"responseIds": [...]}` | `{responses: [{responseId, sender, createTime, message, model}]}`. `sender` is `human` or `assistant` (any case). It only reads: a bulk get by id. foxcache sends 50 ids per call. | [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/extractor/api_client.py#L99-L106), [ai-chat-exporter](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/lib/grok-api.ts#L146-L172), [ConversationExporters batches of 50](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/grok-exporter/src/grok/client.ts#L237-L244), [roles](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/parser.py#L10-L16) | confirmed |
| Branches | (in the tree) | The visible thread is the path from the newest response back through `parentResponseId` to the root. | [agent-tincan](https://github.com/mvanhorn/agent-tincan/blob/98cc6ebe104933c6a49ae204c7916fd35fe23e60/internal/history/grok.go#L246-L284) | single-source |

## Never call

These share the read paths' prefix. foxcache lists none of them, so `http`
refuses each before it is sent (H8, H9).

- `POST /rest/app-chat/conversations/new` and
  `POST /rest/app-chat/conversations/{id}/responses`: send a message.
  `POST /rest/app-chat/conversations/{id}/stop-inflight-responses`: stops
  an answer.
  ([grok2api](https://github.com/aurora-develop/grok2api/blob/aa640954ee65229f6403027d36f337bfc05f5dd7/internal/grok/endpoints.go#L15-L40))
- `DELETE /rest/app-chat/conversations/soft/{id}`: deletes a chat.
  ([Delete AI Conversation](https://github.com/xianghongai/tampermonkey-userscripts/blob/87483228e8f2e1b758eb77861ce9651c660f1488/Delete%20AI%20Conversation.user.js#L49-L54))
- `POST /rest/user-settings`: the GET reads the custom instructions, the
  POST writes them.
  ([swift-grok](https://github.com/0xSMW/swift-grok/blob/09ee2adf062b709d812a9fe68426cc89d1519eaa/Sources/GrokClient/Endpoints/GrokClient+Account.swift#L58-L61))

## Not captured

- Memories: no endpoint lists them; `/rest/user-settings` has only the
  `enableMemory` switch.
- Projects (`/rest/workspaces`), custom instructions (`/rest/user-settings`)
  and files (`/rest/assets`) are GET reads with sources, left for a later
  change so this one stays one concern.
- Attachments: responses carry `fileAttachments`, but no source shows its
  shape.

## Failure modes

| ID | Failure | What foxcache does | Test |
|---|---|---|---|
| GR1 | The list or a response changed shape. | `provider-schema`, naming the field. | `tests/grok.test.ts` |
| GR2 | Signed out: the list answers 401 or 403. | `detect` is false. | `tests/grok.test.ts` |
| GR3 | grok.com answers 429. | `rate-limited` passes to the runner (C3). | `tests/grok.test.ts` |
| GR4 | `nextPageToken` comes back as the cursor that was sent. | `pagination-loop`. | `tests/grok.test.ts` |
| GR5 | A chat has more responses than foxcache keeps. | `too-large` before any `load-responses` call. | `tests/grok.test.ts` |
| GR6 | A node of the tree has no body in `load-responses`, names a parent that is not in the tree, or the tree has a cycle. | `provider-schema`. foxcache does not store a thread with a gap (P7). | `tests/grok.test.ts` |
| GR7 | A message holds HTML or a script. | It is kept as text (S3). | `tests/grok.test.ts` |
| GR40 | A list page has no conversations but a `nextPageToken`. ConversationExporters, cited above, keeps paging past such a page (`EMPTY_INVENTORY_PAGE`). | The list follows the token; only a missing or empty token ends it. A token that repeats still ends in `pagination-loop` (GR4, C4). | `tests/grok.test.ts` |
