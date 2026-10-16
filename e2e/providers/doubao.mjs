// Doubao, captured from tests/fixtures/doubao.json at https://www.doubao.com.
// Cookies only. Every read is an IM POST with the page's query
// (docs/providers/doubao.md).
export async function run({ fox, ask, check, ended, net }) {
  const tab = await fox.open("https://www.doubao.com/");
  await ask("capture:start", { provider: "doubao", fresh: true });
  const cp = await ended("doubao");
  check("Doubao capture is done", { status: "done", conversations: 2, errors: 0 }, { status: cp.status, conversations: cp.counts.conversations, errors: cp.counts.errors });
  const im = net.log.filter((l) => new URL(l.url).host === "www.doubao.com" && new URL(l.url).pathname.startsWith("/im/"));
  check("every Doubao read was a POST with the page's query", { methods: ["POST"], aid: ["497858"] }, { methods: [...new Set(im.map((l) => l.method))], aid: [...new Set(im.map((l) => new URL(l.url).searchParams.get("aid")))] });
  const list = await ask("archive:list", { kind: "conversations", provider: "doubao" });
  check("the Doubao chats are in the archive with the titles the user sees", ["Notes", "周末去杭州"], list.map((c) => c.title).toSorted());
  const stored = await ask("archive:get", { kind: "conversations", key: `doubao:${list.find((c) => c.title === "Notes").id}` });
  check("a Doubao chat reads every text shape, oldest first", ["周末去杭州玩两天？", "两天够了。", "<img src=x onerror=alert(1)>", "西湖边走走，\n\n再去灵隐寺。"], stored.messages.map((m) => m.text));
  await tab.close();
}
