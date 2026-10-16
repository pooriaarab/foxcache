# Z.ai (chat.z.ai)

Adapter: `src/adapters/zai.ts`, on the shared open-webui parts in
`src/adapters/openwebui.ts`. Fixture: `tests/fixtures/zai.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md). The reads in the adapter list these GET paths
and nothing else.

Z.ai runs open-webui with the upstream `/api/v1` paths and bare answers (no
envelope). Upstream links below are at open-webui
[6a18585](https://github.com/open-webui/open-webui/tree/6a18585ff4c2e5f6805f682222cfbc46dc669ef8).
The "Z.ai Chat Exporter" 1.0.0 add-on on AMO
(https://addons.mozilla.org/firefox/addon/z-ai-chat-exporter/, XPI sha256
`ca75e05517ef7e3a49dfb276c3157710428577e4f508492a24247ef14d8cefc5`) is the
one source that reads the live site; it is not on GitHub.

Auth: the page keeps a bearer in `localStorage` under `token` (a plain
string) and sends it as `Authorization: Bearer`. foxcache's `http` reads it
in the tab and never passes it on (auth `localStorage-bearer`, key `token`).
Confirmed by [Chat2API](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/oauth/tokenExtractionConfig.ts#L97-L112)
and the AMO add-on's `content.js`. Upstream takes the bearer or the `token`
cookie ([auth.py](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/utils/auth.py#L393-L411)).
A visitor gets a guest token too
([GLM-Free-API zai.go](https://github.com/izaart95-jpg/GLM-Free-API/blob/3161e76791f31260474105d9d882c78481a38b64/internal/zbridge/zai.go#L185-L240)),
so a token alone does not mean signed in.

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/api/v1/auths/` | `{id, email, name, role}`. A 401 means signed out; `role: "guest"` is treated as signed out. | [upstream auths.py L173](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/auths.py#L173-L230), [GLM-Free-API zai.go L201-215](https://github.com/izaart95-jpg/GLM-Free-API/blob/3161e76791f31260474105d9d882c78481a38b64/internal/zbridge/zai.go#L201-L215), [gpt4free glm L262](https://github.com/xtekky/gpt4free/blob/74661d164023bb3d4830fe51aa6e76749c781bc2/g4f/Provider/glm/__init__.py#L262) | confirmed (path); the guest rule is inferred |
| List | `/api/v1/chats/?page=N&type=default&include_pinned=true&include_folders=true` | A bare list `[{id, title, updated_at, created_at}]`, 60 per page from 1, newest first; an empty page ends it. Upstream leaves pinned and folder chats out unless asked, so foxcache asks. | AMO add-on `popup.js` (`/chats/?page=` and `&type=`), [upstream chats.py L293-332](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/chats.py#L293-L332) | confirmed (path and `type`); `include_pinned` and `include_folders` are upstream's, not seen on Z.ai |
| Archived | `/api/v1/chats/archived?page=N` | The list's bare row shape, 60 per page from 1; an empty page ends it. Upstream leaves archived chats out of the main list (`archived=False`), so foxcache reads this list after it (ZAI40). | [upstream chats.py L1122](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/chats.py#L1122-L1155) | inferred (upstream only) |
| One chat | `/api/v1/chats/{id}` | `{id, title, created_at, updated_at, chat: {history: {currentId, messages: {id: {parentId, role, content, timestamp, files}}}}}`, times in epoch seconds. foxcache walks from `currentId` up `parentId`. | AMO add-on `select.js` (`chat.history.messages`), [upstream chats.py L1409](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/chats.py#L1409-L1425), [ChatResponse](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/models/chats.py#L277-L293) | confirmed |
| Message text | (in the chat) | `content`. A `<details type="reasoning">` block, where open-webui keeps a model's thinking, is left out. | [upstream utils L2382](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/src/lib/utils/index.ts#L2382) | inferred (upstream; not seen on Z.ai) |
| Attachments | (in the message) | `files[]`: `name`, `id`, `size`. The URL and `file.data` (extracted text) are left out. | upstream file objects | inferred |
| Custom instructions | `/api/v1/users/user/settings` | `{ui: {system}}`, or `null` when never saved. | [upstream users.py L459](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/users.py#L459-L475), [UserSettings](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/models/users.py#L136-L139), [General.svelte L80](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/src/lib/components/chat/Settings/General.svelte#L80), [Chat2API zai L61](https://github.com/xiaoY233/Chat2API/blob/59f03ab2988867a4d7bacb97d98f3ee018b0e4d0/src/main/providers/builtin/zai.ts#L61) | single-source (path on Z.ai); the shape is upstream's |

## Never call

Every read is a GET, so `http` cannot send these.

- `DELETE /api/v1/chats/` deletes every chat
  ([upstream chats.py L752](https://github.com/open-webui/open-webui/blob/6a18585ff4c2e5f6805f682222cfbc46dc669ef8/backend/open_webui/routers/chats.py#L752)).
- `POST /api/v1/auths/guest` makes a guest session.
- `POST /api/v1/chats/{id}/messages/batch`: the AMO add-on uses it to fill
  in message stubs in the history map (single source). It is not one of
  the reads, so a message with no `content` throws `provider-schema` and
  the chat is counted as an error, not stored with a hole.

## Not captured

- Memories (`/api/v1/memories/`) and folders (`/api/v1/folders/`): upstream
  routes only, not seen on Z.ai.
- Rate limits: none documented. The `X-Signature` and captcha apply to
  completions only.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| ZAI1 | The token in localStorage is a guest's (`role: "guest"`). | `detect` is false: signed out. | `tests/zai.test.ts` |
| ZAI2 | A message in the history map is a stub with no `content`. | The chat fails with `provider-schema` and counts as an error. | `tests/zai.test.ts` |
| ZAI3 | A chat id is empty, or would leave `/api/v1/chats/{id}`. | `not-allowed` before any request (H10). | `tests/zai.test.ts` |
| ZAI40 | A chat is archived. Upstream filters the main list to `archived=False`, so it never shows there. | The list reads the archived list after the main one, page by page to an empty page, each with the main list's row shape. The two lists are each newest first but not as one, so `newestFirst` is false and a capture never stops early between them. Not checked with a real login: the route is upstream's. | `tests/zai.test.ts`, E2E |
