# Perplexity (www.perplexity.ai)

Adapter: `src/adapters/perplexity.ts`. Fixture:
`tests/fixtures/perplexity.json` (synthetic). Researched 2026-10-15.
Confidence levels as in [claude.md](claude.md).

Auth: the page's cookies only (the NextAuth session cookie). No header, no
token. Every `/rest/` call carries `version=2.18&source=default`, the
client version the page sends; it may move.
([multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py#L1-L48),
[Deplexity](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/threads.go#L12-L15), confirmed)

| What | Method and path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | GET `/api/auth/session?version=2.18&source=default` | `{user: {id, email}}`. A 401, a 403, or a user with no `id` and no `email` (a half-valid session answers 200): signed out. | [Deplexity](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/user.go#L28-L53) | single-source |
| Pinned threads | POST `/rest/thread/list_pinned_ask_threads?version=2.18&source=default` with `{}` | The list's item shape. foxcache reads it first, as they may be missing from the list. | [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py#L62-L70) | single-source |
| List | POST `/rest/thread/list_ask_threads?version=2.18&source=default` with `{limit: 50, ascending: false, offset, search_term: "", exclude_asi: false}` | An array of `{uuid, title, last_query_datetime}`, times with no zone (UTC). The next offset adds the page length; a page shorter than `limit` is the last. It only reads, with a search filter. | [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py#L50-L60), [Deplexity](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/threads.go#L29-L100), [perplexity-web-mcp](https://github.com/jacob-bd/perplexity-web-mcp/blob/e34b5082d6c16283358d8a1e3cbd7fa61c35fc0d/src/perplexity_web_mcp/core.py#L204-L231) | confirmed |
| One thread | GET `/rest/thread/{uuid}?with_schematized_response=true&version=2.18&source=default&limit=100&offset=0&from_first=true`, then `&cursor=` | `{entries: [{uuid, query_str, display_model, entry_created_datetime, thread_title, blocks}], has_next_page, next_cursor}`. foxcache passes `next_cursor` back until `has_next_page` is false, and drops an entry a page boundary repeats. | [Deplexity](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/threads.go#L104-L116), [types](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/types.go#L162-L201), [paging](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/threads.go#L192-L250), [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py#L279-L284) | confirmed |
| Message text | (in the entry) | The question is `query_str`. The answer is `markdown_block.answer` of the block whose `intended_usage` is `ask_text_0_markdown`, else `ask_text`. An entry with neither has no answer message. The title is the first entry's `thread_title`. | [Deplexity](https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api/threads.go#L119-L143), [multi-ai parser](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/parser.py#L259-L267) | confirmed |
| Memories | POST `/rest/perplexity_ask/graphql` with `operationName: "KnowledgeContextKnowledgeRelayQuery"` and the persisted query hash `2884580667...afcc50` | `data.viewer.knowledgeContext.scopeByKind.memoryCategories[].items` = `{status: "OK", edges: [{node: {id, displayValue}}], pageInfo: {hasNextPage, endCursor}}`. The next page sends `memoriesAfter: endCursor`. A query, not a mutation. | [multi-ai](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py#L126-L145), [page reader](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/account_memory.py#L22-L61), [state.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/perplexity/state.md#L98-L114) | single-source |

The persisted query hash changes when Perplexity deploys a new query. It is
one constant at the top of the adapter; a hash the server no longer knows
answers GraphQL `errors`, and foxcache fails with `provider-schema`.

## Never call

- `DELETE /rest/thread/delete_thread_by_entry_uuid`: deletes a thread. Its
  path fits the `/rest/thread/{uuid}` read, but it deletes only by `DELETE`,
  which `http` never sends.
  ([OptiSearch](https://github.com/Dj0ulo/OptiSearch/blob/82d9b953a847b807b9398c6628ebf8314c94fa65/src/chat/perplexity_session.js#L206-L212))
- `POST /rest/sse/perplexity_ask`: asks a question.
  ([perplexity-web-mcp](https://github.com/jacob-bd/perplexity-web-mcp/blob/e34b5082d6c16283358d8a1e3cbd7fa61c35fc0d/src/perplexity_web_mcp/constants.py#L20-L22))
- Any other `operationName` or hash on `/rest/perplexity_ask/graphql`: the
  read names its own, so a mutation there is refused (H9).

## Not captured

- Spaces (`/rest/collections/...`), their instructions and files, Pages,
  assets and skills: GET reads with sources, left for a later change.
- The AI profile (`/rest/user/get_user_ai_profile`): no source shows its
  fields.
- Sources and citations of an answer (`web_result_block`).

## Failure modes

| ID | Failure | What foxcache does | Test |
|---|---|---|---|
| PX1 | The list, a thread or the memory answer changed shape. | `provider-schema`, naming the field. | `tests/perplexity.test.ts` |
| PX2 | Signed out: 401, 403, or a session with no user. | `detect` is false. | `tests/perplexity.test.ts` |
| PX3 | Perplexity answers 429. | `rate-limited` passes to the runner (C3). | `tests/perplexity.test.ts` |
| PX4 | A thread's `next_cursor` or the memory `endCursor` comes again, or never ends. | `pagination-loop`, after a repeat or 1 000 pages. | `tests/perplexity.test.ts` |
| PX5 | A thread has more entries than foxcache keeps. | `too-large` while it reads, not after (S4). | `tests/perplexity.test.ts` |
| PX6 | The memory query hash is stale: the answer has GraphQL `errors`, or a category is not `OK`. | `provider-schema`. No memory is dropped as if it were deleted (C11). | `tests/perplexity.test.ts` |
| PX7 | A question or an answer holds HTML or a script. | It is kept as text (S3). | `tests/perplexity.test.ts` |
| PX40 | The memory answer has an empty `memoryCategories` list. The cited multi-ai `account_memory.py` raises on it: it is a changed or partial answer, not "no memories". | `provider-schema`, so the runner deletes no stored memory (C11). | `tests/perplexity.test.ts` |
