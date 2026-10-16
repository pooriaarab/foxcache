# ChatGPT Codex tasks (chatgpt.com/codex)

Code: `src/adapters/codex.ts`, called by the ChatGPT adapter
(`src/adapters/chatgpt.ts`). Fixture: the `wham` routes in
`tests/fixtures/chatgpt.json` (synthetic). Researched 2026-10-15.
Confidence levels as in [claude.md](claude.md).

Codex cloud tasks live on chatgpt.com and use the same bearer token as the
rest of `/backend-api/` (auth `page-session`, see [chatgpt.md](chatgpt.md)).
So they are not a provider of their own: the ChatGPT list reads them after
the project chats, and each task is stored as a `chatgpt` conversation
whose id starts with `task_`. The two reads are in `CODEX_READS`, which
the ChatGPT adapter adds to its own.

The Codex CLI also sends `ChatGPT-Account-Id`
([client.rs](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/src/client.rs#L269-L290)).
foxcache does not: the value is per account, and no auth kind reads it
yet. A personal account should not need it; a Team or Enterprise
workspace may. Unverified.

| What | GET path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Task list | `/backend-api/wham/tasks/list?limit=20&task_filter=current&cursor={c}` | `{items: [{id, title, created_at, updated_at}], cursor}`, times in epoch seconds. The list ends with no cursor. A task with no `updated_at` has its `created_at`. | [client.rs](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/src/client.rs#L440-L490), [paginated model](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/codex-backend-openapi-models/src/models/paginated_list_task_list_item_.rs#L16-L21), [task_filter=current](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/cloud-tasks-client/src/http.rs#L160-L195) | confirmed (one repo, the official client) |
| One task | `/backend-api/wham/tasks/{taskId}` | `{task: {id, title, created_at}, current_user_turn, current_assistant_turn, current_diff_task_turn}`. A turn has `input_items` or `output_items` of `{type, role, content}`; foxcache keeps `type: "message"` items, and in `content` plain strings and `{content_type: "text", text}`. Assistant `worklog.messages` with `author.role: "assistant"` are part of the reply. | [client.rs](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/src/client.rs#L492-L508), [types.rs](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/src/types.rs#L225-L520), [fixture](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/tests/fixtures/task_details_with_diff.json) | confirmed (one repo) |
| No Codex | (the list) | A 403 or 404 on the list means the account has no Codex: no tasks, and the ChatGPT capture goes on. | none: chosen so an account without Codex still captures | assumption |

## Never call

Every Codex read is a GET, so `http` cannot send these.

- `POST /backend-api/wham/tasks` creates a task
  ([client.rs](https://github.com/openai/codex/blob/1ef30bcbe784f1006548adc1542985be32b05109/codex-rs/backend-client/src/client.rs#L582-L605)).

## Not captured

- Earlier turns of a task with follow-ups: the task answer has the current
  turns only. `/backend-api/wham/tasks/{id}/turns/{turnId}/sibling_turns`
  lists other attempts of a turn, not earlier turns.
- Diffs and pull requests: code, not chat text.
- Archived tasks: no source names another `task_filter` value.
- Environments: no source for a web read.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| CODEX1 | The account has no Codex, so the task list answers 403 or 404. | No tasks, and the ChatGPT capture goes on. A 401 still means signed out. | `tests/codex.test.ts` |
| CODEX2 | A task id would leave the task path (`task_../..`). | The id is URI-encoded, so `http` refuses it before a request (H10). | `tests/codex.test.ts` |
| CODEX3 | A list row has an id that is not a `task_` id. | `provider-schema`: `getConversation` routes on that prefix. | `tests/codex.test.ts` |
| CODEX4 | The task list gives the same cursor again. | The capture ends with `pagination-loop` (C4). | `tests/codex.test.ts` |
