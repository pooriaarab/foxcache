// The demo popup. It shows that the event page answers; the real popup replaces it.
browser.runtime.sendMessage({ type: "providers:status" }).then((reply) => {
  document.getElementById("value").textContent = reply?.ok ? `${reply.value.length} providers` : "no answer";
});
