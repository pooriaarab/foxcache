// Notion AI, captured from tests/fixtures/notion.json at https://app.notion.com.
// Every read is a POST; the E2E then checks each one matched a read.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://app.notion.com/");
  await ask("capture:start", { provider: "notion", fresh: true });
  const cp = await ended("notion");
  check("Notion AI capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const list = await ask("archive:list", { kind: "conversations", provider: "notion" });
  check("the Notion AI chats are in the archive with their titles", ["<b>Hostile</b> notes", "Plan the offsite"], list.map((c) => c.title).toSorted());
  const offsite = await ask("archive:get", { kind: "conversations", key: `notion:${list.find((c) => c.title === "Plan the offsite").id}` });
  check("a Notion AI chat keeps the visible thread only", ["user", "assistant", "user", "assistant"], offsite.messages.map((m) => m.role));
  await tab.close();
}
