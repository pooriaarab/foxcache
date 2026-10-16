# Gemini (gemini.google.com)

Adapter: `src/adapters/gemini.ts`. Fixture: `tests/fixtures/gemini.json`
(synthetic). Researched 2026-10-15. Confidence: confirmed = two or more
sources agree; single-source = one good source.

Auth `google-page-tokens` on `/app`. The page's HTML holds
`WIZ_global_data` with `SNlM0e` (the XSRF token `at`, sent in the form),
`cfb2h` (`bl`) and `FdrFJe` (`f.sid`, both in the query), and every call
sends `X-Same-Domain: 1` with the Google cookies. A guest page has no
`SNlM0e`. Confirmed by
[Gemini-API get_access_token](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/utils/get_access_token.py#L88-L94),
[multi-ai batchexecute.py](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/gemini/extractor/batchexecute.py#L24-L59)
and [ConversationExporters geminiSession](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/page-bridge.ts#L179-L184).

Every read is `POST /_/BardChatUi/data/batchexecute?rpcids=<id>&source-path=<path>&hl=en&rt=c&bl=..&f.sid=..`
with the form body `f.req=[[[<id>, "<args JSON>", null, "generic"]]]&at=..`,
one rpc id per read (`src/batchexecute.ts`). The answer is `)]}'` and then
framed `["wrb.fr", <id>, "<result JSON>"]`. Request and framing:
[Gemini-API _batch_execute](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/client.py#L2317-L2355),
[multi-ai call_rpc](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/gemini/extractor/batchexecute.py#L121-L160),
[pinguarmy](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/contents/gemini-parser.ts#L747-L803)
(confirmed). foxcache sends no `_reqid`: the Gemini sources send a counter
or a random number, so Google does not check its value, and NotebookLM's
batchexecute works without it
([notebooklm-py](https://github.com/teng-lin/notebooklm-py/blob/4188d7e26a07b6b94b67bf95041c81bc1530c508/src/notebooklm/_web/transport/executor.py#L606-L627)).
Check it with a real login.

| What | rpc id, args, source-path | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `ESY5D` (read user preferences), `[]`, `/app` | Any result. A guest has no `at`, a signed-out session answers 401. | [ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/page-bridge.ts#L151-L167), [Gemini-API](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/client.py#L930-L960) | confirmed |
| List | `MaZiqc`, `[20, cursor, [stream, null, 1]]`, `/app`. Stream `1` is the pinned chats, `0` the rest; foxcache reads 1, then 0. | `[1]` next-page token, `[2]` rows: `[0]` `c_<id>`, `[1]` title, `[2]` pinned (`true` or null), `[5]` `[seconds, nanos]`. Each stream keeps the rows of its kind, so a chat is read once. | [pinguarmy streams](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/contents/gemini-parser.ts#L842-L940), [ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/gemini.ts#L11-L23), [Gemini-API](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/components/chat_mixin.py#L54-L114), [multi-ai row schema](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/gemini/server-behavior.md#L144-L160) | confirmed |
| One chat | `hNvQHb`, `["c_<id>", 1000, null, 1, [1], [4], null, 1]`, `/app/<id>` | `[0]` turns, newest first: `[2][0][0]` the prompt, `[3][0][0][1][0]` the first candidate's Markdown, `[4]` `[seconds, nanos]`. | [pinguarmy](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/contents/gemini-parser.ts#L1020-L1046) + [turns](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/src/contents/gemini-parser.ts#L1128-L1166), [ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/gemini.ts#L25-L51), [Gemini-API read_chat](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/components/chat_mixin.py#L128-L180) | confirmed |
| Gems (library) | `CNgdBe`, `[2, ["en"], 0]` (the user's own Gems), `/app` | `[2]` rows: `[0]` id, `[1][0]` name. | [Gemini-API gem_mixin](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/components/gem_mixin.py#L80-L157), [ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/page-bridge.ts#L133-L149) | confirmed |
| Saved info (memories) | `ZKcapf`, `[100]`, `/saved-info` | `[]`, or `[items, token]`; item `[0]` id, `[1]` text, `[2]` `[seconds, nanos]`. | [multi-ai list_instructions](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/gemini/extractor/api_client.py#L84-L141), [multi-ai state.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/gemini/state.md#L42-L69), id in [Gemini-API enum](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/constants.py#L123-L128) | rpc id confirmed, shape single-source |

The rpc ids are compiled names. Five exporters saw the same ids from April
to October 2026, but a Google deploy can rename them. A renamed id gets no
frame back, and the read fails with `provider-schema` (H20).

## Never call

Every write on the batchexecute path, from the
[Gemini-API enum](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/constants.py#L89-L139):
`GzXR5e` deletes a chat, `MUAZcd` edits one, `oMH3Zd`, `kHv0Vd`, `UXcSJb`
and `Nwkn9` write Gems, `xVRQX`, `gSnMcd`, `Ok9j9b` and `YgU2Cc` write saved
info, `L5adhe` writes preferences, and `kOWVAe`, `ukz1Fe`, `ra9Swb`. The
chat stream (`StreamGenerate`, on its own path) sends a message: no read
names that path. foxcache's reads list only the five rpc ids above, so
http refuses any other id before it is sent.

## Not captured

- Learned memory ("Personal context"): no rpc exposes a list
  ([multi-ai state.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/gemini/state.md#L71-L93)).
- Preferences (`ESY5D` answers UI flags, no text) and one Gem's instructions
  (`HcT8bb`): foxcache's library record holds a name only.
- Gemini notebooks: they sync with NotebookLM, which reads them.
- Draft candidates past the first, images and files.
- Chats past the list cap: the cursor chain ends near 500-600 chats
  ([gemini-exporter](https://github.com/OTLFrostA/gemini-exporter/blob/ccbcad63ce455bdd57e532f600cc464595fcf1ac/src/core/api/client/pagination.ts#L225-L236)).
  Google Takeout has the rest; foxpack reads it.
- Accounts after the first (`/u/1/app`).

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| GE1 | A list row, a turn or a Gem has a field of the wrong type, or a chat id that is not `c_` and letters. | `provider-schema` that names the field. | `tests/gemini.test.ts` |
| GE2 | A stream gives a next-page token it gave before, or never ends. | The runner throws `pagination-loop` (C5). | `tests/gemini.test.ts` |
| GE3 | A pinned chat comes back in the other stream. | It is read once. | `tests/gemini.test.ts` |
| GE4 | A chat has 1000 turns or more, which `hNvQHb` cuts with no cursor. | `too-large` for that chat, not a cut chat. | `tests/gemini.test.ts` |
| GE5 | The session is gone (a guest page, a 401) or Google rate-limits (429, status 8). | `detect` is false; a read gives `logged-out` or `rate-limited` (H14, H16). | `tests/gemini.test.ts` |
| GE6 | The row time `[5]` stays at the chat's creation time when a chat gets a new turn: the multi-ai [server-behavior.md](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/docs/extractor-engineering/platforms/web/gemini/server-behavior.md) says new messages "do NOT bump the discovery timestamp". | Handled by GE40. | `tests/gemini.test.ts` |
| GE40 | A chat gets a new turn after a capture, and its row time `[5]` does not move (GE6), so a list stamp says nothing changed. | Every stub carries the time of the list read, so a capture reads every chat again (one `hNvQHb` per chat). The chat's `updatedAt` is the newest of the row time and its turn times, so the store keeps the copy with the new turn (ST1). Not checked with a real login; this is the safe reading of the source. | `tests/gemini.test.ts` |
| GE41 | The user has 100 saved-info items or more. `ZKcapf` is asked for 100, and the token at `[1]` is not known to page: the cited `validate_instructions_envelope` treats 100 or more as incomplete. | `too-large` for the memories, so the runner counts an error and deletes no stored memory (C11). Not checked with a real login; this is the safe reading of the source. | `tests/gemini.test.ts` |
