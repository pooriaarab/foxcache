# Design

foxcache is step one of a longer flow: capture, then sync, enforce and
inject. This page records the decisions behind the capture step. The
failure modes are in [failure-modes.md](failure-modes.md), and each provider
has a page under [providers/](providers/).

## Parts

```text
provider tab (chatgpt.com, claude.ai, ...)
  capture agent: a content script that foxcache injects on Capture.
  It runs the provider adapter and fetches the site's own JSON endpoints
  with the page's session cookies. Only the reads the adapter lists.
        | runtime.sendMessage, one record at a time
        v
event page (extension/background.js)
  checks the sender, validates each record, writes it to IndexedDB,
  saves the checkpoint, answers Stop, answers foxscope (SCENT)
        ^
        | runtime.sendMessage
popup, archive page, settings page

archive file (foxcache/v1 JSON) -> foxcache CLI -> ~/.foxcache/archive.json -> MCP server
```

The npm package holds everything that is not browser glue: the schema, the
adapters, the capture runner, the store, the outputs, the SCENT resolver,
the CLI and the MCP server. The extension bundles the same code with
esbuild, so the unit tests cover what runs in Firefox.

## Adapters

Every provider has one adapter with the same interface (`src/adapters/types.ts`):

| Member | Job |
|---|---|
| `detect(http)` | Is the user signed in on this origin? A 401 or 403 means no. |
| `listConversations(http, cursor)` | One page of conversation stubs (id, title, updatedAt), newest first, and the next cursor. |
| `getConversation(http, stub)` | One conversation, normalized to `foxcache/v1`. |
| `projects`, `memories`, `preferences`, `library` | Optional. Each returns normalized records. |

