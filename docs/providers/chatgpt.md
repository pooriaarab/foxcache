# ChatGPT (chatgpt.com)

Adapter: `src/adapters/chatgpt.ts`. Fixture: `tests/fixtures/chatgpt.json`
(synthetic; the token in it is a placeholder). Researched 2026-10-15.
Confidence levels as in [claude.md](claude.md).

Sources, with the commit read:
`PX` [pionxzh/chatgpt-exporter](https://github.com/pionxzh/chatgpt-exporter/blob/c8bd69c36702b417aa20e2af3d35d77ea7c06d93/src/api.ts) (2026-10-15),
`GJ` [grammy-jiang/chatgpt-web-operations](https://github.com/grammy-jiang/chatgpt-web-operations/tree/d0659576f3b0eaff8acc43958a6e3e9c3effb585) (2026-10-15, with response shapes recorded from live reads),
`ML` [mrlnlms/multi-ai-session-data-extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/chatgpt/extractor/api_client.py) (2026-09-28),
`SM` [Siamsnus/GPT2Claude-Migration-Kit](https://github.com/Siamsnus/GPT2Claude-Migration-Kit/blob/857e4575ac2004e17d3e542f64a3f27c7eab77cd/src/migrate.js) (2026-04-22).

Auth: chatgpt.com's own script gets a bearer token from `GET /api/auth/session`
(cookies) and sends `Authorization: Bearer` on every `/backend-api` call.
Cookies alone are not enough. foxcache's `http` does the same in the tab,
keeps the token in a variable there, and never passes it to the extension,
the store or an export (auth `chatgpt-session`, `tests/http.test.ts` H5). A
session with no `accessToken` means signed out. (PX L18-L37, SM L285-L301,
ML L135-L160: confirmed)

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/backend-api/me` | A user object. 401 or 403: signed out. | GJ `tests/fixtures/http/me.shape.json` | single-source (well kept) |
| Main list | `/backend-api/conversations?offset=N&limit=100&order=updated&is_archived=false&hide_snorlax=true` | `{items: [{id, title, update_time (ISO)}], total}`. Offset paging; the end is `offset + limit >= total`. `hide_snorlax=true` leaves out project chats. | PX L672-L712, GJ `conversations.shape.json`, ML L259-L292, L349-L360 | confirmed |
| Archived list | the same with `is_archived=true` | Same shape. | ML L265-L275, GJ `references/endpoint-discovery.md` L125 | confirmed |
| Projects | `/backend-api/gizmos/snorlax/sidebar?owned_only=true&conversations_per_gizmo=0&limit=50` | `{items: [{gizmo: {id}}], cursor}`. Some sources nest it as `gizmo.gizmo`; foxcache reads both. | PX L624-L636, GJ `scripts/list_projects.py` L62-L95, ML L452-L486 | confirmed |
| Project chats | `/backend-api/gizmos/{g-p-id}/conversations?cursor=0&limit=50` | `{items, cursor}`. A limit over 50 answers 422. | PX L646-L657, ML L522-L538 | confirmed |
| One conversation | `/backend-api/conversation/{id}` | `{title, create_time, update_time (epoch seconds), current_node, default_model_slug, gizmo_id, mapping: {id: {parent, children, message}}}`. foxcache walks from `current_node` up `parent`. | PX L601-L622, L985-L995, GJ `conversation.shape.json` | confirmed |
| Messages | (in `mapping`) | `author.role`, `create_time`, `recipient`, `content.content_type` and `parts` or `text`, `metadata.attachments: [{id, name, mime_type, size}]`. Left out: hidden nodes, `system` and `tool` roles, assistant calls to a tool (`recipient` not `all`), and reasoning, browsing and custom-instruction content. | PX L110-L305 | confirmed |
| Project detail | `/backend-api/gizmos/{g-p-id}` | `{gizmo: {display: {name}, instructions}, files: [{file_id, name, type, size}]}`. | GJ `gizmo.shape.json`, ML L540-L558, SM L706-L715 | confirmed (file fields: single-source) |
| Memories | `/backend-api/memories?include_memory_entries=true` | `{memories: [{id, content, created_timestamp}]}`. | GJ `memories.shape.json`, ML L419-L424, SM L373-L395 | confirmed |
| Custom instructions | `/backend-api/user_system_messages` | `about_user_message` (about-me), `about_model_message` (response-style), `name_user_message` (name), `role_user_message` (occupation). | GJ `user_system_messages.shape.json`, ML L426-L431 | confirmed |
| Rate limit | (any) | 429 with `Retry-After`. Cloudflare can answer a burst with a 403 HTML page, which foxcache reads as signed out or as not JSON and stops. | PX L764-L800, GJ `scripts/chatgpt_session.py` L1055-L1095 | confirmed |

## Not captured

- **My GPTs**: `/backend-api/gizmos/discovery/mine` is called "legacy" by one
  source and answers 404 on Plus accounts in another. Unverified, so there is
  no library kind for ChatGPT.
- **Memory summary**: the text comes from `POST .../summary/stream`. foxcache
  sends GET only.
- **Team workspaces**: the page adds `Chatgpt-Account-Id` for a workspace.
  foxcache does not, so it captures the personal workspace.
- **File contents and images**: metadata only, by design.
