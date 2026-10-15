# Gemini (gemini.google.com): no adapter

Researched 2026-10-15. Every read of a chat list or a chat goes through
`POST /_/BardChatUi/data/batchexecute` with a form body and the page tokens
`SNlM0e` (`at`), `cfb2h` (`bl`) and `FdrFJe` (`f.sid`). The list is rpcid
`MaZiqc`, one chat is `hNvQHb`, Gems are `CNgdBe`, saved info is `ZKcapf`.
No source shows a GET for any of them. All six sources agree:
[Gemini-API](https://github.com/HanaokaYuzu/Gemini-API/blob/1ad0d4a93e505e77c79769d78ef2997641f973c8/src/gemini_webapi/constants.py#L80-L142),
[ConversationExporters](https://github.com/siraht/ConversationExporters/blob/7575ff26ce888c2c03aaa6bf205bcf761af69f64/packages/web-sync-exporter/src/page-bridge.ts#L105-L184),
[multi-ai extractor](https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/gemini/extractor/batchexecute.py#L24-L160),
[ctxport](https://github.com/nicepkg/ctxport/blob/c4e3db1be3191d4167d2218c90dd9cfbea0dc924/packages/core-plugins/src/plugins/gemini/parser.ts#L11-L56),
[gemini-exporter](https://github.com/OTLFrostA/gemini-exporter/blob/688a3b0556d9f8f4665f299f4f7478328c7fc86b/src/core/api/geminiClient.ts#L81-L91),
[ai-chat-exporter fixture](https://github.com/pinguarmy/ai-chat-exporter/blob/d760b045dd19ae17af4f21c7765e1c14e5d29671/tests/fixtures/providers/gemini/2026-08-24-normal.json).
Confidence: confirmed.

The rpcids are compiled names that can change with a Google deploy, and the
list stops near 500-600 chats (`BardErrorInfo` 1096), so even a POST adapter
would need care. Google Takeout (My Activity > Gemini Apps) is the other way
out; foxpack reads it.
