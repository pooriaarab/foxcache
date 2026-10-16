// P60 in docs/failure-modes.md: the README and docs/providers/README.md
// name every adapter, and say which ones read by POST, as the reads do.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ADAPTERS } from "../src/index.js";

const readme = readFileSync("README.md", "utf8");
const providers = readFileSync("docs/providers/README.md", "utf8");
const section = (text: string, title: string) => text.split(`\n## ${title}\n`)[1]!.split("\n## ")[0]!;
const firstCells = (text: string) => [...text.matchAll(/^\| ([^|]+?) \|/gm)].map((m) => m[1]!);
const posts = (a: (typeof ADAPTERS)[number]) => a.reads.some((r) => r.method === "POST");
/** The labels on a line "- <lead>: A, B and C." */
const listed = (lead: string) => {
  const line = providers.split("\n").find((l) => l.startsWith(`- ${lead}: `)) ?? "";
  return line.slice(`- ${lead}: `.length, -1).split(/, | and /).toSorted();
};
const labels = (keep: (a: (typeof ADAPTERS)[number]) => boolean) => ADAPTERS.filter(keep).map((a) => a.label).toSorted();

describe("P60 the docs name every adapter", () => {
  it("the README Coverage table has one row per adapter", () => {
    const rows = firstCells(section(readme, "Coverage"));
    for (const a of ADAPTERS) expect(rows.filter((c) => c === `${a.label} adapter`), a.id).toHaveLength(1);
  });
  it("the README compare table names every site", () => {
    const sites = section(readme, "Compare").split("\n").find((l) => l.startsWith("| Sites |"))!.split(" | ")[1]!.split(", ");
    expect(sites.toSorted()).toEqual(labels(() => true));
  });
  it("docs/providers/README.md has a row per adapter, and lists each one as GET only or by POST, as its reads are", () => {
    for (const a of ADAPTERS) expect(firstCells(providers).filter((c) => c === a.label || c.startsWith(`${a.label} (`)), a.id).toHaveLength(1);
    expect(listed("GET only")).toEqual(labels((a) => !posts(a)));
    expect(listed("By POST as well")).toEqual(labels(posts));
  });
});

describe("C8 the docs say which sites read every chat again", () => {
  // GE40 and GENSPARK41: their lists give no time that moves on a new message.
  const texts = { "README.md": readme, "docs/design.md": readFileSync("docs/design.md", "utf8"), "extension/amo-metadata.json": (JSON.parse(readFileSync("extension/amo-metadata.json", "utf8")) as { description: Record<string, string> }).description["en-US"]! };
  it("names Gemini and Genspark, and why, wherever a second capture fetches only what changed", () => {
    for (const [file, text] of Object.entries(texts)) {
      const claims = text.split(/(?<=\.)\s|\n\n|\|\n/).filter((s) => /changed/i.test(s) && /second (capture|run)|only what/i.test(s));
      expect(claims.length, file).toBeGreaterThan(0);
      for (const claim of claims) expect(claim.replace(/\s+/g, " "), file).toMatch(/most sites[\s\S]*Gemini and Genspark read every [\s\S]*no time that moves/i);
    }
  });
});
