// Meta AI, captured from tests/fixtures/meta.json at https://www.meta.ai.
// The fixture's one POST answer holds the list and the chat (BiDi shows no
// POST body).
const ORIGIN = "https://www.meta.ai";

export async function run({ fox, net, ask, check, ended }) {
  const tab = await fox.open(`${ORIGIN}/`);
  await ask("capture:start", { provider: "meta", fresh: true });
  const cp = await ended("meta");
  check("Meta AI capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors, error: cp.error });
  const chats = await ask("archive:list", { kind: "conversations", provider: "meta" });
  check("the Meta AI chats are in the archive with their titles, hostile text as text", ["<script>alert(1)</script> soup", "Porto weekend"], chats.map((c) => c.title).toSorted());
  check("every Meta AI request was the page or a POST to /api/graphql", [], net.log.filter((l) => l.url.startsWith(ORIGIN) && !(l.method === "POST" && new URL(l.url).pathname === "/api/graphql") && !["/", "/favicon.ico"].includes(new URL(l.url).pathname)).map((l) => `${l.method} ${l.url}`));
  await tab.close();
}
