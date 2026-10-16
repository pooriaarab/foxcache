# NotebookLM, now Gemini Notebook (notebook.google.com)

Adapter: `src/adapters/notebooklm.ts`. Fixture:
`tests/fixtures/notebooklm.json` (synthetic). Researched 2026-10-15.
Confidence: confirmed = two or more sources agree; single-source = one
good source.

Origin `https://notebook.google.com`. On 2026-07-16 Google renamed
NotebookLM, and `notebooklm.google.com` now redirects there, so the tab is
on the new host; batchexecute answers on both
([notebooklm-py ADR-0028](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/docs/adr/0028-gemini-notebook-rename.md#L10-L22)).

Auth `google-page-tokens` on `/`, as for Gemini ([gemini.md](gemini.md)):
`SNlM0e`, `cfb2h` and `FdrFJe` from the app page's HTML
([notebooklm-py extraction](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_auth/extraction.py#L478-L511),
[notebooklm-mcp](https://github.com/jacob-bd/notebooklm-mcp/blob/a277ce7b81196222f79724b21973e17fc610999d/src/notebooklm_tools/core/base.py#L1293-L1339),
confirmed). Every read is `POST /_/LabsTailwindUi/data/batchexecute`, one rpc
id per read, with the query and body of `src/batchexecute.ts`
([notebooklm-py build_url](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/transport/executor.py#L606-L627),
[notebooklm-mcp _build_url](https://github.com/jacob-bd/notebooklm-mcp/blob/a277ce7b81196222f79724b21973e17fc610999d/src/notebooklm_tools/core/base.py#L688-L721),
confirmed). The rpc ids and their server names are in
[notebooklm-py _identifiers.py](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/rpc/_identifiers.py#L26-L171),
each also in
[notebooklm-mcp](https://github.com/jacob-bd/notebooklm-mcp/blob/a277ce7b81196222f79724b21973e17fc610999d/src/notebooklm_tools/core/base.py#L245-L296).

| What | rpc id, args, source-path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in, and the notebooks | `wXbhsf` (ListRecentlyViewedProjects), `[null, 1, null, [2]]`, `/` | `[0]` rows: `[0]` title, `[2]` id, `[5][5]` last viewed and `[5][8]` created, each `[seconds, nanos]`. `null` or `[null]`: no notebooks. | [notebooklm-py list](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/notebooks.py#L567-L607), [decode_notebook](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/rows/notebooks.py#L154-L215), [rpc-reference](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/docs/rpc-reference.md#L304-L325) | confirmed |
| One notebook (project) | `rLM1Ne` (GetProject), `[id, null, [2, null, null, [1, null, null, null, null, null, null, null, null, null, [1]]], null, 0]`, `/notebook/<id>` | `[0][1]` sources (null: none), each `[id, title, ...]` with the id as `"id"`, `["id"]` or `[null, true, ["id"]]`; `[0][7]` chat settings `[[goal, prompt?], [length]]` or null. | [notebooklm-py rpc-reference](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/docs/rpc-reference.md#L375-L403), [sources listing](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/sources/listing.py#L155-L217), [SourceRow.id](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/rows/sources.py#L457-L490), [chat settings](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/rows/chat.py#L314-L330) | confirmed |
| The notebook's chat | `hPTbtc` (GetLastConversationId), `[[], null, id, 1]`, `/notebook/<id>` | `[[[conversation id]]]`, or none. Only the latest session. | [notebooklm-py rpc-reference](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/docs/rpc-reference.md#L1094-L1117), [unwrap](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/rows/chat.py#L207-L237) | confirmed |
| Its turns | `khqZz` (ListChatTurns), `[[], null, null, conversation id, 1000]`, `/notebook/<id>` | `[0]` turns, newest first: `[2]` 1 = question with text at `[3]`, 2 = answer with text at `[4][0][0]`. | [notebooklm-py rpc-reference](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/docs/rpc-reference.md#L1123-L1150), [ConversationTurnRow](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/rows/chat.py#L78-L88) | confirmed |

foxcache maps each notebook to a project (its name, its custom chat prompt
as the instructions, its sources' names and ids as files), and the
notebook's latest chat to a conversation with the notebook's id and name.
A notebook with no chat gives no conversation.

## Never call

The writes on the batchexecute path
([notebooklm-py _identifiers.py](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/rpc/_identifiers.py#L26-L171)):
`J7Gthc` deletes chat history; `CCqFvf`, `te3DCe`, `s0tc2d`, `WWINqb` and
`fejl7e` write notebooks; `izAoDd`, `X1snv`, `o4cbdc`, `tGMBJ`, `b7Wfje`
and `FLmJqe` write sources; `R7cb6c`, `V5N4be`, `rc3d8d`, `Krh3pd`,
`RGP97b` and `QDyure` write artifacts; `CYK0Xb`, `cYAfTb` and `AH0mwd`
write notes; `hT54vc` writes settings. `ZwVcOc` (GetOrCreateAccount) may
create an account record. The chat stream `GenerateFreeFormStreamed` sends
a message. foxcache's reads list only the four rpc ids above.

## Not captured

- Source text (`hizoJc`, LoadSource): foxcache keeps a file's name and id,
  never its contents (P5).
- Notes and mind maps (`cFji9`) and Studio artifacts (`gArtLc`): foxcache/v1
  has no record for them.
- Older chat sessions: `hPTbtc` gives the latest only.
- The Enterprise edition (`/_/CloudNotebookLmUi/`), and accounts after the
  first (`authuser`).

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| NB1 | A notebook row, a source or a turn has a field of the wrong type, a notebook id that is not letters, digits and `-`, or a turn role that is not 1 or 2. | `provider-schema` that names the field. | `tests/notebooklm.test.ts` |
| NB2 | A notebook has no chat, or its chat is gone between the list and the read. | No conversation for it; `not-found` for the read, which the runner skips (C4). | `tests/notebooklm.test.ts` |
| NB3 | A chat has 1000 turns or more, which `khqZz` cuts with no cursor. | `too-large` for that chat. | `tests/notebooklm.test.ts` |
| NB4 | The session is gone (a guest page, a 401) or Google rate-limits (429, status 8). | `detect` is false; a read gives `logged-out` or `rate-limited` (H14, H16). | `tests/notebooklm.test.ts` |
| NB5 | Turns carry no time. | The chat takes the notebook's last-viewed time; a new turn in a notebook the user opened moves it. Check with a real login. | none: needs a live session |
