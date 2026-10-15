// R60 in docs/failure-modes.md: pnpm check:amo fails when the listing does
// not name a host the manifest asks for. Each case runs the script in a
// copy of the repo's extension/, with the release build in dist-ext/.
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SCRIPT = resolve("scripts/amo-listing.mjs");

function checkWith(change: (manifest: { optional_host_permissions: string[] }) => void) {
  const dir = mkdtempSync(join(tmpdir(), "fca-amo-"));
  cpSync("extension", join(dir, "extension"), { recursive: true });
  cpSync("package.json", join(dir, "package.json"));
  const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
  change(manifest);
  for (const at of ["extension", "dist-ext"]) {
    cpSync("extension", join(dir, at), { recursive: true });
    writeFileSync(join(dir, at, "manifest.json"), JSON.stringify(manifest));
  }
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
