// The event page. It owns the store (IndexedDB), starts and stops captures,
// takes the records that the agent in a provider tab sends, answers the
// extension's own pages, and answers foxscope over onMessageExternal.
// Firefox unloads it when idle. Every capture state is in the store, so a
// wake loses nothing.
import { ADAPTERS, FoxcacheError, MAX_ARCHIVE_BYTES, adapterAt, adapterFor, answerScent, cacheResolver, check, createStore, markdownFiles, originsOf, recordKey, toArchive, toMemoryList, zip } from "../src/index.ts";
import { idbBackend } from "./idb.js";

export const store = createStore(idbBackend());
const resolver = cacheResolver(store);
const pattern = (adapter) => `${adapter.origin}/*`;
// A site is allowed only when its page and every API origin it reads are granted (X12).
const grants = (adapter) => originsOf(adapter).map((o) => `${o}/*`);
const allowed = (adapter) => browser.permissions.contains({ origins: grants(adapter) });
const RESUMABLE = new Set(["stopped", "failed", "interrupted"]);
const KEEP_KINDS = new Set(["projects", "memories", "preferences", "library"]);

// The capture of one provider: { tabId, startingUntil, checkpoint }, in the checkpoints area.
const captureOf = async (id) => (await store.checkpoint(id)) ?? null;
const saveCapture = (id, capture) => store.setCheckpoint(id, capture);
// Stop has its own key, so a checkpoint the agent saves cannot write over it.
const stopKey = (id) => `${id}:stop`;
const stopAsked = async (id) => (await store.backend.get("checkpoints", stopKey(id))) === true;

// Delete all counts up. A write that read the store before a delete all
// and wrote after it is removed again (X7, X9). `since` is the count before
// that read.
let generation = 0;
/** Save a capture that was read at `since`. False if a delete all came between: the capture is gone again. */
async function saveSince(id, capture, since) {
  await saveCapture(id, capture);
  if (generation === since) return true;
  await store.clearCheckpoint(id);
  return false;
}

async function interrupt(id, capture, since) {
  const checkpoint = { ...capture.checkpoint, status: "interrupted", updatedAt: new Date().toISOString() };
  await saveSince(id, { ...capture, checkpoint }, since);
  return checkpoint;
}

/** A "running" capture whose agent is gone (the tab closed or reloaded) is interrupted (X4). */
async function refresh(adapter) {
  const since = generation;
  const capture = await captureOf(adapter.id);
  if (capture?.checkpoint.status !== "running") return capture;
  // An agent that answers but runs nothing is dead, unless the capture just started.
  const starting = Date.now() < (capture.startingUntil ?? 0);
  const alive = await browser.tabs.sendMessage(capture.tabId, { type: "agent:ping" }).then((r) => r?.running === true || starting, () => false);
  return alive ? capture : { ...capture, checkpoint: await interrupt(adapter.id, capture, since) };
}

const providerTab = async (adapter) => {
  const tabs = await browser.tabs.query({ url: pattern(adapter) });
  return tabs.find((t) => t.active) ?? tabs[0];
};
const inject = (tabId) => browser.scripting.executeScript({ target: { tabId }, files: ["agent.js"] });

/** What the popup shows for one provider (X2, X3). */
async function status(adapter) {
  const capture = await refresh(adapter);
  const base = { id: adapter.id, label: adapter.label, origin: adapter.origin, origins: grants(adapter), checkpoint: capture?.checkpoint ?? null };
  if (!(await allowed(adapter))) return { ...base, state: "no-permission" };
  if (capture?.checkpoint.status === "running") return { ...base, state: "running" };
  const tab = await providerTab(adapter);
  if (!tab) return { ...base, state: "no-tab" };
  try {
    await inject(tab.id);
    const answer = await browser.tabs.sendMessage(tab.id, { type: "agent:detect" });
    if (answer?.error) return { ...base, state: "error", error: answer.error };
    return { ...base, state: answer?.signedIn ? "ready" : "signed-out" };
  } catch (error) {
    return { ...base, state: "error", error: error.message };
  }
}

const fail = (code, message) => {
  throw new FoxcacheError(code, message);
};

