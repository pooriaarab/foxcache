# Kagi Assistant (assistant.kagi.com)

Adapter: `src/adapters/kagi.ts`. Fixture: `tests/fixtures/kagi.json`
(synthetic). Researched 2026-10-15. Confidence: **high** = two or more
independent sources, **medium** = one good source.

In 2026-06 Kagi moved the Assistant from `kagi.com/assistant` to its own
app at `https://assistant.kagi.com`, with a JSON API under `/api/`. The old
`kagi.com/assistant/*` stream protocol (`thread_list`, `thread_open`,
`application/vnd.kagi.stream` frames and HTML) is gone, and
`kagi.com/assistant` redirects to the new app
([marshallku/kagi api.md](https://github.com/marshallku/kagi/blob/83c2fa8243a1bea20599b14b9386c3f185545cf5/docs/api.md#L3-L35)).
foxcache reads the new API only.

Auth: the `kagi_session` cookie (HttpOnly, on `.kagi.com`), which a
same-origin fetch from the tab sends (auth `cookie`). The JSON API takes
the cookie alone, and `/api/init` answers 401 when signed out
([marshallku/kagi api.md](https://github.com/marshallku/kagi/blob/83c2fa8243a1bea20599b14b9386c3f185545cf5/docs/api.md#L37-L50),
[Microck/kagi-cli](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L3598-L3616)).
Times are ISO-8601, often with no zone; they are UTC.

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in, instructions, assistants | `/api/init` | `settings.custom_instructions` (text or null), `custom_assistants[]: {uuid, name}`. | [marshallku/kagi api.md](https://github.com/marshallku/kagi/blob/83c2fa8243a1bea20599b14b9386c3f185545cf5/docs/api.md#L99-L221), [Microck/kagi-cli](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L4925-L4930) | high |
| List | `/api/conversations?limit=100&all=true`, then `&after_id=<last uuid>` | `{items: [{conversation: {uuid, title, created_at, updated_at}, snippet, rank}], has_more}`; an item can also be the bare conversation. | [Microck/kagi-cli list](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L896-L940), [path](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L3762-L3769), [test](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L6487-L6537) | medium |
| One conversation | `/api/conversations/{uuid}/init` | `{conversation: {uuid, title, created_at, updated_at, model_name}, active_branch: {uuid}, branches[], messages: {items: [{uuid, role, content, created_at, model_name}], has_more}}`. `content` is Markdown; `thinking` is left out. The messages are those of the active branch, oldest first. | [marshallku/kagi api.md](https://github.com/marshallku/kagi/blob/83c2fa8243a1bea20599b14b9386c3f185545cf5/docs/api.md#L365-L399), [Microck/kagi-cli](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L741-L760) | high |
| Older messages | `/api/branches/{branch}/messages?limit=100&after_id=<oldest uuid read>` | `{messages: {items, has_more}}`, newest first: foxcache reverses each page and puts it before the ones it has. | [Microck/kagi-cli](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L3780-L3830), [test](https://github.com/Microck/kagi-cli/blob/cb64cf514a99e527429468f92bc9f6b633a765e4/src/api.rs#L6683-L6718) | medium |

## Never call

Writes on the paths the reads share or sit next to
([marshallku/kagi inventory](https://github.com/marshallku/kagi/blob/83c2fa8243a1bea20599b14b9386c3f185545cf5/docs/api.md#L500-L554)):
`PATCH` and `DELETE /api/conversations/{uuid}` (rename, delete),
`DELETE /api/conversations/{uuid}/permanent`, `POST
/api/conversations/{uuid}/restore`, `POST /api/conversations`,
`/api/conversations/import`, `/api/conversations/deleted/purge`,
everything under `/api/v2/` that is a `POST` or `DELETE` (send, fork,
cancel), `POST /api/branches/{branch}/share`, and the `POST`, `PATCH` and
`DELETE` sides of `/api/settings`, `/api/assistants` and `/api/folders`.
Reads are GET only and on four exact paths, so http refuses all of these.

## Not captured

- Folders and lenses: in `/api/init`, but foxcache has no record for them.
- A custom assistant's instructions: the library record keeps its name.
- Attachments and references: no source shows their fields.
- Threads that Kagi deleted: by default an unsaved thread is deleted 24
  hours after its last message, unless the account keeps threads forever.

## Failure modes

| ID | Failure | What happens | Test |
|---|---|---|---|
| KA1 | `/api/init` answers 401 or 403, or redirects to sign-in. | `detect` is false. | `tests/kagi.test.ts` |
| KA2 | The list, a conversation or a message changed shape, or a role is new. | `provider-schema` names the field. | `tests/kagi.test.ts` |
| KA3 | The list gives the same page again. | The capture's `pagination-loop` (C4). | `tests/kagi.test.ts` |
| KA4 | The older-message pages never end, or give the same page again. | `pagination-loop`, not a thread with a hole (P9). | `tests/kagi.test.ts` |
| KA5 | A conversation has more messages than foxcache keeps. | `too-large` while it reads (S4). | `tests/kagi.test.ts` |
| KA6 | Kagi answers 429. | `rate-limited` passes on, so the capture waits (C3). | `tests/kagi.test.ts` |
| KA7 | A message or title holds HTML or a script. | It stays text; `html_content` is never read. | `tests/kagi.test.ts` |
