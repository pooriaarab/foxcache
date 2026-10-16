// The adapters foxcache has, in the order the pages show them.
import type { ProviderId } from "../schema.js";
import { chatgpt } from "./chatgpt.js";
import { claude } from "./claude.js";
import { deepseek } from "./deepseek.js";
import { doubao } from "./doubao.js";
import { gemini } from "./gemini.js";
import { genspark } from "./genspark.js";
import { githubCopilot } from "./github-copilot.js";
import { grok } from "./grok.js";
import { huggingchat } from "./huggingchat.js";
import { kagi } from "./kagi.js";
import { kimi } from "./kimi.js";
import { meta } from "./meta.js";
import { mistral } from "./mistral.js";
import { notebooklm } from "./notebooklm.js";
import { notion } from "./notion.js";
import { perplexity } from "./perplexity.js";
import { poe } from "./poe.js";
import { qwen } from "./qwen.js";
import { zai } from "./zai.js";
import type { Adapter } from "./types.js";

// One adapter per line: docs/providers/ADDING.md.
export const ADAPTERS: readonly Adapter[] = Object.freeze([
  chatgpt,
  claude,
  mistral,
  deepseek,
  grok,
  perplexity,
  githubCopilot,
  kimi,
  doubao,
  notion,
  kagi,
  poe,
  meta,
  qwen,
  zai,
  huggingchat,
  genspark,
  gemini,
  notebooklm,
]);

/** The adapter for a provider id. Throws for a provider with no adapter. */
export function adapterFor(id: ProviderId | string): Adapter {
  const adapter = ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`foxcache has no adapter for ${id}.`);
  return adapter;
}

/** The adapter whose origin is this one, or undefined. */
export const adapterAt = (origin: string): Adapter | undefined => ADAPTERS.find((a) => a.origin === origin);
