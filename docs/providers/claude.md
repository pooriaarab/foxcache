# Claude (claude.ai)

Adapter: `src/adapters/claude.ts`. Fixture: `tests/fixtures/claude.json`
(synthetic). Auth: the page's cookies only (`sessionKey`). No header, no
token. Researched 2026-10-15.

Confidence: **confirmed** means two or more open-source exporters agree, or
one well-kept exporter with recent commits. **single-source** means one
exporter. **unverified** means we found no source.

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in, organization | `/api/organizations` | Array of `{uuid, capabilities[]}`. foxcache uses the one whose `capabilities` has `chat`. 401 or 403: signed out. | [agentsview](https://github.com/kenn-io/agentsview/blob/e989152895065fc1c84784662b61fb3a69c7eeba/internal/importer/claude_ai_sync.go#L86-L101), [claude-exporter](https://github.com/agoramachina/claude-exporter/blob/d7cc384fbaefd1c020e74392512b8cfb3292c7b9/chrome/content.js#L126-L143) | confirmed |
| Signed-out status | (any) | 401 or 403 with `account_session_invalid`. Which status goes with which case is not pinned down; foxcache treats both as signed out. | [agentsview fixture](https://github.com/kenn-io/agentsview/blob/e989152895065fc1c84784662b61fb3a69c7eeba/internal/importer/testdata/claude_ai_sync/signed_out.json#L1-L12) | single-source |
| List | `/api/organizations/{org}/chat_conversations_v2?limit=50&offset=N&consistency=strong` | `{data: [{uuid, name, updated_at}], has_more}`. Offset paging. Newest update first. | [agentsview](https://github.com/kenn-io/agentsview/blob/e989152895065fc1c84784662b61fb3a69c7eeba/internal/importer/claude_ai_sync.go#L102-L123), [claudisk](https://github.com/fabriziomazzei/claudisk/blob/b4065f380fb5e4fb64c6c85c97b9a7caa790fcce/src/lib/api.js#L212-L233), [claude-backup](https://github.com/twilligon/claude-backup/blob/6184ba75e6e139a5de7dd88feacf69e8bcf312df/claude_backup/__init__.py#L615-L707) | confirmed |
| One conversation | `/api/organizations/{org}/chat_conversations/{uuid}?tree=True&rendering_mode=messages&render_all_tools=true` | `{uuid, name, model, project_uuid, created_at, updated_at, current_leaf_message_uuid, chat_messages: [{uuid, parent_message_uuid, sender, created_at, text, content[], attachments[], files[], files_v2[]}]}`. `tree=True` gives every branch; foxcache walks from `current_leaf_message_uuid` to the root. | [claude-backup](https://github.com/twilligon/claude-backup/blob/6184ba75e6e139a5de7dd88feacf69e8bcf312df/claude_backup/__init__.py#L402-L408), [Claude-QoL](https://github.com/lugia19/Claude-QoL/blob/dc61e64e1314e534098ee0023e71c40c06765553/content/helpers/claude-api.js#L1285-L1313), [multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/claude-ai/discovery.md#L55-L89) | confirmed |
| Message text | (in the conversation) | The `text` blocks of `content[]`, joined. A message with no blocks uses `text`. `thinking`, `tool_use` and `tool_result` are left out. | [multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/claude-ai/discovery.md#L91-L175), [claude-exporter](https://github.com/agoramachina/claude-exporter/blob/d7cc384fbaefd1c020e74392512b8cfb3292c7b9/chrome/utils.js#L70-L92) | confirmed |
| Attachments | (in the message) | `attachments[]`: `id`, `file_name`, `file_size`. `files[]`, `files_v2[]`: `file_uuid`, `file_name`. `extracted_content` is never kept. | [multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/claude_ai/_parser_helpers.py#L146-L160), [Claude-QoL](https://github.com/lugia19/Claude-QoL/blob/dc61e64e1314e534098ee0023e71c40c06765553/content/helpers/claude-api.js#L1097-L1146) | confirmed |
| Projects | `/api/organizations/{org}/projects`, then `/projects/{uuid}` | Array of `{uuid}`; one project has `name` and `prompt_template` (the instructions). | [claude-exporter](https://github.com/agoramachina/claude-exporter/blob/d7cc384fbaefd1c020e74392512b8cfb3292c7b9/chrome/content.js#L538-L560), [Claude-QoL](https://github.com/lugia19/Claude-QoL/blob/dc61e64e1314e534098ee0023e71c40c06765553/content/helpers/claude-api.js#L1636-L1645) | confirmed |
| Project files | `/projects/{uuid}/docs`, `/projects/{uuid}/files` | `docs`: `{uuid, file_name}` (the `content` is not kept). `files`: `{file_uuid, file_name}`. | [Claude-QoL](https://github.com/lugia19/Claude-QoL/blob/dc61e64e1314e534098ee0023e71c40c06765553/content/helpers/claude-api.js#L1647-L1694) | confirmed |
| Memory | `/api/organizations/{org}/memory` | `{memory: "<markdown>"}`. foxcache keeps each line that is not a heading as one memory. | [multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/claude_ai/extractor/api_client.py#L139-L147), [lm-assist](https://github.com/langmartai/lm-assist/blob/94d0d1450eef8700614e3ae25d44e1e26837c65b/core/src/utils/claudeai-session.ts#L616-L625) | confirmed |
| Preferences | `/api/account_profile` | `conversation_preferences`: the "personal preferences" text, kept as `response-style`. | [Claude-QoL](https://github.com/lugia19/Claude-QoL/blob/dc61e64e1314e534098ee0023e71c40c06765553/content/isolated/pref-switcher.js#L311-L316) | single-source |

## Not captured

- **Topic memory** (the 2026 "memory topics"): read with `POST .../melange/list`
  and `POST .../melange/read`
  ([source](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/claude_ai/extractor/api_client.py#L123-L134)).
  foxcache sends GET only, so it reads the classic memory text and not the topics.
- **Styles**: `GET .../list_styles` exists, but no source shows its answer.
  Unverified, so there is no library kind for Claude.
- Artifacts, thinking and tool calls: left out of the message text.
- Rate limits: no exporter has seen a 429 from claude.ai. foxcache's backoff
  is defensive.
