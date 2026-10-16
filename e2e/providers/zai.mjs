// Z.ai, captured from tests/fixtures/zai.json at https://chat.z.ai.
// The page keeps its bearer in localStorage "token", so the check puts a
// synthetic one there first, as a sign-in would.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://chat.z.ai/");
  await tab.evaluate(() => localStorage.setItem("token", "synthetic-zai-token"));
  await ask("capture:start", { provider: "zai", fresh: true });
  const cp = await ended("zai");
  check("Z.ai capture is done", { status: "done", conversations: 2, preferences: 1, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, preferences: cp.counts.preferences, errors: cp.counts.errors });
  const titles = (await ask("archive:list", { kind: "conversations", provider: "zai" })).map((c) => c.title).toSorted();
  check("the Z.ai chats are in the archive", ["<b>Hostile</b> title", "Lisbon tram"], titles);
  await tab.close();
}