/** The messages that the extension's own pages send. */
export const handlers = {
  "providers:status": () => Promise.all(ADAPTERS.map(status)),
  // The archive page's names for the sites: no detect, no request to a site (X60).
  "providers:labels": () => ADAPTERS.map((a) => ({ id: a.id, label: a.label })),

  // fresh: start over and leave a stopped or failed capture behind, instead of resuming it.
  "capture:start": async ({ provider, fresh }) => {
    const adapter = adapterFor(provider);
    if (!(await allowed(adapter))) fail("not-allowed", `Allow ${adapter.origin} in the settings first.`);
    const since = generation;
    const previous = await refresh(adapter);
    if (previous?.checkpoint.status === "running") fail("bad-request", `A ${adapter.label} capture is running.`);
    const tab = (await providerTab(adapter)) ?? fail("not-found", `Open ${adapter.origin} in a tab and sign in.`);
    const resume = !fresh && previous && RESUMABLE.has(previous.checkpoint.status) ? previous.checkpoint : undefined;
    // The early stop is safe only after a capture that read everything (C10).
    const earlyStop = !resume && previous?.checkpoint.status === "done" && previous.checkpoint.counts.errors === 0;
    const now = new Date().toISOString();
    const counts = { conversations: 0, skipped: 0, errors: 0, projects: 0, memories: 0, preferences: 0, library: 0 };
    const checkpoint = resume ? { ...resume, status: "running" } : { provider: adapter.id, status: "running", startedAt: now, updatedAt: now, extrasDone: false, pages: 0, counts, lastErrors: [] };
    await inject(tab.id);
    await store.backend.delete("checkpoints", stopKey(adapter.id));
    if (!(await saveSince(adapter.id, { tabId: tab.id, startingUntil: Date.now() + 10_000, checkpoint }, since))) fail("bad-request", "Delete all ran while the capture started. Start it again.");
    const answer = await browser.tabs.sendMessage(tab.id, { type: "agent:capture", resume, earlyStop, stamps: await store.stamps(adapter.id) });
    if (!answer?.started) {
      await interrupt(adapter.id, { tabId: tab.id, checkpoint }, since);
      fail("provider-error", answer?.error ?? "The capture did not start.");
    }
    return checkpoint;
  },

  // The popup polls this while a capture runs: it reads the store and sends nothing to a provider.
  "capture:progress": async () => Object.fromEntries(await Promise.all(ADAPTERS.map(async (a) => [a.id, (await refresh(a))?.checkpoint ?? null]))),

  "capture:stop": async ({ provider }) => {
    const adapter = adapterFor(provider);
    const capture = await captureOf(adapter.id);
    if (capture?.checkpoint.status !== "running") return true;
    await store.backend.put("checkpoints", stopKey(adapter.id), true);
    // The agent stops before its next request; the flag also stops it if this message is lost.
    await browser.tabs.sendMessage(capture.tabId, { type: "agent:stop" }).catch(() => undefined);
    return true;
  },

  "archive:counts": () => store.counts(),
  "archive:search": ({ query, provider, kind }) => store.search(query, { provider: provider || undefined, kind: kind || undefined }),
  "archive:list": async ({ kind, provider }) => {
    const records = await store.all(kind, { provider: provider || undefined });
    // Conversations as summaries: the page asks for one at a time.
    if (kind === "conversations") return records.map((c) => ({ provider: c.provider, id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages.length })).toSorted((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return records;
  },
  "archive:get": ({ kind, key }) => store.get(kind, key),

  // Compact, and no larger than foxcache import takes (X10).
  "export:json": async () => {
    const text = JSON.stringify(await toArchive(store));
    if (new Blob([text]).size > MAX_ARCHIVE_BYTES) fail("too-large", `The archive is larger than the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB that foxcache import takes. Export Markdown instead.`);
    return text;
  },
  "export:markdown": async () => zip(markdownFiles(await toArchive(store))),
  "export:memories": async () => toMemoryList(await toArchive(store)),

  "data:delete-all": async () => {
    generation += 1;
    await store.deleteAll();
    return true;
  },
};

/** Only this extension's own pages, not a content script or a web page, may read, export or delete (X1). */
export const fromOwnPage = (sender) => sender?.id === browser.runtime.id && typeof sender.url === "string" && sender.url.startsWith(browser.runtime.getURL(""));

/** The agent of a running capture: in the capture's tab, on the provider's own origin (X1). `since` is the delete all count before the capture was read. */
async function fromAgent(sender) {
  const since = generation;
  if (sender?.id !== browser.runtime.id || !sender.tab || typeof sender.url !== "string") return null;
  const adapter = adapterAt(new URL(sender.url).origin);
  if (!adapter) return null;
  // The agent's fetches run as the page and need no grant, so a site the user turned off is checked here (X11, X12).
  if (!(await allowed(adapter))) return null;
  const capture = await captureOf(adapter.id);
  if (!capture || capture.tabId !== sender.tab.id || capture.checkpoint.status !== "running") return null;
  return { adapter, capture, since };
}

/** The messages that the agent sends. A sender that is not the agent of a running capture is told to stop and stores nothing. */
const agentHandlers = {
  "capture:put": async ({ kind, record }, from) => {
    if (record?.provider !== from.adapter.id) return { error: `A ${from.adapter.label} tab cannot add a record of ${record?.provider}.` };
    await store.put(kind, record);
    if (generation !== from.since) {
      await store.backend.delete(kind, recordKey(kind, check(kind, record)));
      return { stop: true };
    }
    return { stop: await stopAsked(from.adapter.id) };
  },
  // A kind read in full: the records the site no longer has go (C11). Conversations are never deleted this way.
  "capture:keep": async ({ kind, keys }, from) => {
    if (!KEEP_KINDS.has(kind)) return { error: `keep does not apply to ${kind}.` };
    if (!Array.isArray(keys) || !keys.every((k) => typeof k === "string")) return { error: "keep needs a list of keys." };
    await store.keep(kind, from.adapter.id, keys);
    return { stop: await stopAsked(from.adapter.id) };
  },
  "capture:checkpoint": async ({ checkpoint }, from) => {
    if (checkpoint?.provider !== from.adapter.id) return { error: "The checkpoint is for another provider." };
    if (!(await saveSince(from.adapter.id, { ...from.capture, checkpoint }, from.since))) return { stop: true };
    return { stop: await stopAsked(from.adapter.id) };
  },
};

browser.runtime.onMessage.addListener((message, sender) => {
  const type = message?.type;
  if (Object.hasOwn(agentHandlers, type)) {
    return fromAgent(sender)
      .then((from) => (from ? agentHandlers[type](message, from) : { stop: true }))
      .catch((error) => ({ error: error instanceof FoxcacheError ? `${error.code}: ${error.message}` : String(error) }));
  }
  if (!Object.hasOwn(handlers, type) || !fromOwnPage(sender)) return undefined;
  return Promise.resolve()
    .then(() => handlers[type](message))
    .then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, code: error instanceof FoxcacheError ? error.code : "error", error: error instanceof Error ? error.message : String(error) }),
    );
});

