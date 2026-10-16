// CL1-CL3 and A2 in docs/failure-modes.md, and each command once.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ARCHIVE_BYTES } from "../src/index.js";
import { runCli } from "../src/cli.js";

const dir = () => mkdtempSync(join(tmpdir(), "foxcache-cli-"));
const conv = (id: string, title: string, text: string) => ({
  provider: "claude",
  id,
  title,
  createdAt: "2026-03-04T00:00:00.000Z",
  updatedAt: "2026-03-05T00:00:00.000Z",
  messages: [{ role: "user", text, attachments: [] }],
});
const ARCHIVE = {
  schema: "foxcache/v1",
  exportedAt: "2026-10-15T00:00:00.000Z",
  conversations: [conv("c1", "Lisbon trip", "Plan three days in Lisbon"), conv("c2", "Tea \u001b[31mred\u001b[0m", "Green tea notes \u001b]0;pwned\u0007 \u009b2J")],
  projects: [{ provider: "claude", id: "p1", name: "Thesis", files: [] }],
  memories: [{ provider: "chatgpt", id: "m1", text: "Prefers metric units." }],
  preferences: [{ provider: "chatgpt", kind: "about-me", text: "Lives in Berlin." }],
  library: [],
};

function cli() {
  const env = { FOXCACHE_HOME: join(dir(), "home") };
  const file = join(dir(), "foxcache-archive.json");
  writeFileSync(file, JSON.stringify(ARCHIVE));
  const run = async (...argv: string[]) => {
    let out = "";
    let err = "";
    const code = await runCli(argv, { out: (t) => void (out += t), err: (t) => void (err += t), env });
    return { code, out, err };
  };
  return { run, file, env };
}

