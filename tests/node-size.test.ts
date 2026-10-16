// N5 in docs/failure-modes.md, with the archive limit cut to 4 KiB so the
// test does not need two files of 150 MB.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli.js";

vi.mock("../src/archive.js", async (actual) => ({ ...(await actual<typeof import("../src/archive.js")>()), MAX_ARCHIVE_BYTES: 4096 }));

const dir = () => mkdtempSync(join(tmpdir(), "foxcache-size-"));
const archive = (prefix: string) =>
  JSON.stringify({
    schema: "foxcache/v1",
    exportedAt: "2026-10-15T00:00:00.000Z",
    conversations: [],
    projects: [],
    memories: Array.from({ length: 10 }, (_, i) => ({ provider: "chatgpt", id: `${prefix}${i}`, text: `${prefix} ${"x".repeat(200)}` })),
    preferences: [],
    library: [],
  });

describe("foxcache/node: the archive limit", () => {
  it("N5 an import that would make the store larger than an archive can be is refused, and the store still opens", async () => {
    const env = { FOXCACHE_HOME: join(dir(), "home") };
    const run = async (...argv: string[]) => {
      let out = "";
      let err = "";
      const code = await runCli(argv, { out: (t) => void (out += t), err: (t) => void (err += t), env });
      return { code, out, err };
    };
    const [a, b] = ["a", "b"].map((prefix) => {
      const file = join(dir(), `${prefix}.json`);
      writeFileSync(file, archive(prefix));
      return file;
    });
    expect(await run("import", a!)).toMatchObject({ code: 0, out: "Imported 10 new, 0 updated, 0 unchanged records.\n" });
    const before = readFileSync(join(env.FOXCACHE_HOME, "archive.json"), "utf8");
    const refused = await run("import", b!);
    expect(refused.code).toBe(1);
    expect(refused.err).toMatch(/^foxcache: too-large: .*did not change/);
    expect(readFileSync(join(env.FOXCACHE_HOME, "archive.json"), "utf8")).toBe(before);
    const list = await run("list");
    expect(list.code).toBe(0);
    expect(list.out.split("\n").filter(Boolean)).toHaveLength(10);
  });
});
