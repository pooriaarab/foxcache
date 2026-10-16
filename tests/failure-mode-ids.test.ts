// P63 in docs/failure-modes.md: a failure-mode id names one row across
// docs/failure-modes.md and docs/providers/*.md, so a citation such as
// "(N1)" cannot point at two failure modes.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOCS = ["docs/failure-modes.md", ...readdirSync("docs/providers").map((f) => `docs/providers/${f}`)];
/** Each defined id, with every file whose table has a row for it. */
const defined = new Map<string, string[]>();
for (const file of DOCS) for (const [, id] of readFileSync(file, "utf8").matchAll(/^\| ([A-Z]+\d+) \|/gm)) defined.set(id!, [...(defined.get(id!) ?? []), file]);

describe("P63 failure-mode ids", () => {
  it("defines each id in one row only", () => {
    expect([...defined].filter(([, files]) => files.length > 1)).toEqual([]);
  });
});