describe("foxcache CLI", () => {
  it("imports an archive, then lists, searches and shows", async () => {
    const { run, file } = cli();
    expect(await run("import", file)).toMatchObject({ code: 0, out: "Imported 5 new, 0 updated, 0 unchanged records.\n" });
    expect((await run("import", file)).out).toBe("Imported 0 new, 0 updated, 5 unchanged records.\n");
    const list = (await run("list")).out;
    expect(list).toMatch(/^conversations +claude:c1 +2026-03-05 +Lisbon trip$/m);
    expect(list).toMatch(/^memories +chatgpt:m1 +Prefers metric units\.$/m);
    expect((await run("list", "--kind", "projects")).out).toBe("projects       claude:p1         Thesis\n");
    expect((await run("list", "--provider", "chatgpt", "--kind", "conversations")).out).toBe("");
    const search = (await run("search", "lisbon")).out;
    expect(search).toBe("claude:c1  Lisbon trip\n    Plan three days in Lisbon\n");
    expect((await run("show", "claude:c1")).out).toContain("## User\n\nPlan three days in Lisbon\n");
    expect(JSON.parse((await run("show", "chatgpt:m1")).out)).toEqual(ARCHIVE.memories[0]);
  });

  it("exports JSON, memories and a Markdown folder", async () => {
    const { run, file } = cli();
    await run("import", file);
    expect(JSON.parse((await run("export", "--json")).out)).toMatchObject({ schema: "foxcache/v1", memories: ARCHIVE.memories });
    expect((await run("export", "--memories")).out).toMatch(/^# foxcache memories, exported .*\n- \[chatgpt\] Prefers metric units\.\n$/);
    const out = join(dir(), "md");
    expect(await run("export", "--md", out)).toMatchObject({ code: 0, out: `Wrote 2 Markdown files to ${out}.\n` });
    expect(readdirSync(join(out, "claude")).toSorted()).toEqual(["2026-03-04-lisbon-trip.md", "2026-03-04-tea-31mred-0m.md"]);
    expect(readFileSync(join(out, "claude", "2026-03-04-lisbon-trip.md"), "utf8")).toContain("# Lisbon trip");
  });

  it("CL1 bad usage exits 2, a foxcache error exits 1 with one line", async () => {
    const { run } = cli();
    for (const argv of [["frobnicate"], ["list", "--nope"], ["show"], ["export"], ["export", "--json", "--memories"], ["list", "--kind", "chats"]]) {
      const r = await run(...argv);
      expect([argv, r.code]).toEqual([argv, 2]);
      expect(r.err).toContain("Usage: foxcache");
    }
    const missing = await run("show", "claude:nope");
    expect(missing).toMatchObject({ code: 1, out: "" });
    expect(missing.err).toBe("foxcache: not-found: No record has the id claude:nope.\n");
    expect((await run("import", join(dir(), "none.json"))).code).toBe(1);
    expect((await run("search", " ")).err).toMatch(/^foxcache: bad-query: /);
  });

  it("CL2 export --md refuses a folder with files and writes nothing", async () => {
    const { run, file } = cli();
    await run("import", file);
    const out = dir();
    writeFileSync(join(out, "keep.txt"), "mine");
    const r = await run("export", "--md", out);
    expect(r).toMatchObject({ code: 1 });
    expect(r.err).toMatch(/^foxcache: not-empty: /);
    expect(readdirSync(out)).toEqual(["keep.txt"]);
  });

  it("CL3 strips terminal escape codes from what it prints", async () => {
    const { run, file } = cli();
    await run("import", file);
    for (const r of [await run("list"), await run("search", "tea"), await run("show", "claude:c2")]) {
      // oxlint-disable-next-line no-control-regex -- the control characters are what it checks for
      expect(r.out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/);
    }
    expect((await run("search", "tea")).out).toContain("Tea [31mred[0m");
  });

  it("CL3 escapes C1 control characters in JSON output", async () => {
    const { run, file } = cli();
    await run("import", file);
    const out = (await run("export", "--json")).out;
    // oxlint-disable-next-line no-control-regex -- the control characters are what it checks for
    expect(out).not.toMatch(/[\u007f-\u009f]/);
    expect(JSON.parse(out).conversations[1].messages[0].text).toContain("\u009b");
  });

  it("CL4 a file system error exits 1 with one foxcache line, not a stack trace", async () => {
    const { run, file } = cli();
    await run("import", file);
    const afile = join(dir(), "afile");
    writeFileSync(afile, "");
    for (const target of [afile, join(afile, "sub")]) {
      const r = await run("export", "--md", target);
      expect(r.code).toBe(1);
      expect(r.err).toMatch(/^foxcache: ENOTDIR: [^\n]*\n$/);
    }
  });

  it("N6 two imports at once keep the records of both", async () => {
    const { run, env } = cli();
    const files = ["c", "d"].map((prefix) => {
      const file = join(dir(), `${prefix}.json`);
      const memories = Array.from({ length: 200 }, (_, i) => ({ provider: "chatgpt", id: `${prefix}${i}`, text: `${prefix} ${i}` }));
      writeFileSync(file, JSON.stringify({ ...ARCHIVE, conversations: [], projects: [], preferences: [], memories }));
      return file;
    });
    const results = await Promise.all(files.map((file) => run("import", file)));
    expect(results.map((r) => r.out)).toEqual(Array(2).fill("Imported 200 new, 0 updated, 0 unchanged records.\n"));
    expect((await run("list")).out.split("\n").filter(Boolean)).toHaveLength(400);
    expect(readdirSync(env.FOXCACHE_HOME)).toEqual(["archive.json"]);
  });

  it("N6 a lock left by an import that died stops the next import, which says how to clear it", async () => {
    const { run, env, file } = cli();
    mkdirSync(env.FOXCACHE_HOME);
    // A pid above the Linux maximum (2^22) runs no process.
    writeFileSync(join(env.FOXCACHE_HOME, "archive.json.lock"), "4194305");
    const r = await run("import", file);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^foxcache: locked: .*archive\.json\.lock.*4194305.*Delete/);
    expect(readdirSync(env.FOXCACHE_HOME)).toEqual(["archive.json.lock"]);
  });

  it("A2 import refuses a file over the limit before it reads it", async () => {
    const { run, env } = cli();
    const big = join(dir(), "big.json");
    writeFileSync(big, "");
    truncateSync(big, MAX_ARCHIVE_BYTES + 1);
    const r = await run("import", big);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/^foxcache: too-large: /);
    expect(existsSync(env.FOXCACHE_HOME)).toBe(false);
  });
});