// A closed tab ends its capture (X4).
browser.tabs.onRemoved.addListener(async (tabId) => {
  for (const adapter of ADAPTERS) {
    const since = generation;
    const capture = await captureOf(adapter.id);
    if (capture?.tabId === tabId && capture.checkpoint.status === "running") await interrupt(adapter.id, capture, since);
  }
});

// A site the user turns off ends its capture: the agent stops before its next request (X11).
browser.permissions.onRemoved.addListener(async ({ origins = [] }) => {
  for (const adapter of ADAPTERS.filter((a) => grants(a).some((g) => origins.includes(g)))) {
    const capture = await captureOf(adapter.id);
    if (capture?.checkpoint.status !== "running") continue;
    await store.backend.put("checkpoints", stopKey(adapter.id), true);
    await saveCapture(adapter.id, { ...capture, checkpoint: { ...capture.checkpoint, status: "stopped", updatedAt: new Date().toISOString() } });
    await browser.tabs.sendMessage(capture.tabId, { type: "agent:stop" }).catch(() => undefined);
  }
});

// answerScent gives undefined for any sender but foxscope. Firefox would then
// resolve the sender's call with undefined, which tells it foxcache is
// installed. So reject with the error Firefox gives when no extension has
// that id: to another extension, foxcache looks absent (SC1).
const ABSENT = "Could not establish connection. Receiving end does not exist.";
browser.runtime.onMessageExternal.addListener((message, sender) => answerScent(resolver, sender, message) ?? Promise.reject(new Error(ABSENT)));
