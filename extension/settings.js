// The settings page: allow or remove each provider origin, and delete all.
const ask = async (type, data = {}) => {
  const reply = await browser.runtime.sendMessage({ type, ...data });
  if (!reply?.ok) throw new Error(reply?.error ?? "foxcache did not answer.");
  return reply.value;
};
const $ = (id) => document.getElementById(id);

async function site(p) {
  const origins = [`${p.origin}/*`];
  const label = document.createElement("label");
  label.className = "switch";
  label.dataset.provider = p.id;
  const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: await browser.permissions.contains({ origins }) });
  const text = document.createElement("span");
  text.textContent = `${p.label} (${new URL(p.origin).host})`;
  // permissions.request must run in the click, so it comes first.
  box.addEventListener("change", async () => {
    const want = box.checked;
    const ok = want ? await browser.permissions.request({ origins }) : await browser.permissions.remove({ origins });
    box.checked = want ? ok : !ok;
  });
  label.append(box, text);
  return label;
}

ask("providers:status")
  .then(async (providers) => $("sites").replaceChildren(...(await Promise.all(providers.map(site)))))
  .catch((error) => ($("status").textContent = error.message));

let armed;
$("delete").addEventListener("click", async () => {
  if (!armed) {
    $("delete").textContent = "Click again to delete everything";
    armed = setTimeout(() => {
      armed = undefined;
      $("delete").textContent = "Delete all captured data";
    }, 5000);
    return;
  }
  clearTimeout(armed);
  armed = undefined;
  await ask("data:delete-all");
  $("delete").textContent = "Delete all captured data";
  $("status").textContent = "Deleted. foxcache holds nothing now.";
});
