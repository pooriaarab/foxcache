# Grok (grok.com): no adapter

Researched 2026-10-15. Auth is cookies only. The list
(`GET /rest/app-chat/conversations?pageSize=N&pageToken=T`) and the message
tree (`GET /rest/app-chat/conversations/{id}/response-node`) are GETs, but
the message text comes only from
`POST /rest/app-chat/conversations/{id}/load-responses` with
`{"responseIds": [...]}`:
[ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/grok-exporter/src/grok/endpoints.ts#L16-L22),
[multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/grok/extractor/api_client.py#L94-L106),
[agent-tincan](https://github.com/mvanhorn/agent-tincan/blob/98cc6ebe104933c6a49ae204c7916fd35fe23e60/extension/ops.js#L1272-L1287),
[ai-chat-exporter](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/lib/grok-api.ts#L146-L172).
Confidence: confirmed. No source has a GET for the text, and no source shows
how a signed-out session answers. No memory endpoint is known.
