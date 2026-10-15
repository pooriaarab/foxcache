// The capture agent. When the user clicks Capture, the event page injects
// this file into an open tab of the provider with scripting.executeScript.
// It runs the provider's adapter here, so each fetch is same-origin and
// carries the session the page already has. It sends each record to the
// event page, one at a time, and stops when the answer says so.
// Read-only: http (src/http.ts) sends the adapter's reads and nothing else.
import { adapterAt, createHttp, runCapture } from "../src/index.ts";

/** The event page stores each record and answers { stop }. No answer means stop. */
async function send(message) {
  const answer = await browser.runtime.sendMessage(message);
  if (answer?.error) throw new Error(answer.error);
  return { stop: answer?.stop !== false };
}

/** The text of the page's inline scripts, for an auth kind that finds a page function by name (page-formkey). */
const pageScripts = () => [...document.scripts].filter((s) => !s.src).map((s) => s.text);
/** Call a function the page's own script set on window. It runs in the page, as the page's own call would; wrappedJSObject is how Firefox reaches it. */
function callPage(name) {
  const fn = window.wrappedJSObject[name];
  return typeof fn === "function" ? fn() : undefined;
}

// executeScript can inject the file again into the same tab.
if (!globalThis.foxcacheAgent) {
  globalThis.foxcacheAgent = true;
  const adapter = adapterAt(location.origin);
  const http = () => createHttp(adapter, { fetch: (url, init) => fetch(url, init), storage: window.localStorage, cookie: () => document.cookie, scripts: pageScripts, call: callPage });
  let running = false;
  let stopper;

  const sink = {
    put: (kind, record) => send({ type: "capture:put", kind, record }),
    checkpoint: (checkpoint) => send({ type: "capture:checkpoint", checkpoint }),
    keep: (kind, keys) => send({ type: "capture:keep", kind, keys }),
  };

  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || !adapter) return undefined;
    switch (message?.type) {
      case "agent:ping":
        return Promise.resolve({ running });
      case "agent:detect":
        return adapter.detect(http()).then(
          (signedIn) => ({ signedIn }),
          (error) => ({ error: error.message }),
        );
      case "agent:capture":
        if (running) return Promise.resolve({ started: false, error: "A capture already runs in this tab." });
        running = true;
        stopper = new AbortController();
        runCapture({ adapter, http: http(), sink, stamps: message.stamps, resume: message.resume, earlyStop: message.earlyStop, signal: stopper.signal }).finally(() => (running = false));
        return Promise.resolve({ started: true });
      // Stop before the next request, also in a pause or a backoff wait.
      case "agent:stop":
        stopper?.abort();
        return Promise.resolve({ stopped: running });
      default:
        return undefined;
    }
  });
}
