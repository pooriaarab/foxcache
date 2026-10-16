// GitHub Copilot, captured from tests/fixtures/github-copilot.json: a tab
// at https://github.com with the page's cached token in localStorage, and
// reads from https://api.individual.githubcopilot.com, which answers CORS
// for the page as the real API does.
export async function run({ fox, net, ask, check, ended }) {
  const tab = await fox.open("https://github.com/");
  await tab.evaluate(() => localStorage.setItem("COPILOT_AUTH_TOKEN", JSON.stringify({ value: "synthetic-copilot-token", expiration: "2099-01-01T00:00:00Z" })));
  await ask("capture:start", { provider: "github-copilot", fresh: true });
  const cp = await ended("github-copilot");
  check("GitHub Copilot capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const reads = net.log.filter((l) => new URL(l.url).host === "api.individual.githubcopilot.com" && l.method === "GET");
  check("the Copilot reads went to the API host with the github.com Origin", { origins: ["https://github.com"], count: 4 }, { origins: [...new Set(reads.map((l) => l.origin))], count: reads.length });
  const thread = await ask("archive:get", { kind: "conversations", key: "github-copilot:5c0d0000-0000-4000-8000-000000000001" });
  check("the Copilot thread is in the archive", ["Why does this test fail on CI only?", "It depends on the time zone. Set TZ=UTC."], thread?.messages.map((m) => m.text));
  await tab.close();
}
