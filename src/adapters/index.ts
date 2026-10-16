// The adapters foxcache has, in the order the pages show them. Gemini,
// Perplexity and Grok have none: docs/providers/README.md says why.
import type { ProviderId } from "../schema.js";
import { chatgpt } from "./chatgpt.js";
import { claude } from "./claude.js";
import { deepseek } from "./deepseek.js";
import { mistral } from "./mistral.js";
import type { Adapter } from "./types.js";

// One adapter per line: docs/providers/ADDING.md.
export const ADAPTERS: readonly Adapter[] = Object.freeze([
  chatgpt,
  claude,
  mistral,
  deepseek,
]);

/** The adapter for a provider id. Throws for a provider with no adapter. */
export function adapterFor(id: ProviderId | string): Adapter {
  const adapter = ADAPTERS.find((a) => a.id === id);
  if (!adapter) throw new Error(`foxcache has no adapter for ${id}.`);
  return adapter;
}

/** The adapter whose origin is this one, or undefined. */
export const adapterAt = (origin: string): Adapter | undefined => ADAPTERS.find((a) => a.origin === origin);
