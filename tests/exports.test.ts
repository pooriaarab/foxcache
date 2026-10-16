// P30 in docs/failure-modes.md: the library exports every adapter the
// extension ships and every auth kind in src/auth/.
import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as foxcache from "../src/index.js";

const exported = new Set<unknown>(Object.values(foxcache));

describe("P30 the public API", () => {
  it.each(foxcache.ADAPTERS.map((a) => [a.id, a] as const))("exports the %s adapter", (_, adapter) => {
    expect(exported.has(adapter)).toBe(true);
  });
  // types.ts and token.ts are parts, not kinds.
  const kinds = readdirSync(new URL("../src/auth/", import.meta.url)).filter((f) => f.endsWith(".ts") && !["types.ts", "token.ts"].includes(f));
  it.each(kinds)("exports the auth kind of %s", async (file) => {
    const own = Object.values((await import(`../src/auth/${file.replace(/\.ts$/, ".js")}`)) as Record<string, unknown>);
    expect(own.length).toBeGreaterThan(0);
    for (const value of own) expect(exported.has(value)).toBe(true);
  });
});
