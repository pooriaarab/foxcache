import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Archive, type Conversation, markdownFiles, toMarkdown, toMemoryList, zip } from "../src/index.js";

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  provider: "chatgpt",
  id: "c-1",
  title: "Trip plan",
  createdAt: "2026-03-04T05:06:07.000Z",
  updatedAt: "2026-03-05T05:06:07.000Z",
  messages: [
    { role: "user", text: "Plan a trip", createdAt: "2026-03-04T05:06:07.000Z", attachments: [{ name: "map.png", mimeType: "image/png", size: 2048 }] },
    { role: "assistant", text: "Here is a plan.", attachments: [] },
  ],
  ...over,
});
const archive = (over: Partial<Archive> = {}): Archive => ({ schema: "foxcache/v1", exportedAt: "2026-10-15T00:00:00.000Z", conversations: [], projects: [], memories: [], preferences: [], library: [], ...over });

describe("Markdown", () => {
  it("writes the title, the facts and each message", () => {
    const md = toMarkdown(conv({ model: "gpt-5" }));
    expect(md).toContain("# Trip plan\n");
    expect(md).toContain("- Model: gpt-5\n");
    expect(md).toContain("## User, 2026-03-04T05:06:07.000Z\n\nPlan a trip\n");
    expect(md).toContain("Attachments: map.png (image/png, 2048 bytes)");
    expect(md).toContain("## Assistant\n\nHere is a plan.\n");
  });
});

describe("O1 file names", () => {
  it.each([
    ["../../etc/passwd", "chatgpt/2026-03-04-etc-passwd.md"],
    ["C:\\Windows\\system32", "chatgpt/2026-03-04-c-windows-system32.md"],
    ["Ünïcödé café", "chatgpt/2026-03-04-unicode-cafe.md"],
    ["\u0000\u0007", "chatgpt/2026-03-04-untitled.md"],
    ["x".repeat(300), `chatgpt/2026-03-04-${"x".repeat(60)}.md`],
  ])("slugs %j", (title, path) => {
    expect(markdownFiles(archive({ conversations: [conv({ title })] })).map((f) => f.path)).toEqual([path]);
  });
  it("numbers titles that slug the same", () => {
    const files = markdownFiles(archive({ conversations: [conv({ id: "a" }), conv({ id: "b", title: "trip plan!" }), conv({ id: "c" })] }));
    expect(files.map((f) => f.path)).toEqual(["chatgpt/2026-03-04-trip-plan.md", "chatgpt/2026-03-04-trip-plan-2.md", "chatgpt/2026-03-04-trip-plan-3.md"]);
  });
});

describe("O2 hostile text", () => {
  it("escapes HTML so a viewer shows it as text", () => {
    const md = toMarkdown(conv({ title: "<b>x</b>", messages: [{ role: "assistant", text: `<img src=x onerror=alert(1)> & <script>alert(1)</script>`, attachments: [] }] }));
    expect(md).not.toMatch(/<img|<script|<b>/);
    expect(md).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &lt;script&gt;");
    expect(md).toContain("# &lt;b&gt;x&lt;/b&gt;");
  });
  it("disarms script links", () => {
    const md = toMarkdown(conv({ messages: [{ role: "assistant", text: "[click](javascript:alert(1)) [x]( data:text/html,hi)", attachments: [] }] }));
    expect(md).not.toMatch(/\]\(\s*(javascript|data):/i);
  });
  it("disarms reference-style script links", () => {
    const md = toMarkdown(conv({ messages: [{ role: "assistant", text: "see [a]\n\n[a]: javascript:alert(1)\n  [b]:  DATA:text/html,x", attachments: [] }] }));
    expect(md).not.toMatch(/^\s*\[[^\]]*\]:\s*(javascript|data):/im);
  });
});

describe("O3 memory list", () => {
  it("writes one memory per line with a provider tag", () => {
    const text = toMemoryList(archive({ memories: [{ provider: "chatgpt", text: "Prefers metric units." }, { provider: "claude", text: "Line one\n- Line two\n# three" }] }));
    expect(text).toBe("# foxcache memories, exported 2026-10-15T00:00:00.000Z\n- [chatgpt] Prefers metric units.\n- [claude] Line one - Line two # three\n");
  });
});

describe("O4 zip", () => {
  it("writes a zip that unzip accepts, with the Markdown names", () => {
    const files = markdownFiles(archive({ conversations: [conv(), conv({ id: "2", title: "Ünïcödé" })] }));
    const dir = mkdtempSync(join(tmpdir(), "fca-zip-"));
    const path = join(dir, "out.zip");
    writeFileSync(path, zip(files));
    expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toMatch(/No errors detected/);
    expect(execFileSync("unzip", ["-p", path, files[0]!.path], { encoding: "utf8" })).toBe(files[0]!.text);
  });
  it("refuses an unsafe or repeated name", () => {
    expect(() => zip([{ path: "../x.md", text: "x" }])).toThrow(/unsafe/);
    expect(() => zip([{ path: "a.md", text: "x" }, { path: "a.md", text: "y" }])).toThrow(/twice/);
  });
});
