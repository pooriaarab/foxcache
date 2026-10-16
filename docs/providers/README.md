# Providers

| Provider | Origin | Adapter | Why |
|---|---|---|---|
| ChatGPT | https://chatgpt.com | yes | [chatgpt.md](chatgpt.md) |
| Claude | https://claude.ai | yes | [claude.md](claude.md) |
| Le Chat (Mistral) | https://chat.mistral.ai | yes, conversations only | [mistral.md](mistral.md) |
| Gemini | https://gemini.google.com | no: every read is a POST | [gemini.md](gemini.md) |
| Perplexity | https://www.perplexity.ai | no: the thread list is a POST | [perplexity.md](perplexity.md) |
| Grok | https://grok.com | no: message text is a POST | [grok.md](grok.md) |
| DeepSeek | https://chat.deepseek.com | yes, conversations only | [deepseek.md](deepseek.md) |

foxcache sends only the reads each adapter lists (`src/reads.ts`): exact GET
paths, and POST calls whose body names a read operation, each checked by
hand against its source. The four adapters above send GET only. Gemini,
Perplexity and Grok read by POST, so each needs its list of read-only POST
calls before it gets an adapter.