`http` is the only way an adapter reaches the network. Each adapter lists
its reads (`src/reads.ts`): the method and exact path of every request, with
`{name}` for one plain id segment, the query keys of each, and a source URL.
A GET is not trusted to be safe, since some sites delete with one. A POST
read also names its operation: the GraphQL `queryName` or hash, the IM
`cmd`, or the batchexecute rpc ids, so the same endpoint cannot carry a
write. A read whose answer is not JSON (batchexecute, stream frames, HTML) names a
`decode` for the text, under the same size cap. A read whose page sends a fixed header
(Doubao's `agw-js-conv`) names it in `headers`. `http` refuses any other
request before it is sent. An adapter cannot
send, edit or delete anything on the provider. A site whose page reads from
another host names it in `apiOrigins`; those reads also go from the tab, as
the page's own calls do ([cors.md](cors.md)).

Each endpoint, its source and a confidence level are in
`docs/providers/<id>.md`. An endpoint that no open-source exporter confirms
is marked "unverified". A provider with no endpoint we can call by GET with
confidence has no adapter. A thin adapter that is right beats a broad one
that guesses.

### Auth

The agent sends `credentials: "include"` from the provider's own origin, so
the request carries the session cookies that the site already set. foxcache
never reads a password and never sees the login. It reads a cookie only for
a site whose auth kind is `cookie-bearer` (none of the four today), and then
only that one cookie, in the tab.

Some sites send a bearer token that their own script gets from the page.
Each adapter names its auth kind, one file each in `src/auth/`:

| Kind | Token | Used by |
|---|---|---|
| `cookie` | none: the cookies alone | Claude, Le Chat |
| `page-session` | a field of a session answer the page reads with its cookies | ChatGPT (`/api/auth/session`) |
| `localStorage-bearer` | a localStorage key, or a field of its JSON | DeepSeek (`userToken`) |
| `cookie-bearer` | a cookie the page's script can read, or a field of its JSON | none yet |

`http` opens the kind once, inside the content script, so the token lives
in a closure there. It goes only onto requests that are reads, and never to
the event page, the store, an export, an error or a log. No read may name a
path that holds a token. `tests/auth.test.ts` checks each kind.

## Capture

The user clicks Capture for one provider in the popup. The event page finds
an open tab of that provider, injects `agent.js` with
`scripting.executeScript`, and starts the agent with the checkpoint.

The capture runner (`src/capture.ts`) then:

1. calls `detect`, and stops with `logged-out` when the user is signed out;
2. reads the optional kinds (projects, memories, preferences, library);
3. pages through the conversation list, newest first. A stub whose
   `updatedAt` is not newer than the stored copy is skipped, so a second
   capture fetches only what changed;
4. fetches each new or changed conversation and sends it to the event page.

Politeness: one request at a time, with a delay between requests (1.5 s by
default). A 429 waits for `Retry-After`, or backs off 2, 4, 8 ... up to 60 s,
and gives up after 6 tries with `rate-limited`. A capture that stops for any
reason can be resumed: the checkpoint holds the list cursor and the ids
already done.

Stop: the event page answers each record with `{ stop }`. After Stop, the
next answer is `stop: true` and the agent ends after the request in flight.

Why the loop runs in the tab and not in the event page: Firefox unloads an
idle event page after 30 s. A message from the agent is an event, so the
event page stays loaded while records arrive, and it holds no state that a
reload would lose. A closed tab or a navigation marks the capture
"interrupted", and the popup offers Resume.

## Permissions

Each provider origin is in `optional_host_permissions`. The settings page
asks for one origin at a time, after the user clicks it. Without the grant,
foxcache cannot see the provider's tabs or inject into them. The other
permissions are `scripting` (inject the agent) and `unlimitedStorage` (a
large archive must not hit the IndexedDB quota).

`data_collection_permissions` is `none`: nothing goes to the developer or any
server. The only network requests are the GETs to the provider that the user
is signed in to, from the user's own tab.

## Schema `foxcache/v1`

```ts
Conversation { provider, id, title, createdAt, updatedAt, model?, projectId?, messages: Message[] }
Message      { role: "user" | "assistant" | "system" | "tool", text, createdAt?, attachments: Attachment[], truncated? }
Attachment   { name, id?, mimeType?, size? }           // metadata only, never the file
Project      { provider, id, name, instructions?, files: Attachment[] }
Memory       { provider, id?, text, createdAt? }
Preference   { provider, kind, text }                  // kind: about-me, response-style, instructions, name, occupation
LibraryItem  { provider, id, name, kind }              // kind: gpt, gem, style, agent, space
```

Times are ISO-8601 strings in UTC. Message text is plain text as the
provider gave it. The raw provider JSON is not stored: it holds tracking ids,
feedback, moderation data and internal fields that the user did not write
and no later step needs. An adapter maps the fields it knows and fails
loudly (`provider-schema`) on a shape it does not know.

## Store

- Extension: IndexedDB, one object store per kind, keyed by
  `<provider>:<id>`. A memory without an id is keyed by a hash of its text.
- Node: one file, `~/.foxcache/archive.json` (`FOXCACHE_HOME` overrides the
  directory). It is written to a temporary file and renamed, so a crash
  leaves the old file whole.
- The extension exports one archive file. `foxcache import` merges it into
  the Node store. On a merge, the copy with the newer `updatedAt` wins.

## Outputs

- JSON: the archive itself.
- Markdown: one file per conversation, `<provider>/<date>-<slug>.md`, in a
  zip from the extension or a folder from the CLI.
- Memory list, for foxpack: one memory per line, as a Markdown bullet with a
  provider tag. A model asked to "list my memories" writes the same shape,
  so foxpack reads both with one paste parser:

  ```text
  # foxcache memories, exported 2026-10-15T12:00:00.000Z
  - [chatgpt] Prefers metric units.
  - [claude] Works on a Firefox extension called foxcache.
  ```

## SCENT

The event page answers `onMessageExternal` only from `foxscope@pooriaarab`.
Any other sender gets the error that Firefox gives for an add-on that is not
installed. Namespace `cache`:

| Field | Sensitivity | Value |
|---|---|---|
| `cache.memories` | ask | `[{ provider, text }]` |
| `cache.preferences` | ask | `[{ provider, kind, text }]` |
| `cache.projects` | ask | `[{ provider, name }]`, names only |
| `cache.conversations` | private | never returned |

## MCP server

`foxcache mcp` is read-only. It has `list_memories` and `list_preferences`.
`search_conversations` and `get_conversation` exist only when the server
starts with `--allow conversations`.
