// P63 in docs/failure-modes.md: a failure-mode id names one row across
// docs/failure-modes.md and docs/providers/*.md, so a citation such as
// "(N1)" cannot point at two failure modes, and every id the repo cites
// in a doc, a comment or a test title has a row.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const DOCS = ["docs/failure-modes.md", ...readdirSync("docs/providers").map((f) => `docs/providers/${f}`)];
/** Each defined id, with every file whose table has a row for it. */
const defined = new Map<string, string[]>();
for (const file of DOCS) for (const [, id] of readFileSync(file, "utf8").matchAll(/^\| ([A-Z]+\d+) \|/gm)) defined.set(id!, [...(defined.get(id!) ?? []), file]);

const PREFIXES = new Set([...defined.keys()].map((id) => /^[A-Z]+/.exec(id)![0]));
const ID = /\b[A-Z]+\d+\b/g;
/** Not ids: the C0 control characters. */
const NOT_IDS = new Set(["C0"]);
const ROOTS = ["README.md", "AGENTS.md", "docs", "src", "tests", "scripts", "e2e", "extension", ".github"];
const walk = (path: string): string[] => (statSync(path).isDirectory() ? readdirSync(path).filter((f) => f !== "fixtures").flatMap((f) => walk(`${path}/${f}`)) : [path]);
/** The text of a file that can cite an id: all of a doc; the comments and test titles of code. */
function citingText(file: string): string {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".md")) return text;
  const comment = file.endsWith(".yml") ? /(?:^|\s)#(.*)$/ : /(?:^|\s)(?:\/\/|\/?\*)(.*)$/;
  return text
    .split("\n")
    .map((line) => [comment.exec(line)?.[1], /^\s*(?:describe|it)\("([^"]*)"/.exec(line)?.[1]].filter(Boolean).join(" "))
    .join("\n");
}
/** The ids a text cites: any word with an id prefix, and each id in a "(X1, X2)" list or an "X1-X5" range, but not a source line L<n>. */
function cited(text: string): string[] {
  const words = [...text.matchAll(ID)].map((m) => m[0]).filter((w) => PREFIXES.has(/^[A-Z]+/.exec(w)![0]));
  const lists = [...text.matchAll(/\(([A-Z]+\d+(?:(?:, |, and | and |-)[A-Z]+\d+)*)\)|(?:,\s*)([A-Z]+\d+)\)|\b([A-Z]+\d+-[A-Z]+\d+)\b/g)].flatMap((m) => (m[1] ?? m[2] ?? m[3])!.match(ID)!);
  return [...new Set([...words, ...lists])].filter((id) => !/^L\d+$/.test(id) && !NOT_IDS.has(id));
}
const FILES = ROOTS.flatMap(walk).filter((f) => /\.(md|ts|mjs|js|yml)$/.test(f));

describe("P63 failure-mode ids", () => {
  it("reads the repo's docs and code", () => {
    expect(FILES).toContain("scripts/amo-listing.mjs");
    expect(cited("A local host (local_hosts, C29) and AR1-AR5 (X12), S4 and C0, #L10-L20").toSorted()).toEqual(["AR1", "AR5", "C29", "S4", "X12"]);
  });
  it("has a row for every id the repo cites", () => {
    const undefinedIds = FILES.flatMap((file) => cited(citingText(file)).filter((id) => !defined.has(id)).map((id) => `${file}: ${id}`));
    expect([...new Set(undefinedIds)]).toEqual([]);
  });
  it("defines each id in one row only", () => {
    expect([...defined].filter(([, files]) => files.length > 1)).toEqual([]);
  });
});
