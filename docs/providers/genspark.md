# Genspark (www.genspark.ai)

Adapter: `src/adapters/genspark.ts`. Fixture: `tests/fixtures/genspark.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md).

Auth: the HttpOnly `session_id` cookie, set after the sign-in. No bearer or
CSRF token is seen on reads, so foxcache sends the page's cookies only
(auth `cookie`).
([genspark-py](https://github.com/SharpWizard/genspark-py/blob/e0cb3be2c6ab5855cd5bf874e2ae35f16b568b22/src/genspark/client.py#L129-L133), confirmed)

Every chat or agent run is a "project". Every answer is
`{status, message, data}`; foxcache treats a `status` other than 0 as an
error.

**Delete is a GET** here: `/api/project/delete?project_id={id}`
([deanxv chat.go](https://github.com/deanxv/genspark2api/blob/99b038b5f3fa9f64c6d1babc3e659ccb87be17ec/controller/chat.go#L30),
[gs-docs](https://github.com/arosyihuddin/genspark-api/blob/d866ef003c87c7d32f5ada899bc9931daaf5521b/docs/GENSPARK_API_DOCS.md#L135)).
So the adapter's reads are three exact paths, and `http` throws
`not-allowed` for any other path before a request (H8).
`tests/genspark.test.ts` checks the reads and runs a full capture to show
no other path is called.

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/api/is_login` | `data.is_login` (true or false). | [gs_export.py](https://github.com/fengye102/genspark2api/blob/5ce5882b144f65e85fb35fa646407268a51cb418/gs_export.py#L49-L56), [genspark-py](https://github.com/SharpWizard/genspark-py/blob/e0cb3be2c6ab5855cd5bf874e2ae35f16b568b22/src/genspark/client.py#L129-L133), [kaecho](https://github.com/kaecho/genspark2api/blob/8673b8a7e25af2c095f836a783e73e179fbc83e6/genspark2api.py#L61) | confirmed |
| List | `/api/project/my?from=agents&offset={n}&limit=50` | `data.projects: [{id, name, type, chat_model, ctime}]`, `ctime` ISO-8601 with no zone (UTC). The list ends at a page shorter than 50. | [gs-docs](https://github.com/arosyihuddin/genspark-api/blob/d866ef003c87c7d32f5ada899bc9931daaf5521b/docs/GENSPARK_API_DOCS.md#L94-L125), [gs-test scraper.ts](https://github.com/DSciAILab/genspark_test/blob/19ef366b3641d7e6303a48911a6a630d1afe9ca8/src/scraper.ts#L88-L113) | path: confirmed; `offset`/`limit`: single-source |
| One project | `/api/project?id={id}` | `data: {id, name, ctime, type, chat_model, session_state: {messages: [{id, role: user\|assistant\|tool\|system, content: string\|null}]}}`. foxcache keeps user and assistant text, in order. | [gs-test scraper.ts](https://github.com/DSciAILab/genspark_test/blob/19ef366b3641d7e6303a48911a6a630d1afe9ca8/src/scraper.ts#L125-L135), [types](https://github.com/DSciAILab/genspark_test/blob/19ef366b3641d7e6303a48911a6a630d1afe9ca8/src/scraper.ts#L23-L49) | single-source |

## Never call

- `GET /api/project/delete?project_id={id}` deletes a project (above). It
  is not one of the reads, and no read is under `/api/project/` but `my`.

## Not captured

- Projects (in the foxcache sense), memories and custom instructions: no
  source shows an endpoint. `/api/user` and `/api/models_config` exist but
  hold no user content.
- Non-chat projects (slides, docs) are kept as conversations; one with no
  `session_state` has no messages.
- An update time: the list gives `ctime` only, so a chat continued after a
  capture is not read again by a later capture. Check this with a real
  account: if the list has an update field, use it.
- Rate limits: none documented. The site is behind Cloudflare; same-origin
  reads from the signed-in tab are not challenged.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| GENSPARK1 | A path built from a project id, or a changed adapter, calls the delete GET or any other path. | `not-allowed` before any request (H8). A project id goes in the query, never in the path. | `tests/genspark.test.ts`, E2E |
| GENSPARK2 | An answer has a `status` other than 0. | `provider-error` with the status. | `tests/genspark.test.ts` |
| GENSPARK3 | The site ignores `offset` and repeats a full page. | The capture ends with `pagination-loop` (C4). | `tests/genspark.test.ts` |
| GENSPARK40 | An answer with a `status` other than 0 carries a `message`, which may echo back site text (a prompt, a project name, a token). | `provider-error` names the path and a numeric status only, never the message, so the text stays out of the checkpoint and the popup. | `tests/genspark.test.ts` |
