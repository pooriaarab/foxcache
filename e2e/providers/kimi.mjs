// Kimi, captured from tests/fixtures/kimi.json at https://www.kimi.com.
// The page keeps its bearer token in localStorage, so the check puts a
// synthetic one there first. Every read is a POST (docs/providers/kimi.md).
export async function run({ fox, ask, check, ended, net }) {
  const tab = await fox.open("https://www.kimi.com/");
  await tab.evaluate(() => localStorage.setItem("access_token", "synthetic-kimi-token"));
  await ask("capture:start", { provider: "kimi", fresh: true });
  const cp = await ended("kimi");
  check("Kimi capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  check("every Kimi request was a POST", [], net.log.filter((l) => new URL(l.url).host === "www.kimi.com" && new URL(l.url).pathname.startsWith("/apiv2/") && l.method !== "POST").map((l) => l.url));
  const list = await ask("archive:list", { kind: "conversations", provider: "kimi" });
  check("the Kimi chats are in the archive with the titles the user sees", ["Hanoi street food", "Notes"], list.map((c) => c.title).toSorted());
  const stored = await ask("archive:get", { kind: "conversations", key: `kimi:${list.find((c) => c.title === "Notes").id}` });
  check("a Kimi chat keeps the newest branch and parses microsecond times in Firefox", { texts: ["Where to eat in Hanoi?", "Try bún chả in the Old Quarter.\n\nGo early."], createdAt: "2026-09-02T07:59:00.123Z" }, { texts: stored.messages.map((m) => m.text), createdAt: stored.createdAt });
  await tab.close();
}
