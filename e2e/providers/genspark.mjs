// Genspark, captured from tests/fixtures/genspark.json at
// https://www.genspark.ai. Genspark deletes a project with a GET, so this
// check also looks at every path the capture sent there.
export async function run({ fox, net, ask, check, ended }) {
  const tab = await fox.open("https://www.genspark.ai/");
  await ask("capture:start", { provider: "genspark", fresh: true });
  const cp = await ended("genspark");
  check("Genspark capture is done", { status: "done", conversations: 3, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const paths = net.log.filter((l) => l.url.startsWith("https://www.genspark.ai/")).map((l) => new URL(l.url).pathname).filter((p) => p !== "/" && p !== "/favicon.ico");
  check("Genspark got only its three read paths, and no delete", ["/api/is_login", "/api/project", "/api/project/my"], [...new Set(paths)].toSorted());
  const gs = await ask("archive:get", { kind: "conversations", key: "genspark:6e5f0000-0000-4000-8000-000000000001" });
  check("a Genspark chat is stored without system and tool turns", [["user", "Two days in Porto?"], ["assistant", "Day 1: Ribeira. Day 2: Foz."]], gs.messages.map((m) => [m.role, m.text]));
  await tab.close();
}
