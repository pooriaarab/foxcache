// Poe, captured from tests/fixtures/poe.json at https://poe.com. The page
// carries an inline script that sets a formkey function, as poe.com does,
// so the agent finds it and calls it in the page through wrappedJSObject.
// A __NEXT_DATA__ block ahead of it quotes the pattern, as a bot's text
// can; the agent must not read it (H31).
// The fixture's one POST answer holds the list and the chat (BiDi shows no
// POST body).
const ORIGIN = "https://poe.com";
const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>poe.com (fixture)</title>
<script id="__NEXT_DATA__" type="application/json">{"bot":{"description":"window.print=function(){return window"}}</script>
<script>window._a="0123456789abcdef";window._b="0123456789abcdef-synthetic";window.qX7pLm2Rd=function(){return window._a+window._b};</script>
</head><body><p>A fixture page for poe.com.</p></body></html>`;

export async function run({ fox, net, ask, check, ended }) {
  net.override(ORIGIN, "/", () => ({ status: 200, body: PAGE, type: "text/html" }));
  const tab = await fox.open(`${ORIGIN}/`);
  await ask("capture:start", { provider: "poe", fresh: true });
  const cp = await ended("poe");
  check("Poe capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors, error: cp.error });
  const chats = await ask("archive:list", { kind: "conversations", provider: "poe" });
  check("the Poe chats are in the archive with their titles, hostile text as text", ["<img src=x onerror=alert(1)> recipe", "Lisbon in three days"], chats.map((c) => c.title).toSorted());
  check("every Poe request was the page or a POST to /api/gql_POST", [], net.log.filter((l) => l.url.startsWith(ORIGIN) && !(l.method === "POST" && new URL(l.url).pathname === "/api/gql_POST") && !["/", "/favicon.ico"].includes(new URL(l.url).pathname)).map((l) => `${l.method} ${l.url}`));
  await tab.close();
}
