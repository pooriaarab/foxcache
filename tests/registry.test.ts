// X12 in docs/failure-modes.md: the manifest asks for exactly the origins
// the adapters read, page and API hosts alike.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADAPTERS, originsOf } from "../src/index.js";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8")) as { optional_host_permissions: string[] };

describe("X12 the registry and the manifest", () => {
  it("lists every origin of every adapter in optional_host_permissions, and nothing else", () => {
    expect(manifest.optional_host_permissions.toSorted()).toEqual(ADAPTERS.flatMap((a) => originsOf(a).map((o) => `${o}/*`)).toSorted());
  });
  it("gives the page origin first", () => {
    expect(originsOf({ origin: "https://github.com", apiOrigins: ["https://api.individual.githubcopilot.com"], reads: [] })).toEqual(["https://github.com", "https://api.individual.githubcopilot.com"]);
  });
});
