// R60 and R61 in docs/failure-modes.md: pnpm check:amo fails when the
// listing does not name a host the manifest asks for, or the release build
// ships a test file or a local host. Each case runs the script in a copy of
// the repo's extension/, with the release build in dist-ext/.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/amo-listing.mjs");

function checkWith(change: (manifest: { optional_host_permissions: string[] }) => void, extra?: string) {
  const dir = mkdtempSync(join(tmpdir(), "fca-amo-"));
  cpSync("extension", join(dir, "extension"), { recursive: true });
  cpSync("package.json", join(dir, "package.json"));
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  change(manifest);
  for (const at of ["extension", "dist-ext"]) {
    cpSync("extension", join(dir, at), { recursive: true });
    writeFileSync(join(dir, at, "manifest.json"), JSON.stringify(manifest));
  }
  if (extra) writeFileSync(join(dir, "dist-ext", extra), "");
  const r = spawnSync(process.execPath, [SCRIPT, "check"], { cwd: dir, encoding: "utf8" });
  return { status: r.status, err: r.stderr };
}

describe("R60 the AMO listing names every manifest host", () => {
  it("passes for the repo's manifest and listing", () => {
    expect(checkWith(() => undefined)).toEqual({ status: 0, err: "" });
  });
  it("fails, and names the host, when the manifest has a host the listing does not name", () => {
    const r = checkWith((m) => m.optional_host_permissions.push("https://chat.example.org/*"));
    expect(r.status).toBe(1);
    expect(r.err).toContain('the listing description must name the host "chat.example.org" from the manifest');
  });
});

describe("R61 the release build ships nothing for tests", () => {
  it("fails, and names the file, when dist-ext/ holds a test-named file", () => {
    const r = checkWith(() => undefined, "agent.test.js");
    expect(r.status).toBe(1);
    expect(r.err).toContain("the release build ships the test file dist-ext/agent.test.js");
  });
  it("fails when the release build asks for a local host with no reason in local_hosts", () => {
    const r = checkWith((m) => m.optional_host_permissions.push("http://127.0.0.1/*"));
    expect(r.status).toBe(1);
    expect(r.err).toContain('the release build has the host permission "http://127.0.0.1/*"; move it to the e2e build, or give a reason in local_hosts["http://127.0.0.1/*"].host_permission');
  });
});
