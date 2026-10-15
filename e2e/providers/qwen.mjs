// Qwen Chat, captured from tests/fixtures/qwen.json at https://chat.qwen.ai.
// The page keeps its bearer in localStorage "token", so the check puts a
// synthetic one there first, as a sign-in would.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://chat.qwen.ai/");
  await tab.evaluate(() => localStorage.setItem("token", "synthetic-qwen-token"));
  await ask("capture:start", { provider: "qwen", fresh: true });
  const cp = await ended("qwen");
  check("Qwen Chat capture is done", { status: "done", conversations: 4, projects: 1, memories: 2, preferences: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, projects: cp.counts.projects, memories: cp.counts.memories, preferences: cp.counts.preferences, errors: cp.counts.errors });
  const titles = (await ask("archive:list", { kind: "conversations", provider: "qwen" })).map((c) => c.title).toSorted();
  check("the Qwen Chat chats are in the archive, a project chat with them", ["<b>Hostile</b> title", "Lisbon trip", "Packing list", "Pinned recipe"], titles);
  await tab.close();
}
