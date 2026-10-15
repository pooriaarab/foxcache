// The archive page: browse and search what foxcache captured, by provider
// and kind, read one conversation, and export. Every text from a provider
// goes in with textContent, so a message with HTML in it shows as text (X6).
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxcache did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const LABELS = { chatgpt: "ChatGPT", claude: "Claude", mistral: "Le Chat", gemini: "Gemini", perplexity: "Perplexity", grok: "Grok", deepseek: "DeepSeek" };
function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const day = (iso) => (iso ? iso.slice(0, 10) : "");

/** One row of the list. A click shows the record below. */
function row(title, meta, onOpen) {
  const item = make("button", "item");
  item.append(make("span", "title", title || "Untitled"), make("span", "meta", meta));
  item.addEventListener("click", onOpen);
  return item;
}

function showConversation(c) {
  const d = $("detail");
  const head = make("div", "head");
  head.append(make("h2", "", c.title || "Untitled"), make("p", "hint", `${LABELS[c.provider]} · ${c.model ?? "model not given"} · updated ${new Date(c.updatedAt).toLocaleString()}`));
  const messages = c.messages.map((m) => {
    const box = make("div", `message ${m.role}`);
    box.append(make("div", "role", m.role === "user" ? "You" : m.role[0].toUpperCase() + m.role.slice(1)), make("div", "text", m.text));
    if (m.attachments.length) box.append(make("div", "hint", `Attachments: ${m.attachments.map((a) => a.name).join(", ")}`));
    return box;
  });
  d.replaceChildren(head, ...messages);
  d.hidden = false;
  d.scrollIntoView({ block: "start" });
}

function showRecord(kind, r) {
  const d = $("detail");
  const body = make("div");
  if (kind === "projects") {
    body.append(make("h2", "", r.name), make("p", "hint", `${LABELS[r.provider]} project`), make("div", "text", r.instructions ?? "No instructions."));
    if (r.files.length) body.append(make("p", "hint", `Files: ${r.files.map((f) => f.name).join(", ")}`));
  } else body.append(make("h2", "", `${LABELS[r.provider]} ${kind === "preferences" ? r.kind : kind.replace(/s$/, "")}`), make("div", "text", r.text ?? r.name));
  d.replaceChildren(body);
  d.hidden = false;
}

async function open(kind, key) {
  const r = await ask("archive:get", { kind, key });
  if (kind === "conversations") showConversation(r);
  else showRecord(kind, r);
}

async function render() {
  const provider = $("provider").value;
  const kind = $("kind").value;
  const query = $("query").value.trim();
  $("detail").hidden = true;
  let rows;
  if (query) {
    const hits = await ask("archive:search", { query, provider, kind });
    rows = hits.map((h) => row(h.title, `${LABELS[h.provider]} · ${h.snippet}`, () => open(h.kind, h.key)));
  } else if (kind === "conversations") {
    const list = await ask("archive:list", { kind, provider });
    rows = list.map((c) => row(c.title, `${LABELS[c.provider]} · ${day(c.updatedAt)} · ${c.messages} message${c.messages === 1 ? "" : "s"}`, () => open(kind, `${c.provider}:${c.id}`)));
  } else {
    const list = await ask("archive:list", { kind, provider });
    rows = list.map((r) => {
      const key = kind === "preferences" ? `${r.provider}:${r.kind}` : `${r.provider}:${r.id ?? ""}`;
      const title = r.name ?? r.text;
      return row(title, `${LABELS[r.provider]}${kind === "preferences" ? ` · ${r.kind}` : ""}`, () => (kind === "memories" && !r.id ? showRecord(kind, r) : open(kind, key)));
    });
  }
  $("list").replaceChildren(...(rows.length ? rows : [make("p", "empty", query ? "No match." : "Nothing here yet.")]));
}

async function counts() {
  const all = await ask("archive:counts");
  const ONE = { conversations: "conversation", projects: "project", memories: "memory", preferences: "preference", library: "library item" };
  const parts = Object.entries(all).map(([p, c]) => `${LABELS[p]}: ${Object.entries(c).map(([k, n]) => `${n} ${n === 1 ? ONE[k] : k === "library" ? "library items" : k}`).join(", ")}`);
  $("counts").textContent = parts.length ? parts.join(" · ") : "Nothing captured yet. Use the toolbar button to capture.";
  for (const p of Object.keys(all)) if (![...$("provider").options].some((o) => o.value === p)) $("provider").append(Object.assign(make("option", "", LABELS[p]), { value: p }));
}

/** Save a file through a link: no downloads permission needed. */
function save(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  $("status").textContent = `Saved ${name}.`;
}
const stamp = () => new Date().toISOString().slice(0, 10);
$("export-json").addEventListener("click", async () => save(`foxcache-archive-${stamp()}.json`, await ask("export:json"), "application/json"));
$("export-markdown").addEventListener("click", async () => save(`foxcache-markdown-${stamp()}.zip`, await ask("export:markdown"), "application/zip"));
$("export-memories").addEventListener("click", async () => save(`foxcache-memories-${stamp()}.md`, await ask("export:memories"), "text/markdown"));

let typing;
$("query").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(render, 250);
});
$("provider").addEventListener("change", render);
$("kind").addEventListener("change", render);
counts().then(render, (error) => ($("counts").textContent = error.message));
