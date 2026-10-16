# HuggingChat (huggingface.co/chat)

Adapter: `src/adapters/huggingchat.ts`. Fixture:
`tests/fixtures/huggingchat.json` (synthetic). Researched 2026-10-15.
Confidence levels as in [claude.md](claude.md). The reads in the adapter
list these GET paths and nothing else.

HuggingChat is the open-source [chat-ui](https://github.com/huggingface/chat-ui/tree/48b52b1a91e7fca03f99015857e526d5ac3ef16b),
so every row below comes from its server code at that commit. It lives on
`https://huggingface.co` under the base path `/chat`
([prod.yaml L57](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/chart/env/prod.yaml#L50-L57)),
so foxcache asks for access to all of huggingface.co: a host permission
cannot be narrower than an origin.

Auth: the session cookies alone (auth `cookie`; `hf-chat`, coupled to the huggingface.co
`token` cookie in prod). No bearer, and no CSRF token on a GET
([handle.ts](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/server/hooks/handle.ts#L135-L158)).
Every `/api/v2` answer is superjson, `{json, meta}`
([superjsonResponse.ts](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/server/api/utils/superjsonResponse.ts#L1-L15));
foxcache reads `json`, where dates are ISO strings. gpt4free reads it the
same way ([HuggingChat.py](https://github.com/xtekky/gpt4free/blob/74661d164023bb3d4830fe51aa6e76749c781bc2/g4f/Provider/needs_auth/hf/HuggingChat.py#L218-L230)).

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/chat/api/v2/user` | `json: {id, username, ...}`, or `json: null` when signed out. | [v2/user](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/api/v2/user/+server.ts#L4-L17) | confirmed (source code) |
| List | `/chat/api/v2/conversations?p=N` | `json: {conversations: [{id, title, updatedAt, model}], hasMore}`, `p` from 0, 30 per page, newest first. | [v2/conversations L13-44](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/api/v2/conversations/+server.ts#L13-L44), [pagination.ts](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/constants/pagination.ts#L1) | confirmed (source code) |
| One chat | `/chat/api/v2/conversations/{id}` | `json: {id, title, model, updatedAt, messages: [{id, from: user\|assistant\|system, content, createdAt, files, ancestors, children}]}`. There is no creation time; foxcache uses the first message's. | [v2/conversations/[id] L17-65](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/api/v2/conversations/%5Bid%5D/+server.ts#L17-L65), [Message.ts](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/types/Message.ts#L8-L53) | confirmed (source code) |
| Thread | (in the chat) | The messages form a tree. foxcache shows what the page shows on a fresh load: the last message, its `ancestors` before it, and the last of `children` down from it. The empty system message at the root of a converted chat is left out; a system prompt with text is kept. `reasoning` is left out. | [createMessagesPath](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/conversation/%5Bid%5D/%2Bpage.svelte#L133-L175), [convertLegacyConversation](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/utils/tree/convertLegacyConversation.ts) | confirmed (source code) |
| Attachments | (in the message) | `files[]`: `name` and `mime`. `value` (base64 data or a storage hash) is left out. | [Message.ts MessageFile](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/types/Message.ts#L8-L53) | confirmed (source code) |

The id must be a 24-digit hex ObjectId: chat-ui reads a 7-character id as a
shared link ([resolveConversation.ts L22](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/lib/server/api/utils/resolveConversation.ts#L22)),
so foxcache refuses any other id before a request.

## Never call

Neither is one of the reads, so `http` refuses both before any request.

- `DELETE /chat/api/v2/conversations` deletes every chat
  ([L46](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/api/v2/conversations/+server.ts#L46-L62)).
- `GET /chat/api/v2/user/settings` holds the custom system prompts, but the
  GET writes `activeModel` back when the stored one is not listed
  ([settings L16-32](https://github.com/huggingface/chat-ui/blob/48b52b1a91e7fca03f99015857e526d5ac3ef16b/src/routes/api/v2/user/settings/+server.ts#L12-L64)).
  So custom prompts are not captured.

## Not captured

- Custom prompts (above). Projects, memories and assistants: chat-ui has
  none at this commit.
- A branch the user picked in the page (kept in the page's own
  localStorage `leafId`): foxcache follows the default thread.
- Signed-out (anonymous) sessions own chats too, but detect says signed out
  for them.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| HUGGINGCHAT1 | A conversation id is not a 24-digit hex ObjectId (a 7-character share id, or one that would leave the path). | `not-allowed` before any request. | `tests/huggingchat.test.ts` |
| HUGGINGCHAT2 | An answer is not superjson (no `json` key). | `provider-schema`. | `tests/huggingchat.test.ts` |
| HUGGINGCHAT3 | The thread names a missing ancestor or child, or a child cycle. | `provider-schema` (P7). | `tests/huggingchat.test.ts` |
| HUGGINGCHAT4 | Something asks for `/chat/api/v2/user/settings`, a GET that can write. | `not-allowed` before any request (H8). | `tests/huggingchat.test.ts` |
