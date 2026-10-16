// R1 and R2 in docs/failure-modes.md: what .github/workflows/release.yml
// runs before it publishes, and which job holds which token. A small reader
// for the one shape the file has: jobs at two spaces, their keys at four,
// steps as "- " items and permissions at six.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Job {
  name: string;
  needs: string[];
  permissions: Record<string, string>;
  /** Each step's text, in order. */
  steps: string[];
}

/** The "name: value" lines indented by `indent` right after the line `at`. */
function block(lines: string[], at: number, indent: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines.slice(at + 1)) {
    const m = new RegExp(`^ {${indent}}([\\w-]+): (\\w+)`).exec(line);
    if (!m) break;
    out[m[1]!] = m[2]!;
  }
  return out;
}

function jobs(yaml: string): Job[] {
  const out: Job[] = [];
  const lines = yaml.split("\n");
  let job: Job | undefined;
  let inSteps = false;
  for (let i = lines.indexOf("jobs:") + 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    const jobName = /^ {2}([\w-]+):$/.exec(line);
    if (jobName) {
      job = { name: jobName[1]!, needs: [], permissions: {}, steps: [] };
      out.push(job);
      inSteps = false;
      continue;
    }
    if (!job) continue;
    const needs = /^ {4}needs: \[?([\w, -]+)\]?$/.exec(line);
    if (needs) job.needs = needs[1]!.split(",").map((n) => n.trim());
    if (line === "    permissions:") job.permissions = block(lines, i, 6);
    if (/^ {4}\w/.test(line)) inSteps = line === "    steps:";
    else if (inSteps && line.startsWith("      - ")) job.steps.push(line);
    else if (inSteps && job.steps.length > 0) job.steps[job.steps.length - 1] += `\n${line}`;
  }
  return out;
}

const yaml = readFileSync(".github/workflows/release.yml", "utf8");
const release = jobs(yaml);
const runs = (step: string, command: string) => new RegExp(`(^|\\s)${command}(\\s|$)`, "m").test(step);

describe("release workflow", () => {
  it("R1 the E2E passes, in the job that publishes or in one it needs, before npm publish and web-ext sign", () => {
    const publish = release.find((j) => j.steps.some((s) => runs(s, "npm publish --provenance")));
    expect(publish).toBeDefined();
    const at = (command: string) => publish!.steps.findIndex((s) => runs(s, command));
    const before = publish!.steps.slice(0, at("npm publish --provenance"));
    const needed = release.filter((j) => publish!.needs.includes(j.name));
    expect(at("pnpm exec web-ext sign")).toBeGreaterThan(at("npm publish --provenance"));
    expect([...before, ...needed.flatMap((j) => j.steps)].some((s) => runs(s, "pnpm e2e"))).toBe(true);
  });

  it("R2 only the publish job holds a write token, and it builds and tests nothing", () => {
    const lines = yaml.split("\n");
    expect(block(lines, lines.indexOf("permissions:"), 2)).toEqual({ contents: "read" });
    const writers = release.filter((j) => Object.values(j.permissions).includes("write"));
    expect(writers.map((j) => j.name)).toEqual(["publish"]);
    const publish = writers[0]!;
    expect(publish.permissions).toEqual({ contents: "write", "id-token": "write" });
    expect(publish.steps.some((s) => runs(s, "npm publish --provenance"))).toBe(true);
    for (const command of ["pnpm ci:local", "pnpm e2e", "pnpm build", "pnpm build:ext", "pnpm test"]) expect(publish.steps.filter((s) => runs(s, command)), command).toEqual([]);
    expect(publish.steps.filter((s) => /pnpm install/.test(s)).every((s) => /--ignore-scripts/.test(s))).toBe(true);
    const checked = release.filter((j) => publish.needs.includes(j.name));
    expect(checked.flatMap((j) => j.steps).some((s) => runs(s, "pnpm ci:local"))).toBe(true);
    expect(checked.every((j) => Object.keys(j.permissions).length === 0)).toBe(true);
  });
});
