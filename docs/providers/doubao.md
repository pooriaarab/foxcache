# Doubao (www.doubao.com)

Adapter: `src/adapters/doubao.ts`. Fixture: `tests/fixtures/doubao.json`
(synthetic). Researched 2026-10-15. Confidence levels as in
[claude.md](claude.md). Signing in needs a mainland China phone or a Douyin
account. The international sibling (Cici, Dola) is another product.

Auth: the session cookies alone (`sessionid`, `sid_tt`, `sid_guard`,
`ttwid`). No bearer. A 401 means signed out.
([TraeWorkAssistant](https://github.com/smart-open/TraeWorkAssistant/blob/7da561b160a96bf6df8bdc4edb89c7e491398ffa/src-tauri/src/tasks/doubao_chats.rs#L690-L722),
[leafspace api-notes](https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/references/api-notes.md#L46-L58),
[ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/doubao/plugin.ts#L96-L136) `credentials: "include"`,
[Likefr](https://github.com/Likefr/doubao-chat-scraper/blob/d5ea1f805f86f3e47906051d3b1cc04edf47483a/scripts/doubao_api_scraper.py#L280-L288) (401), confirmed)

Transport: every read is an IM "pull" command, a POST with the body
`{cmd, uplink_body: {<key>: {...}}, sequence_id, channel: 2, version: "1"}`.
The answer is `{status_code (0 is ok), status_desc, downlink_body: {<key>: {...}}}`.
The page sends `content-type: application/json; encoding=utf-8` (plain
`application/json` answers `712012002`) and `agw-js-conv: str`, which
turns 64-bit numbers into strings; the reads fix both headers (H16).
Each read carries the query
`version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&region=CN&sys_region=CN&samantha_web=1&web_platform=browser&use-olympus-account=1`,
with no device fingerprint and no `a_bogus` or `msToken` signature.
([leafspace export script](https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/scripts/export-doubao-im.mjs#L21-L92),
[leafspace api-notes](https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/references/api-notes.md#L22-L58),
[VESTI](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L1-L35),
[ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/doubao/plugin.ts#L16-L18), confirmed.
The query: two sources, each with its own small set; foxcache sends the
leafspace one, which holds ctxport's.)

Times come as epoch seconds or milliseconds, as a number or a digit
string. foxcache reads a value over 10^12 as milliseconds.
([VESTI toMs](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L124-L139),
[Likefr](https://github.com/Likefr/doubao-chat-scraper/blob/d5ea1f805f86f3e47906051d3b1cc04edf47483a/scripts/doubao_api_scraper.py#L324-L330) seconds, single-source on the units)

| What | POST path, cmd and uplink | Shape foxcache reads | Source | Confidence |
|---|---|---|---|---|
| Signed in | `/im/chain/recent_conv`, cmd 3200, `limit: 1` | `status_code` 0. A 401, or a `status_code` that is not 0 and not a known other error: signed out (D40). No endpoint is only for this. | [VESTI isAvailable](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L301-L330) | inferred |
| List | `/im/chain/recent_conv`, cmd 3200, `pull_recent_conv_chain_uplink_body {api_version: 1, conv_version: 0, direction: 3, limit: 50, message_count_per_conv: 0, option: {not_need_message: true, ...}}`; the next page sends `conv_version: next_conv_version` and `direction: 1` | `pull_recent_conv_chain_downlink_body {cells: [{conversation: {conversation_id, name, create_time, update_time}}], next_conv_version, has_more}` | [leafspace](https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/references/api-notes.md#L60-L86), [leafspace script](https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/scripts/export-doubao-im.mjs#L241-L261), [VESTI](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L332-L387), [TraeWorkAssistant](https://github.com/smart-open/TraeWorkAssistant/blob/7da561b160a96bf6df8bdc4edb89c7e491398ffa/src-tauri/src/tasks/doubao_chats.rs#L742-L783) | confirmed (paging after the first page: two sources; Trae saw it fail on the desktop app's aid) |
| Chat info | `/im/conversation/info`, cmd 1110, `get_conv_info_uplink_body {conversation_id, ext: {}, bot_id: "", conversation_type: 3, option: {need_bot_info: false}}` | `get_conv_info_downlink_body.conversation_info {name, latest_index, create_time, update_time}`. foxcache reads the times. | [ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/doubao/plugin.ts#L96-L136), [VESTI](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L389-L420) | confirmed |
| Messages | `/im/chain/single`, cmd 3100, `pull_singe_chain_uplink_body` (the site's spelling) `{conversation_id, anchor_index, conversation_type: 3, direction: 1, limit: 50, ext: {}, filter: {index_list: []}}`. Never `filter.bot_id` (`712010702`). | `pull_singe_chain_downlink_body {messages: [{message_id, index_in_conv, user_type (1 is the user), content_type, content, content_block, create_time}], has_more}`, newest first. The first anchor is 2^53-1; the next is the smallest `index_in_conv` of the page, with messages kept once by `message_id`, until `has_more` is false. | [ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/doubao/plugin.ts#L140-L206), [TraeWorkAssistant](https://github.com/smart-open/TraeWorkAssistant/blob/7da561b160a96bf6df8bdc4edb89c7e491398ffa/src-tauri/src/tasks/doubao_chats.rs#L785-L841), [Likefr](https://github.com/Likefr/doubao-chat-scraper/blob/d5ea1f805f86f3e47906051d3b1cc04edf47483a/scripts/doubao_api_scraper.py#L259-L310), [leafspace](https://github.com/leafspace/leafspace/blob/910b79faee5e9888bc63a601aa56e19eb03fac63/doubao-history-export-kit/references/api-notes.md#L88-L114) | confirmed |
| Message text | (in the message) | The `text_block.text` of each `content_block` of `block_type` 10000, whose `content` is an object or JSON text. Else a user text (`content_type` 1): `content` is JSON `{text}`, or the text. Else blocks (`content_type` 9999): `content` is the JSON block list. Other types (images, cards): no text. | [ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/doubao/plugin.ts#L210-L231), [VESTI](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L160-L187), [TraeWorkAssistant](https://github.com/smart-open/TraeWorkAssistant/blob/7da561b160a96bf6df8bdc4edb89c7e491398ffa/src-tauri/src/tasks/doubao_chats.rs#L843-L866), [Likefr](https://github.com/Likefr/doubao-chat-scraper/blob/d5ea1f805f86f3e47906051d3b1cc04edf47483a/scripts/doubao_api_scraper.py#L148-L160) | confirmed |

## Never call

- `/samantha/chat/completion`: it sends a message, and the page signs it
  with `a_bogus`
  ([doubao2api](https://github.com/wangchuxiaoji-oss/doubao2api/blob/95beb0788338ba268e13ca4c80890ceeae6ff055/README.md#L1865-L1876)).
- `/samantha/thread/delete` and any other IM `cmd` on the read paths. The
  reads name each path and its one `cmd` (3200, 1110, 3100), so a body with
  another `cmd` is refused before it is sent (H9).

## Not captured

- Projects, memories, instructions and bots: no exporter reads them.
- Regenerated answers: VESTI drops messages whose `status` is not 0 as
  replaced versions
  ([VESTI](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L452-L456)).
  No other source does, so foxcache keeps every message.
- Images, files and cards in a message: only text is kept.
- Pinned chats come with the list (`need_pc_pin_chain`), so its order is
  not newest first.

## Failure modes

| # | Failure mode | Wanted behavior | Test |
|---|---|---|---|
| D1 | The cookies are gone: a 401. | `detect` says signed out. | `tests/doubao.test.ts` |
| D2 | `status_code` is not 0 (`712012002`, the risk captcha `710022004`). | `provider-error` with the path and the code. | `tests/doubao.test.ts` |
| D3 | The answer has no `downlink_body` or its key, or `cells` is not a list. | `provider-schema` that names the field. | `tests/doubao.test.ts` |
| D4 | A time or an index is a digit string, a number, seconds or milliseconds. | Read as ISO-8601 UTC (P4). Anything else throws `provider-schema`. | `tests/doubao.test.ts` |
| D5 | `/im/chain/single` gives no older message while `has_more` is true, or never ends. | `pagination-loop`, after 1 000 pages at most (P9). | `tests/doubao.test.ts` |
| D6 | A page repeats the anchor message. | Kept once, by `message_id`. | `tests/doubao.test.ts` |
| D7 | A chat passes 20 000 messages. | `too-large` while it reads (S4). | `tests/doubao.test.ts` |
| D40 | The session expired. VESTI's probe ([isAvailable L301-L330](https://github.com/abraxas914/VESTI/blob/87fed4a48a0227b4bb2835cd1a4799acfb32cdba/frontend/src/lib/contents/history/doubaoHistory.ts#L301-L330)) says a signed-out or expired session answers HTTP 200 with a `status_code` that is not 0, and no source gives the exact code. | `detect` is false for any `status_code` that is not 0, except the codes known to mean something else, which still throw `provider-error`: `712012002` (a missing header, foxcache's bug) and `710022004` (the risk captcha). A read after `detect` still throws `provider-error` (D2). The exact code needs a live check. | `tests/doubao.test.ts` |
