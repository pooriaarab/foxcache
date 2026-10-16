// The live smoke check, for the owner to run with their own logins. It
// starts Firefox on a temporary copy of a Firefox profile, so the sites see
// the sessions that profile has, installs dist-ext/ with the chosen origins
// granted, opens each site, captures it, and prints counts per provider and
// kind. It never prints a title, a message, an id or an error text: only
// states, counts and error codes. The copy is deleted at the end; the
// profile itself is never changed.
//
// Usage: close Firefox, then
//   pnpm build:ext
//   FOXCACHE_PROFILE=~/.mozilla/firefox/xxxx.default-release node e2e/live-smoke.mjs [--providers chatgpt,claude] [--limit 25] [--headed]
// --limit N stops each capture after N conversations (the default captures all).
// Env: FIREFOX, the Firefox binary.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import puppeteer from "puppeteer-core";
import { findFirefox, poll } from "create-foxkit/e2e";

const ORIGINS = { chatgpt: "https://chatgpt.com", claude: "https://claude.ai", mistral: "https://chat.mistral.ai", deepseek: "https://chat.deepseek.com", notion: "https://app.notion.com", kagi: "https://assistant.kagi.com" };
const { values: o } = parseArgs({ options: { providers: { type: "string", default: Object.keys(ORIGINS).join(",") }, limit: { type: "string" }, headed: { type: "boolean", default: false } } });
const providers = o.providers.split(",").filter(Boolean);
const limit = o.limit === undefined ? Infinity : Number(o.limit);
for (const p of providers) if (!ORIGINS[p]) throw new Error(`--providers: ${p} is not one of ${Object.keys(ORIGINS).join(", ")}`);
if (!(limit > 0)) throw new Error("--limit must be a number above 0");
const source = process.env.FOXCACHE_PROFILE;
if (!source || !existsSync(join(source, "prefs.js"))) throw new Error("Set FOXCACHE_PROFILE to a Firefox profile folder (it has prefs.js). about:profiles shows it.");
if (existsSync(join(source, "lock")) || existsSync(join(source, ".parentlock"))) console.log("note: the profile may be in use. Close Firefox first, or the copy can miss recent sign-ins.");
if (!existsSync("dist-ext/manifest.json")) throw new Error("Run pnpm build:ext first.");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "fca-live-profile-"));
const ext = mkdtempSync(join(tmpdir(), "fca-live-ext-"));
cpSync(source, profile, { recursive: true, filter: (p) => !/[\\/](lock|\.parentlock|parent\.lock)$/.test(p) });
cpSync("dist-ext", ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
manifest.host_permissions = providers.map((p) => `${ORIGINS[p]}/*`);
writeFileSync(join(ext, "manifest.json"), JSON.stringify(manifest));
const id = manifest.browser_specific_settings.gecko.id;
const uuid = randomUUID();

const counts = (c) => Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(", ") || "nothing";
let browser;
try {
  browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: findFirefox(),
    headless: !o.headed,
    userDataDir: profile,
    args: ["-remote-allow-system-access"],
    defaultViewport: null,
    extraPrefsFirefox: { "extensions.webextensions.uuids": JSON.stringify({ [id]: uuid }) },
  });
  await browser.installExtension(ext);
  for (const p of providers) await (await browser.newPage()).goto(`${ORIGINS[p]}/`, { waitUntil: "load", timeout: 60_000 }).catch(() => console.log(`${p}: the site did not load`));
  // BiDi sends no load event for a moz-extension: page, so poll for it, as create-foxkit does.
  const page = await browser.newPage();
  const url = `moz-extension://${uuid}/popup.html`;
  page.goto(url, { timeout: 0 }).catch(() => undefined);
  await poll(page, (u) => location.href === u && document.readyState === "complete", url, 30_000);
  const ask = async (type, data = {}) => {
    const reply = await page.evaluate((m) => browser.runtime.sendMessage(m), { type, ...data });
    if (!reply?.ok) throw new Error(`${type}: ${reply?.code ?? "error"}`);
    return reply.value;
  };
  const status = await ask("providers:status");
  for (const s of status.filter((x) => providers.includes(x.id))) {
    console.log(`${s.id}: ${s.state}`);
    if (s.state !== "ready") continue;
    await ask("capture:start", { provider: s.id });
    let cp;
    for (let stopped = false; ; await sleep(2000)) {
      cp = (await ask("capture:progress"))[s.id];
      if (cp?.status !== "running") break;
      if (!stopped && cp.counts.conversations >= limit) {
        await ask("capture:stop", { provider: s.id });
        stopped = true;
      }
    }
    const codes = [...new Set(cp.lastErrors.map((e) => e.split(": ")[1]))].join(", ");
    console.log(`${s.id}: ${cp.status}${cp.error ? ` (${cp.error.code})` : ""}: ${counts(cp.counts)}${codes ? `; error codes: ${codes}` : ""}`);
  }
  const stored = await ask("archive:counts");
  console.log("stored records:");
  for (const [p, c] of Object.entries(stored)) console.log(`  ${p}: ${counts(c)}`);
  const archive = JSON.parse(await ask("export:json"));
  console.log(`export: ${archive.schema}, ${archive.conversations.length} conversations, ${archive.memories.length} memories`);
} finally {
  await browser?.close().catch(() => undefined);
  rmSync(profile, { recursive: true, force: true });
  rmSync(ext, { recursive: true, force: true });
}
