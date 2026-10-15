// R1 in docs/failure-modes.md: what .github/workflows/release.yml runs
// before it publishes. A small reader for the one shape the file has: jobs
// at two spaces, their keys at four, steps as "- " items at six.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface Job {
  name: string;
  needs: string[];
  /** Each step's text, in order. */
  steps: string[];
}

function jobs(yaml: string): Job[] {
  const out: Job[] = [];
  const lines = yaml.split("\n");
  let job: Job | undefined;
  let inSteps = false;
  for (const line of lines.slice(lines.indexOf("jobs:") + 1)) {
    const jobName = /^ {2}([\w-]+):$/.exec(line);
    if (jobName) {
      job = { name: jobName[1]!, needs: [], steps: [] };
      out.push(job);
      inSteps = false;
      continue;
    }
    if (!job) continue;
    const needs = /^ {4}needs: \[?([\w, -]+)\]?$/.exec(line);
    if (needs) job.needs = needs[1]!.split(",").map((n) => n.trim());
    if (/^ {4}\w/.test(line)) inSteps = line === "    steps:";
    else if (inSteps && line.startsWith("      - ")) job.steps.push(line);
    else if (inSteps && job.steps.length > 0) job.steps[job.steps.length - 1] += `\n${line}`;
  }
  return out;
}

const release = jobs(readFileSync(".github/workflows/release.yml", "utf8"));
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
});
