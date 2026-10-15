# GitHub Copilot Chat (github.com/copilot)

Adapter: `src/adapters/github-copilot.ts`. Fixture:
`tests/fixtures/github-copilot.json` (synthetic). Researched 2026-10-15.
Confidence levels as in [claude.md](claude.md).

The page is github.com; the chat API is another site,
`https://api.individual.githubcopilot.com`, and the page's own script calls
it with CORS ([ZiuChen userscript](https://github.com/ZiuChen/userscript/blob/b94faaae83704e8bb928c291af97a487d2b85007/src/userscript/github-copilot-enhanced/index.user.js#L193)
hooks the page's own `GET /github/chat/threads`). foxcache reads it from the
github.com tab as the page does ([../cors.md](../cors.md)). GitHub keeps
threads about 30 days
([discussion #156605](https://github.com/orgs/community/discussions/156605)).

Auth: the page caches a chat token in `localStorage` under
`COPILOT_AUTH_TOKEN` as `{value, expiration}` and sends it as
`Authorization: GitHub-Bearer <value>` (auth `localStorage-bearer`, scheme
`GitHub-Bearer`). foxcache reads the cache and never mints a token.
([ZiuChen userscript](https://github.com/ZiuChen/userscript/blob/b94faaae83704e8bb928c291af97a487d2b85007/src/userscript/github-copilot-enhanced/index.user.js#L26),
[gh-copilot-remove-chats](https://github.com/fakeivchenko/gh-copilot-remove-chats/blob/d531ca5c7c6f42046027716a49810b3218343933/src/main.go#L51-L58),
[gpt4free](https://github.com/xtekky/gpt4free/blob/74661d164023bb3d4830fe51aa6e76749c781bc2/g4f/Provider/needs_auth/GithubCopilot.py#L118-L126), confirmed)

| What | GET path (API origin) | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/github/chat/threads` | `{threads: [...]}`. No token in localStorage (Copilot not opened yet, or no Copilot), a 401 or a 403: signed out. | [ZiuChen userscript](https://github.com/ZiuChen/userscript/blob/b94faaae83704e8bb928c291af97a487d2b85007/src/userscript/github-copilot-enhanced/index.user.js#L26) | single-source |
| List | `/github/chat/threads` | `{threads: [{id, name, createdAt, updatedAt}]}`. One call answers every thread; no paging is seen. ISO times. | [gh-copilot-remove-chats types](https://github.com/fakeivchenko/gh-copilot-remove-chats/blob/d531ca5c7c6f42046027716a49810b3218343933/src/types.go#L1-L17), [ZiuChen userscript](https://github.com/ZiuChen/userscript/blob/b94faaae83704e8bb928c291af97a487d2b85007/src/userscript/github-copilot-enhanced/index.user.js#L26) | confirmed |
| One thread | `/github/chat/threads/{id}/messages` | `{thread: {id, name, createdAt, updatedAt}, messages: [{id, role, content, createdAt}]}`. `role` is `user` or `assistant`; `content` is the text. GitHub keeps only the latest branch. | [genai-brain-dump](https://github.com/TorstenC/genai-brain-dump/blob/9d9105a613fd147a7bf6b4e0e43c9cdea26fd017/src/core/parsers/copilot.ts#L4-L27), [ZiuChen userscript](https://github.com/ZiuChen/userscript/blob/b94faaae83704e8bb928c291af97a487d2b85007/src/userscript/github-copilot-enhanced/index.user.js#L26), [copilot-chat-downloader](https://github.com/52pizza/copilot-chat-downloader/blob/a338e4768af500c91be9f25dd3d700a283888ec0/background.js#L12-L41) | confirmed |

## Never call

- `POST /github/chat/threads`: creates a thread.
  `POST /github/chat/threads/{id}/messages`: sends a message, on the same
  path as the thread read.
  ([gpt4free](https://github.com/xtekky/gpt4free/blob/74661d164023bb3d4830fe51aa6e76749c781bc2/g4f/Provider/needs_auth/GithubCopilot.py#L128-L165))
- `DELETE /github/chat/threads/{id}`: deletes a thread.
  ([gh-copilot-remove-chats](https://github.com/fakeivchenko/gh-copilot-remove-chats/blob/d531ca5c7c6f42046027716a49810b3218343933/src/main.go#L104-L111))
- `POST https://github.com/github-copilot/chat/token`: mints a new token.
  foxcache reads the page's cached one instead.

## Not captured

- Copilot Business and Enterprise: their API hosts
  (`api.business.githubcopilot.com`, `api.enterprise.githubcopilot.com`)
  are not read. Only the individual plan's host is.
- Spaces and personal instructions: no source shows an endpoint.
- References (files, repositories) attached to a message.

## Failure modes

| ID | Failure | What foxcache does | Test |
|---|---|---|---|
| GC1 | The thread list or a thread changed shape, or a role is new. | `provider-schema`, naming the field. | `tests/github-copilot.test.ts` |
| GC2 | No token: Copilot was never opened in this browser, or the user has no Copilot. The token expired: the API answers 401. | `detect` is false. The user opens github.com/copilot, which caches a fresh token. | `tests/github-copilot.test.ts` |
| GC3 | The API answers 429. | `rate-limited` passes to the runner (C3). | `tests/github-copilot.test.ts` |
| GC4 | The list answers the same thread twice. | The runner stores one record (ST1). The list has no cursor, so it cannot loop. | `tests/github-copilot.test.ts` |
| GC5 | A thread has more messages than foxcache keeps. | `too-large` (S4). | `tests/github-copilot.test.ts` |
| GC6 | The token leaks into a record or an error. | It stays in the auth closure (H5). | `tests/github-copilot.test.ts` |
| GC7 | A message holds HTML or a script. | It is kept as text (S3). | `tests/github-copilot.test.ts` |
