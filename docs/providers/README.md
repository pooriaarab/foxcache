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
| GitHub Copilot | https://github.com | yes, conversations only; read from https://api.individual.githubcopilot.com | [github-copilot.md](github-copilot.md) |
| Kimi | https://www.kimi.com | yes, conversations only, by read POST | [kimi.md](kimi.md) |
| Doubao | https://www.doubao.com | yes, conversations only, by read POST | [doubao.md](doubao.md) |
| Notion AI | https://app.notion.com | yes, AI chats only (read POSTs) | [notion.md](notion.md) |
| Kagi Assistant | https://assistant.kagi.com | yes, conversations, instructions, assistants | [kagi.md](kagi.md) |
| Poe | https://poe.com | yes, conversations only; read POST | [poe.md](poe.md) |
| Meta AI | https://www.meta.ai | yes, conversations only; read POST | [meta.md](meta.md) |
| Qwen Chat | https://chat.qwen.ai | yes: conversations, projects, memories, personalization | [qwen.md](qwen.md) |

foxcache sends only the reads each adapter lists (`src/reads.ts`): exact
GET paths, and POST calls whose body names a read operation, each
checked by hand against its source. ChatGPT, Claude, Le Chat, DeepSeek,
Kagi Assistant and Qwen Chat send GET only. Grok, Perplexity, Kimi,
Doubao, Notion AI, Poe and Meta AI read by POST, each on its own read
paths or commands. Gemini reads by POST, so it needs its list of
read-only POST calls before it gets an adapter.

To add a provider, follow [ADDING.md](ADDING.md).
