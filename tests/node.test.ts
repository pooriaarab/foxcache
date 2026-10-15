// N1-N4 in docs/failure-modes.md.
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FoxcacheError } from "../src/index.js";
import { cachePath, openNodeStore } from "../src/node.js";

const temp = () => mkdtempSync(join(tmpdir(), "foxcache-test-"));
const memory = { provider: "chatgpt", id: "m1", text: "Prefers metric units." } as const;

describe("foxcache/node", () => {
  it("N3 the default path is ~/.foxcache/archive.json, and FOXCACHE_HOME moves it", () => {
    expect(cachePath({})).toBe(join(homedir(), ".foxcache", "archive.json"));
    expect(cachePath({ FOXCACHE_HOME: "/tmp/x" })).toBe("/tmp/x/archive.json");
  });

  it("keeps records across opens, as a foxcache/v1 archive", async () => {
    const env = { FOXCACHE_HOME: join(temp(), "home") };
    const a = await openNodeStore(env);
    await a.store.put("memories", memory);
    await a.save();
    const b = await openNodeStore(env);
    expect(await b.store.all("memories")).toEqual([memory]);
    expect(JSON.parse(readFileSync(cachePath(env), "utf8"))).toMatchObject({ schema: "foxcache/v1", memories: [memory] });
  });

  it("a missing file opens empty and writes nothing until save", async () => {
    const dir = temp();
    const s = await openNodeStore({ FOXCACHE_HOME: dir });
    expect(await s.store.counts()).toEqual({});
    expect(readdirSync(dir)).toEqual([]);
  });

  it("N1 a file that is not JSON, or not an archive, fails loudly and is not changed", async () => {
    for (const text of ["{ half a file", '{"schema":"foxprefs/v1"}']) {
      const dir = temp();
      writeFileSync(join(dir, "archive.json"), text);
      const error = await openNodeStore({ FOXCACHE_HOME: dir }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(FoxcacheError);
      expect((error as FoxcacheError).code).toBe("corrupt-store");
      expect((error as FoxcacheError).message).toContain(join(dir, "archive.json"));
      expect(readFileSync(join(dir, "archive.json"), "utf8")).toBe(text);
    }
  });

  it("N2 a failed write keeps the old file and leaves no temp file", async () => {
    const dir = temp();
    const s = await openNodeStore({ FOXCACHE_HOME: dir });
    await s.store.put("memories", memory);
    mkdirSync(join(dir, "archive.json"));
    writeFileSync(join(dir, "archive.json", "x"), "x");
    await expect(s.save()).rejects.toThrow();
    expect(readdirSync(dir)).toEqual(["archive.json"]);
  });

  it("N4 a directory it makes is 0700 and the file 0600; an existing directory keeps its mode", async () => {
    const made = join(temp(), "home");
    const a = await openNodeStore({ FOXCACHE_HOME: made });
    await a.save();
    expect(statSync(made).mode & 0o777).toBe(0o700);
    expect(statSync(join(made, "archive.json")).mode & 0o777).toBe(0o600);
    const existing = temp();
    chmodSync(existing, 0o755);
    await (await openNodeStore({ FOXCACHE_HOME: existing })).save();
    expect(statSync(existing).mode & 0o777).toBe(0o755);
  });
});
