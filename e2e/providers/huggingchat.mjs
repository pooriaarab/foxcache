// HuggingChat, captured from tests/fixtures/huggingchat.json at
// https://huggingface.co. The session cookies alone sign it in.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://huggingface.co/");
  await ask("capture:start", { provider: "huggingchat", fresh: true });
  const cp = await ended("huggingchat");
  check("HuggingChat capture is done", { status: "done", conversations: 3, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const titles = (await ask("archive:list", { kind: "conversations", provider: "huggingchat" })).map((c) => c.title).toSorted();
  check("the HuggingChat chats are in the archive", ["<b>Hostile</b> title", "Lisbon pastry", "New chat"], titles);
  await tab.close();
}
