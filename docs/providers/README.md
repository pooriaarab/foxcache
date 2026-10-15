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

foxcache sends GET only (`src/http.ts`), so a GET can never change anything
on the provider. A provider whose reads need a POST has no adapter in this
version. A short list of read-only POST calls, each checked by hand, would
let foxcache cover Gemini, Perplexity and Grok; that is an open decision,
not a fallback.
