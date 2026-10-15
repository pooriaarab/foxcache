// Perplexity, captured from tests/fixtures/perplexity.json at
// https://www.perplexity.ai: the pinned and main list POSTs, a thread paged
// by cursor, and the memory GraphQL POST.
export async function run({ fox, ask, check, ended }) {
  const tab = await fox.open("https://www.perplexity.ai/");
  await ask("capture:start", { provider: "perplexity", fresh: true });
  const cp = await ended("perplexity");
  check("Perplexity capture is done", { status: "done", conversations: 2, memories: 1, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, memories: cp.counts.memories, errors: cp.counts.errors });
  const trams = await ask("archive:get", { kind: "conversations", key: "perplexity:9e7a0000-0000-4000-8000-000000000001" });
  check("the Perplexity thread has both pages, the repeated entry once", ["Which tram goes to Belem?", "Tram **15E** goes to Belem.", "And back?", "Take the 15E back."], trams?.messages.map((m) => m.text));
  await tab.close();
}
