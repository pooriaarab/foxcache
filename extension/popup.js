// The popup: one card per provider with its state, the progress of a
// capture, and Capture, Stop or Resume. Text goes in with textContent only.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxcache did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);
const HUES = { chatgpt: 160, claude: 40, mistral: 25, deepseek: 250 };
const STATES = {
  "no-permission": ["Not allowed", ""],
  "no-tab": ["No tab open", ""],
  "signed-out": ["Signed out", "bad"],
  ready: ["Ready", "ok"],
  running: ["Capturing", "ask"],
  error: ["Error", "bad"],
};
let providers = [];

function make(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function button(text, className, onClick) {
  const b = make("button", `small ${className}`.trim(), text);
  b.addEventListener("click", async () => {
    b.disabled = true;
    try {
      await onClick();
    } catch (error) {
      show(error.message);
    }
    await load();
  });
  return b;
}

/** "12 conversations, 1 project, 3 memories" from checkpoint counts. */
function summary(counts) {
  const parts = [
    [counts.conversations, "conversation"],
    [counts.projects, "project"],
    [counts.memories, "memory", "memories"],
    [counts.preferences, "preference"],
  ]
    .filter(([n]) => n > 0)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : (many ?? `${one}s`)}`);
  const extra = [counts.skipped ? `${counts.skipped} unchanged` : "", counts.errors ? `${counts.errors} could not be read` : ""].filter(Boolean);
  return [parts.join(", ") || "nothing new", ...extra].join(" · ");
}

function detail(p) {
  const host = new URL(p.origin).host;
  const cp = p.checkpoint;
  if (p.state === "no-permission") return [`foxcache may not read ${host} yet.`];
  if (p.state === "no-tab") return [`Open ${host} in a tab and sign in.`];
  if (p.state === "signed-out") return [`Sign in on ${host}, then open this again.`, "bad"];
  if (p.state === "error") return [p.error, "bad"];
  if (!cp) return ["Not captured yet."];
  const when = new Date(cp.updatedAt).toLocaleString();
  if (cp.status === "running") return [`${summary(cp.counts)} so far`];
  if (cp.status === "done") return [`Captured ${when}: ${summary(cp.counts)}.`];
  if (cp.status === "stopped") return [`Stopped ${when} after ${summary(cp.counts)}. Resume goes on from there.`];
  if (cp.status === "interrupted") return [`The tab closed or reloaded during the capture (${summary(cp.counts)}). Resume goes on from there.`];
  return [`The capture stopped: ${cp.error?.message ?? "unknown error"}`, "bad"];
}

function card(p) {
  const [label, tone] = STATES[p.state] ?? [p.state, ""];
  const node = make("div", "provider");
  node.dataset.provider = p.id;
  node.dataset.state = p.state;
  const icon = make("span", "site-icon", p.label[0]);
  icon.style.setProperty("--hue", HUES[p.id] ?? 40);
  const chip = make("span", "chip");
  chip.append(make("span", `dot ${tone}`), document.createTextNode(label));
  const head = make("div", "head");
  head.append(icon, make("span", "name", p.label), chip);
  const [text, bad] = detail(p);
  const info = make("p", `detail${bad ? " bad" : ""}`, text);
  const actions = make("div", "actions");
  const resumable = ["stopped", "failed", "interrupted"].includes(p.checkpoint?.status);
  if (p.state === "no-permission") actions.append(button("Allow", "primary", () => browser.permissions.request({ origins: [`${p.origin}/*`] })));
  if (p.state === "no-tab") {
    const open = make("a", "", `Open ${new URL(p.origin).host}`);
    open.href = p.origin;
    open.target = "_blank";
    actions.append(open);
  }
  if (p.state === "ready") actions.append(button(resumable ? "Resume" : p.checkpoint ? "Capture again" : "Capture", "primary", () => ask("capture:start", { provider: p.id })));
  if (p.state === "running") actions.append(button("Stop", "danger", () => ask("capture:stop", { provider: p.id })));
  node.append(head, info);
  if (p.state === "running") {
    const bar = make("div", "bar");
    bar.append(make("i"));
    node.append(bar);
  }
  node.append(actions);
  return node;
}

function show(message) {
  const n = make("p", "detail bad", message);
  $("providers").prepend(n);
}

function render() {
  $("providers").replaceChildren(...providers.map(card));
}

async function load() {
  providers = await ask("providers:status");
  render();
}

// While a capture runs, poll only the checkpoints: that sends nothing to the provider.
setInterval(async () => {
  if (!providers.some((p) => p.state === "running")) return;
  const progress = await ask("capture:progress");
  providers = providers.map((p) => ({ ...p, checkpoint: progress[p.id] ?? p.checkpoint }));
  // A capture ended: ask for the full state once.
  if (providers.some((p) => p.state === "running" && p.checkpoint?.status !== "running")) await load();
  else render();
}, 1000);

load().catch((error) => show(error.message));
