// X30 in docs/failure-modes.md: no auth kind reads document.cookie, and
// the agent does not hand it over.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as foxcache from "../src/index.js";
import { type Auth, createHttp, defineReads } from "../src/index.js";

describe("X30 no auth kind reads a cookie", () => {
  it("gives an auth kind no cookie, even from a page that has one", async () => {
    let seen: string[] = [];
    const auth: Auth = { kind: "test", tokenPaths: [], renews: false, open: (page) => ((seen = Object.keys(page)), async () => ({})) };
    const page = { fetch: async () => Response.json({}), storage: { getItem: () => null }, cookie: () => "session_id=synthetic", scripts: () => [], call: () => undefined };
    await createHttp({ origin: "https://chatgpt.com", reads: defineReads([{ method: "GET", path: "/api/me", source: "https://example.test/docs" }]), auth }, page).get("/api/me");
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain("cookie");
  });
  it("ships no cookie-bearer kind", () => {
    expect(Object.keys(foxcache)).not.toContain("cookieBearer");
  });
  it("does not read document.cookie in the agent", () => {
    expect(readFileSync(new URL("../extension/agent.js", import.meta.url), "utf8")).not.toContain("document.cookie");
  });
});
