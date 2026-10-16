# DeepSeek (chat.deepseek.com)

Adapter: `src/adapters/deepseek.ts`. Fixture: `tests/fixtures/deepseek.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md).

Auth: the page keeps a bearer token in `localStorage` under `userToken`
(`{"value": "..."}`), and its own script sends it as `Authorization: Bearer`.
foxcache's `http` reads it in the tab, keeps it, and never passes it on
(auth `localStorage-bearer`). Confirmed by
[multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/deepseek/extractor/api_client.py#L33-L64),
[ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/deepseek/plugin.ts#L85-L129)
and [deepseek-exporter](https://github.com/agoramachina/deepseek-exporter/blob/791847f92402739fa4692597f569e5ee6509688d/firefox/content.js#L20-L35).

Every answer is `{code, msg, data: {biz_code, biz_msg, biz_data}}`, and an
error can come with HTTP 200, so foxcache checks `code` and `biz_code`.
Code 40003 means the token is not valid: signed out.
([ds-free-api](https://github.com/NIyueeE/ds-free-api/blob/99f77302cebc0b32f10066f96b863f2f27752708/ds_core/raw-api-reference.md#L34-L68), confirmed)

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/api/v0/users/current` | `biz_data` with the user. | [ds-free-api](https://github.com/NIyueeE/ds-free-api/blob/99f77302cebc0b32f10066f96b863f2f27752708/ds_core/raw-api-reference.md#L126-L131), [Chat2API](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/providers/checker.ts#L181-L218) | confirmed |
| List | `/api/v0/chat_session/fetch_page?lte_cursor.pinned=false` | `{chat_sessions: [{id, title, updated_at}], has_more}`, `updated_at` in epoch seconds, newest first. The next page adds `lte_cursor.updated_at` and `lte_cursor.id` of the last row. | [deepseek-exporter](https://github.com/agoramachina/deepseek-exporter/blob/791847f92402739fa4692597f569e5ee6509688d/firefox/content.js#L67-L97), [ds-free-api](https://github.com/NIyueeE/ds-free-api/blob/99f77302cebc0b32f10066f96b863f2f27752708/ds_core/raw-api-reference.md#L134-L167) | confirmed (the `updated_at` plus `id` cursor: single-source) |
| Pinned chats | `/api/v0/chat_session/fetch_page?lte_cursor.pinned=true` | Same shape. foxcache reads it first. | [multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/deepseek/extractor/api_client.py#L79-L136) | single-source |
| One chat | `/api/v0/chat/history_messages?chat_session_id={id}` | `{chat_session: {id, title, current_message_id, inserted_at, updated_at}, chat_messages: [{message_id, parent_id, role: USER\|ASSISTANT, inserted_at, files[], fragments[]}]}`. foxcache walks from `current_message_id` up `parent_id`. | [pinguarmy fixture](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/tests/fixtures/providers/deepseek/2026-08-24-normal.json), [chatgpt-to-notion types](https://github.com/L-a-r-t/chatgpt-to-notion/blob/54eca1ed27603921b08bedbbc4e792a09f7d4e7a/src/models/deepseek/types/index.ts#L1-L76), [branch walk](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/deepseek/_parser_helpers.py#L10-L60) | confirmed (branch walk: single-source) |
| Message text | (in the chat) | Current shape: `fragments[]` of type `REQUEST` and `RESPONSE`; `THINK`, `TOOL_SEARCH`, `TOOL_OPEN` and `TIP` are left out. Older shape: a flat `content`. | [pinguarmy fixture](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/tests/fixtures/providers/deepseek/2026-08-24-normal.json), [multi-ai tests](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/tests/platforms/deepseek/test_parser.py#L36-L98) | confirmed |
| Attachments | (in the message) | `files[]`: `id`, `file_name`, `file_size`. | [multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/deepseek/extractor/asset_downloader.py#L1-L90) | single-source |

## Not captured

- Projects, memories and custom instructions: no source shows an endpoint.
- Whether the bearer is needed at all is unverified: one fixture was taken
  with cookies only. foxcache sends it, as the page does.
- Rate limits: none documented.
