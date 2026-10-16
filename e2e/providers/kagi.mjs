// Kagi Assistant, captured from tests/fixtures/kagi.json at https://assistant.kagi.com.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://assistant.kagi.com/");
  await ask("capture:start", { provider: "kagi", fresh: true });
  const cp = await ended("kagi");
  check("Kagi Assistant capture is done", { status: "done", conversations: 2, preferences: 1, library: 1, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, preferences: cp.counts.preferences, library: cp.counts.library, errors: cp.counts.errors });
  const list = await ask("archive:list", { kind: "conversations", provider: "kagi" });
  check("the Kagi chats are in the archive with their titles", ["<b>Hostile</b> thread", "Trip to Porto"], list.map((c) => c.title).toSorted());
  const porto = await ask("archive:get", { kind: "conversations", key: "kagi:77ec0000-0000-4000-8000-000000000001" });
  check("a Kagi chat keeps the Markdown text and Firefox reads the microsecond times", { last: "Day 2: Foz.", updatedAt: "2026-09-05T08:03:00.654Z" }, { last: porto.messages.at(-1).text, updatedAt: porto.updatedAt });
  await tab.close();
}
