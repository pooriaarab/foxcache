// Le Chat, captured from tests/fixtures/mistral.json at https://chat.mistral.ai.
// e2e/run.mjs runs every file in e2e/providers/ after its own steps, with
// the fixtures of tests/fixtures/ served at their origins. This one is the
// example a new provider copies (docs/providers/ADDING.md).
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://chat.mistral.ai/");
  await ask("capture:start", { provider: "mistral", fresh: true });
  const cp = await ended("mistral");
  check("Le Chat capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const titles = (await ask("archive:list", { kind: "conversations", provider: "mistral" })).map((c) => c.title).toSorted();
  check("the Le Chat chats are in the archive with the titles the user sees", ["Kyoto in autumn", "My own title"], titles);
  await tab.close();
}
