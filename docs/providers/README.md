# Providers

| Provider | Origin | Adapter | Why |
|---|---|---|---|
| ChatGPT | https://chatgpt.com | yes | [chatgpt.md](chatgpt.md) |
| Claude | https://claude.ai | yes | [claude.md](claude.md) |
| Le Chat (Mistral) | https://chat.mistral.ai | yes, conversations only | [mistral.md](mistral.md) |
| Gemini | https://gemini.google.com | no: every read is a POST | [gemini.md](gemini.md) |
| DeepSeek | https://chat.deepseek.com | yes, conversations only | [deepseek.md](deepseek.md) |
| Grok | https://grok.com | yes, conversations only; the message text is one POST read | [grok.md](grok.md) |
| Perplexity | https://www.perplexity.ai | yes, conversations and memories; the list and the memories are POST reads | [perplexity.md](perplexity.md) |

foxcache sends only the reads each adapter lists (`src/reads.ts`): exact GET
paths, and POST calls whose body names a read operation, each checked by
hand against its source. Gemini reads by POST, so it needs its list of
read-only POST calls before it gets an adapter.

To add a provider, follow [ADDING.md](ADDING.md).
