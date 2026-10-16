// Gemini, captured from tests/fixtures/gemini.json at https://gemini.google.com.
// The page tokens come from the fixture's /app page, and every read is a
// batchexecute POST that the E2E answers by its rpcids and source-path.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://gemini.google.com/app");
  await ask("capture:start", { provider: "gemini", fresh: true });
  const cp = await ended("gemini");
  check("Gemini capture is done", { status: "done", conversations: 2, library: 1, memories: 1, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, library: cp.counts.library, memories: cp.counts.memories, errors: cp.counts.errors });
  const chats = await ask("archive:list", { kind: "conversations", provider: "gemini" });
  check("the Gemini chats are in the archive with their titles", ["<b>Hostile</b> title", "Lisbon in three days"], chats.map((c) => c.title).toSorted());
  const lisbon = await ask("archive:get", { kind: "conversations", key: "gemini:a1b2c3d4e5f60708" });
  check("a Gemini chat reads oldest first", ["Plan three days in Lisbon", "Day 1: Alfama. Day 2: Belem.", "And day 3?", "Day 3: Sintra."], lisbon.messages.map((m) => m.text));
  await tab.close();
}
