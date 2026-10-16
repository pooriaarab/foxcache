// Grok, captured from tests/fixtures/grok.json at https://grok.com: two
// list pages, then each chat's tree and its load-responses POST.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://grok.com/");
  await ask("capture:start", { provider: "grok", fresh: true });
  const cp = await ended("grok");
  check("Grok capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const porto = await ask("archive:get", { kind: "conversations", key: "grok:6b0c0000-0000-4000-8000-000000000001" });
  check("the Grok chat keeps the branch of the newest answer", ["Plan a weekend in Porto", "Day 1: Ribeira. Day 2: Serralves."], porto?.messages.map((m) => m.text));
  await tab.close();
}
