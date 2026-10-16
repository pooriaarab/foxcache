# API origins and CORS

Some sites read their own data from another host: GitHub Copilot from
`api.individual.githubcopilot.com`, Character.ai from `neo.character.ai`,
Manus from `api.manus.im`. An adapter names those hosts in `apiOrigins` and
lists each read on them with its `origin` (`src/reads.ts`). This page says
what Firefox does with those requests, and how foxcache knows.

## Where the request comes from

The adapter runs in the provider's tab, in the capture agent (a content
script), and `http` calls the content script's own `fetch`. In a Firefox
MV3 content script, that `fetch` behaves like the page's:

- It sends `Origin: <the page's origin>`, for example
  `Origin: https://chatgpt.com`, not the extension's origin.
- CORS applies as it does for the page. The API host must answer with
  `Access-Control-Allow-Origin: <the page's origin>` and
  `Access-Control-Allow-Credentials: true`. Without them Firefox throws a
  `TypeError`, and `http` reports `provider-error` (H13).
- A host permission for the API host does not lift CORS. It changes
  nothing for these requests.
- `content.fetch` does not exist in an MV3 content script, so there is no
  other `fetch` to choose.

So foxcache can read an API host exactly when the site's own page can,
which is the case for every API the site's page calls itself. A host
that answers no CORS for the page is out of reach, and foxcache does not
try another way.

## Cookies

`http` sends `credentials: "include"`.

- **Same-site API host** (`neo.character.ai` from `character.ai`): the
  site's cookies with `Domain=character.ai` go with the request, as they do
  for the page.
- **Cross-site API host** (`api.individual.githubcopilot.com` from
  `github.com`): only the API host's own cookies can go, and only those it
  set while the user was on this site (Total Cookie Protection keys them by
  the top-level site). These APIs authenticate with a bearer token in
  practice (`localStorage-bearer`), so cookies do not matter there.

A bearer token or any other header outside the CORS safe list makes Firefox
send a preflight `OPTIONS` first. The API answers it for the page, as it
does for the page's own calls.

## How this is proven

Probed on Firefox 158 with a stand-in MV3 add-on, with and without a host
permission for the API hosts: same `Origin`, same CORS result, same cookies.
The E2E (`e2e/run.mjs`, step 1b) keeps it proven on every run. It installs
`e2e/api-ext/`, a content script on chatgpt.com that bundles foxcache's own
`http`, and serves fake API hosts through WebDriver BiDi interception:

| Read | Expected |
|---|---|
| `https://api.chatgpt.com/threads` (same site, CORS for the page) | the answer; the request carried `Origin: https://chatgpt.com` and the site cookie |
| `https://api.copilot-fixture.test/threads` (another site, CORS for the page) | the answer; `Origin: https://chatgpt.com` |
| `https://api.copilot-fixture.test/no-cors` (no CORS headers) | `provider-error` |
| `https://api.not-listed.test/threads` (not in `apiOrigins`) | `not-allowed`, and no request reaches the host |

Not proven: the preflight. Firefox's WebDriver BiDi shows no `OPTIONS`
request to the interceptor, so the E2E checks the request, its `Origin`,
its cookies and the CORS check of the answer, but not a preflight.
Each provider that uses an API origin confirms it once with the live smoke
check on a real login.

## Permissions

The fetch needs no host grant (see above). foxcache still treats each API
origin as part of the site: it is in `optional_host_permissions`, the
settings switch asks for the page and its API hosts at once, the popup shows
"Allow in settings" until all of them are granted, and turning any of them
off stops a capture (X12). The user sees every host foxcache reads before
it reads it.
