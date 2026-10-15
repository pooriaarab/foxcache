// The Firefox E2E test. It serves the synthetic fixtures at the real
// provider origins (https://chatgpt.com, https://claude.ai) through WebDriver
// BiDi network interception, so the real origin matching, permission checks
// and same-origin fetches run. It installs dist-e2e/ (origins granted at
// install) and two stand-in extensions from e2e/scent-ext/: one with the id
// foxscope@pooriaarab, one with another id. Then it:
//   captures ChatGPT and Claude from the popup, with a 429 on the way;
//   stops and resumes a capture, and resumes one after its tab closed;
//   checks that every request to a provider was a GET;
//   browses and searches the archive page, and opens a hostile message;
//   checks the exports, and imports the archive with the CLI;
//   asks for SCENT values as foxscope and as another extension;
//   deletes everything from the settings page.
// Writes artifacts/e2e-<date>.json after the checks.
// Usage: pnpm e2e [--headed]. Env: FIREFOX, or FOXKIT_BROWSER=ichabod with ICHABOD_API_KEY.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32 } from "node:zlib";
import { browserMode, launch, writeArtifact } from "create-foxkit/e2e";
import { serveFixtures } from "./intercept.mjs";

const record = { startedAt: new Date().toISOString(), mode: browserMode(), path: "fixtures at the real provider origins through WebDriver BiDi network interception", checks: [] };
const check = (name, expected, actual) => record.checks.push({ name, expected, actual, ok: JSON.stringify(actual) === JSON.stringify(expected) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STUBS = { foxscope: "foxscope@pooriaarab", intruder: "intruder@foxcache.test" };
const ABSENT = "Could not establish connection. Receiving end does not exist.";
const A = "6710aa00-1111-4222-8333-444455556666";
const CHATGPT = "https://chatgpt.com";
const MAIN_LIST = "/backend-api/conversations?offset=0&limit=100&order=updated&is_archived=false&hide_snorlax=true";

/** A stand-in extension directory for one role. MV2, so its content script needs no host grant. */
function stub(role) {
  const dir = mkdtempSync(join(tmpdir(), `fca-${role}-`));
  for (const f of readdirSync("e2e/scent-ext")) writeFileSync(join(dir, f), readFileSync(join("e2e/scent-ext", f)));
  const manifest = {
    manifest_version: 2, name: role, version: "1.0",
    browser_specific_settings: { gecko: { id: STUBS[role] } },
    background: { scripts: ["background.js"] },
    content_scripts: [{ matches: ["https://chatgpt.com/*"], js: ["content.js"] }],
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return dir;
}

const head = (sig, size) => {
  const b = Buffer.alloc(size);
  b.writeUInt32LE(sig, 0);
  return b;
};
/** A stored (not deflated) zip of a flat directory, for webExtension.install on Ichabod. */
function zipDir(dir) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const name of readdirSync(dir)) {
    const data = readFileSync(join(dir, name));
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = head(0x02014b50, 46);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    local.copy(entry, 8, 6, 30);
    entry.writeUInt32LE(offset, 42);
    parts.push(local, Buffer.from(name), data);
    central.push(entry, Buffer.from(name));
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(size, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
async function install(fox, dir) {
  if (browserMode() === "local") return fox.browser.installExtension(dir);
  // Puppeteer types connection for CDP only; on BiDi it sends raw BiDi commands.
  return fox.browser.connection.send("webExtension.install", { extensionData: { type: "base64", value: zipDir(dir).toString("base64") } });
}

async function until(label, fn, ms = 60_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await sleep(500);
  }
}

/** Ask a stand-in to send a message to an extension id, from the test page. */
const scent = (page, role, msg, to = "foxcache@pooriaarab") =>
  page.evaluate(
    (r, m, t) =>
      new Promise((done) => {
        const id = Math.random().toString(36).slice(2);
        const onReply = (e) => {
          if (e.data?.fca !== "scent-reply" || e.data.id !== id) return;
          window.removeEventListener("message", onReply);
          done(e.data.result);
        };
        window.addEventListener("message", onReply);
        window.postMessage({ fca: "scent", role: r, id, msg: m, to: t }, "*");
      }),
    role,
    msg,
    to,
  );

let fox;
try {
  fox = await launch({ extension: "dist-e2e", headless: !process.argv.includes("--headed") });
  record.firefox = await fox.browser.version();
  for (const role of Object.keys(STUBS)) await install(fox, stub(role));
  const net = await serveFixtures(fox.browser.connection, ["chatgpt", "claude"]);
  // The first read of conversation A answers 429 with Retry-After: 2 (C3).
  net.override(CHATGPT, `/backend-api/conversation/${A}`, (n) => (n === 1 ? { status: 429, body: "{}", headers: { "retry-after": "2" } } : undefined));

  let chat = await fox.open(`${CHATGPT}/`);
  await fox.open("https://claude.ai/");
  let popup = await fox.openExtensionPage("popup.html");
  const ask = async (type, data = {}) => {
    const reply = await popup.evaluate((m) => browser.runtime.sendMessage(m), { type, ...data });
    if (!reply?.ok) throw new Error(`${type}: ${reply?.error}`);
    return reply.value;
  };
  const states = () => popup.evaluate(() => Object.fromEntries([...document.querySelectorAll(".provider")].map((p) => [p.dataset.provider, p.dataset.state])));
  const click = (provider, label) =>
    until(`the ${label} button of ${provider}`, () =>
      popup.evaluate(
        (p, l) => {
          const b = [...document.querySelectorAll(`.provider[data-provider="${p}"] .actions button`)].find((x) => x.textContent === l && !x.disabled);
          b?.click();
          return Boolean(b);
        },
        provider,
        label,
      ),
    );
  const ended = (provider) => until(`the ${provider} capture ends`, async () => {
    const cp = (await ask("capture:progress"))[provider];
    return cp && cp.status !== "running" ? cp : null;
  }, 240_000);
  const running = (provider) => until(`the ${provider} capture runs`, async () => (await ask("capture:progress"))[provider]?.status === "running");

  // 1. The popup shows each site's state (X2, X3).
  check("popup states", { chatgpt: "ready", claude: "ready", mistral: "no-tab", deepseek: "no-permission" }, await until("four provider cards", async () => {
    const s = await states();
    return Object.keys(s).length === 4 && !Object.values(s).includes(undefined) ? s : null;
  }));

  // 2. Capture ChatGPT, with one 429 on the way, and Claude.
  await click("chatgpt", "Capture");
  await running("chatgpt");
  let cp = await ended("chatgpt");
  check("ChatGPT capture is done", { status: "done", conversations: 3, projects: 1, memories: 2, preferences: 4, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, projects: cp.counts.projects, memories: cp.counts.memories, preferences: cp.counts.preferences, errors: cp.counts.errors });
  check("the 429 was waited out and retried", [429, 200], net.log.filter((l) => l.url.endsWith(`/conversation/${A}`)).map((l) => l.status));
  await click("claude", "Capture");
  await running("claude");
  cp = await ended("claude");
  check("Claude capture is done", { status: "done", conversations: 2, projects: 1, memories: 3, preferences: 1, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, projects: cp.counts.projects, memories: cp.counts.memories, preferences: cp.counts.preferences, errors: cp.counts.errors });
  check("the popup says what was captured", true, await until("the Claude summary", () => popup.evaluate(() => document.querySelector('.provider[data-provider="claude"] .detail')?.textContent.startsWith("Captured"))));

  // 3. Stop, then Resume (C6, C7). A changed conversation gives the capture work to do.
  const bumpList = (time) => {
    const list = structuredClone(net.fixture("chatgpt").routes[MAIN_LIST]);
    list.items[0].update_time = time;
    net.override(CHATGPT, MAIN_LIST, () => ({ status: 200, body: JSON.stringify(list) }));
  };
  bumpList("2026-10-20T00:00:00.000Z");
  await click("chatgpt", "Capture again");
  await running("chatgpt");
  await click("chatgpt", "Stop");
  cp = await ended("chatgpt");
  check("Stop ends the capture", "stopped", cp.status);
  check("a stopped capture offers Start over and Resume", ["Start over", "Resume"], await until("the stopped card", async () => {
    const labels = await popup.evaluate(() => [...document.querySelectorAll('.provider[data-provider="chatgpt"] .actions button')].map((b) => b.textContent));
    return labels.includes("Resume") ? labels : null;
  }));
  await click("chatgpt", "Resume");
  await running("chatgpt");
  cp = await ended("chatgpt");
  check("Resume finishes it and fetches the changed conversation", { status: "done", conversations: 1, skipped: 2 }, { status: cp.status, conversations: cp.counts.conversations, skipped: cp.counts.skipped });

  // 4. A closed tab interrupts the capture, and Resume goes on in a new tab (X4).
  bumpList("2026-10-21T00:00:00.000Z");
  await click("chatgpt", "Capture again");
  await running("chatgpt");
  await chat.close();
  cp = await ended("chatgpt");
  check("closing the tab interrupts the capture", "interrupted", cp.status);
  chat = await fox.open(`${CHATGPT}/`);
  popup = await fox.openExtensionPage("popup.html");
  check("the popup offers Resume after the closed tab", true, await until("the interrupted note", () => popup.evaluate(() => /tab closed/.test(document.querySelector('.provider[data-provider="chatgpt"] .detail')?.textContent ?? ""))));
  await click("chatgpt", "Resume");
  await running("chatgpt");
  cp = await ended("chatgpt");
  check("the resumed capture is done", "done", cp.status);
  const stored = await ask("archive:get", { kind: "conversations", key: `chatgpt:${A}` });
  check("the stored conversation has the newest time", "2026-10-21T00:00:00.000Z", stored.updatedAt);

  // 5. foxcache only read: every request to a provider was a GET (X5).
  check("every request to a provider was a GET", [], net.log.filter((l) => l.method !== "GET").map((l) => `${l.method} ${l.url}`));
  check("no request went to a path the fixtures do not know", [], net.log.filter((l) => l.status === 404 && !l.url.endsWith("/favicon.ico")).map((l) => l.url));
  record.requests = net.log.length;

  // 6. The archive page lists, searches and shows hostile text as text (X6).
  const archive = await fox.openExtensionPage("archive.html");
  const titles = () => archive.evaluate(() => [...document.querySelectorAll("#list .item .title")].map((t) => t.textContent));
  check("the archive lists five conversations", ["<b>Hostile</b> title", "Old archived chat", "Project chat", "Trip plan", "Trip planning"], (await until("five items", async () => ((await titles()).length === 5 ? titles() : null))).toSorted());
  await archive.type("#query", "Alfama");
  check("search finds both Alfama chats", ["Trip plan", "Trip planning"], (await until("two hits", async () => ((await titles()).length === 2 ? titles() : null))).toSorted());
  await archive.evaluate(() => {
    document.getElementById("query").value = "";
    document.getElementById("query").dispatchEvent(new Event("input"));
  });
  await until("the list again", async () => (await titles()).length === 5);
  await archive.evaluate(() => [...document.querySelectorAll("#list .item")].find((b) => b.textContent.includes("Hostile")).click());
  const hostile = await until("the hostile chat", () => archive.evaluate(() => {
    const d = document.getElementById("detail");
    return d.hidden ? null : { elements: d.querySelectorAll("img, script, b").length, text: d.textContent.includes('<img src=x onerror="document.title'), title: document.title };
  }));
  check("hostile HTML shows as text and runs nothing", { elements: 0, text: true, title: "foxcache archive" }, hostile);

  // 7. Exports, and the CLI reads the archive file.
  const json = JSON.parse(await ask("export:json"));
  check("the JSON export is a foxcache/v1 archive with every record", { schema: "foxcache/v1", conversations: 5, projects: 2, memories: 5, preferences: 5 }, { schema: json.schema, conversations: json.conversations.length, projects: json.projects.length, memories: json.memories.length, preferences: json.preferences.length });
  check("the JSON export has no raw provider fields", false, /"mapping"|"chat_messages"|"extracted_content"|accessToken/.test(JSON.stringify(json)));
  const memories = await ask("export:memories");
  check("the memory list has one line per memory", 5, memories.split("\n").filter((l) => /^- \[(chatgpt|claude)\] /.test(l)).length);
  const zipInfo = await popup.evaluate(async () => {
    const z = (await browser.runtime.sendMessage({ type: "export:markdown" })).value;
    return { pk: String.fromCharCode(z[0], z[1]), names: [...new TextDecoder().decode(z).matchAll(/(chatgpt|claude)\/[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\.md/g)].map((m) => m[0]) };
  });
  check("the Markdown zip has one file per conversation", { pk: "PK", files: 5 }, { pk: zipInfo.pk, files: new Set(zipInfo.names).size });
  const home = mkdtempSync(join(tmpdir(), "fca-e2e-home-"));
  const file = join(home, "foxcache-archive.json");
  writeFileSync(file, JSON.stringify(json));
  const env = { ...process.env, FOXCACHE_HOME: join(home, "store") };
  check("foxcache import reads the exported file", "Imported 17 new, 0 updated, 0 unchanged records.\n", execFileSync("node", ["dist/bin.js", "import", file], { env, encoding: "utf8" }));
  check("foxcache search finds a captured message", true, execFileSync("node", ["dist/bin.js", "search", "Belem"], { env, encoding: "utf8" }).includes("Day 2: Belem."));

  // 8. SCENT: foxscope gets the ask fields and never conversations; any other extension gets nothing (SC1-SC3, X1).
  await until("the stand-ins are ready", () => chat.evaluate(() => document.documentElement.dataset.foxscope === "ready" && document.documentElement.dataset.intruder === "ready"));
  const list = await scent(chat, "foxscope", { type: "scent.list" });
  check("foxscope lists the cache fields", [["cache.memories", "ask"], ["cache.preferences", "ask"], ["cache.projects", "ask"], ["cache.conversations", "private"]], list.value?.map((f) => [f.name, f.sensitivity]));
  const read = await scent(chat, "foxscope", { type: "scent.read", fields: ["cache.memories", "cache.preferences", "cache.projects", "cache.conversations"], derive: false });
  check("foxscope reads memories, preferences and project names, and no conversations", { keys: ["cache.memories", "cache.preferences", "cache.projects"], memories: 5, projects: [{ provider: "chatgpt", name: "Research" }, { provider: "claude", name: "Thesis" }] }, { keys: Object.keys(read.value ?? {}).toSorted(), memories: read.value?.["cache.memories"]?.length, projects: read.value?.["cache.projects"]?.toSorted((a, b) => a.provider.localeCompare(b.provider)) });
  check("the SCENT reply holds no conversation text", false, JSON.stringify(read).includes("Alfama"));
  const absent = await scent(chat, "intruder", { type: "scent.list" }, "nobody@foxcache.test");
  check("an add-on that is not installed gives Firefox's error", { sent: false, error: ABSENT }, absent);
  check("another extension gets the same as an add-on that is not installed", absent, await scent(chat, "intruder", { type: "scent.list" }));
  check("another extension cannot read through scent.read", absent, await scent(chat, "intruder", { type: "scent.read", fields: ["cache.memories"], derive: false }));
  check("another extension cannot use the page messages", absent, await scent(chat, "intruder", { type: "export:json" }));

  // 9. Delete all from the settings page.
  const settings = await fox.openExtensionPage("settings.html");
  await until("the sites", () => settings.evaluate(() => document.querySelectorAll("#sites label").length === 4));
  await settings.click("#delete");
  await settings.click("#delete");
  check("the settings page deletes everything", "Deleted. foxcache holds nothing now.", await until("the delete note", () => settings.evaluate(() => document.getElementById("status").textContent)));
  check("the store is empty after delete all", {}, await ask("archive:counts"));
} catch (error) {
  record.error = error instanceof Error ? error.message : String(error);
} finally {
  await fox?.close();
}

record.passed = !record.error && record.checks.length > 0 && record.checks.every((c) => c.ok);
const path = writeArtifact("artifacts", "e2e", record);
for (const c of record.checks) console.log(`${c.ok ? "ok " : "BAD"} ${c.name}: ${JSON.stringify(c.actual)}`);
console.log(`${record.passed ? "PASS" : "FAIL"} ${record.checks.filter((c) => c.ok).length}/${record.checks.length}${record.error ? `: ${record.error}` : ""} | ${path}`);
process.exitCode = record.passed ? 0 : 1;
