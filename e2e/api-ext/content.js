// A stand-in content script for the API origin check (H12, H13). The E2E
// bundles it with foxcache's own http and installs it as an MV3 add-on
// with a content script on chatgpt.com, the way the capture agent runs. It
// reads from a same-site API host, a cross-site one, one whose CORS does
// not allow the page, and one it does not list, then puts the outcomes on
// the page for the test to read.
import { cookie } from "../../src/auth/cookie.ts";
import { createHttp, defineReads } from "../../src/http.ts";

const SAME = "https://api.chatgpt.com";
const CROSS = "https://api.copilot-fixture.test";
const SOURCE = "https://github.com/pooriaarab/foxcache/blob/main/docs/cors.md";
const site = {
  origin: location.origin,
  apiOrigins: [SAME, CROSS],
  auth: cookie,
  reads: defineReads([
    { method: "GET", origin: SAME, path: "/threads", source: SOURCE },
    { method: "GET", origin: CROSS, path: "/threads", source: SOURCE },
    { method: "GET", origin: CROSS, path: "/no-cors", source: SOURCE },
  ]),
};
const http = createHttp(site, { fetch: (url, init) => fetch(url, init), storage: window.localStorage, cookie: () => document.cookie, scripts: () => [], call: () => undefined });
const outcome = (p) => p.then((value) => ({ value }), (error) => ({ error: error.code ?? String(error) }));

// A site cookie (Domain=chatgpt.com), which a same-site API host gets with credentials: "include".
document.cookie = "fca_site=1; domain=chatgpt.com; path=/; secure; samesite=lax";
(async () => {
  const results = {
    same: await outcome(http.get(`${SAME}/threads`)),
    cross: await outcome(http.get(`${CROSS}/threads`)),
    noCors: await outcome(http.get(`${CROSS}/no-cors`)),
    notListed: await outcome(http.get("https://api.not-listed.test/threads")),
  };
  document.documentElement.dataset.apiOrigins = JSON.stringify(results);
})();
