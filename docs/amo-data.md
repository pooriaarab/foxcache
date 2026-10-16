# What the foxcache add-on sends, and its AMO data declaration

The manifest declares `data_collection_permissions: { "required": ["none"] }`.
This page lists every flow of data in and out of the add-on in
`extension/`, and why no AMO data type applies to it.

## The rule we apply

AMO's add-on policies define data transmission as data that is "collected,
used, transferred, shared, or handled outside of the add-on or the local
browser". The page "Firefox built-in consent for data collection and
transmission"
(https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
says: "If your extension doesn't collect or transmit any data, you indicate
that by specifying the `none` required permission in the manifest."

## What moves, and where

| What | From, to | When | Leaves the browser? |
|---|---|---|---|
| Read requests to the AI site's own endpoints: GETs, and Gemini's batchexecute POSTs that only read | From the user's tab on that site to that site | Only after the user allows the site and clicks Capture | The request goes to the site the user is signed in to, from the user's own tab, as the site's own page does. foxcache sends no data of its own in it: no id and no analytics, only the parameters the read needs, as the page sends them. |
| The answers: conversations, projects, memories, custom instructions | From the site, into IndexedDB in this browser | During a capture | No. They stay in this browser. |
| A token that chatgpt.com, DeepSeek, GitHub Copilot or Gemini uses | Read in the site's tab, the way the site's own script reads it | During a capture | No. It stays in the tab and is never stored or passed on. |
| SCENT answers: memories, preferences, project names | To foxscope@pooriaarab, another add-on in this browser | Only when foxscope asks, which asks the user first | No. foxscope runs in this browser. Conversations are never answered. |
| Exports: the archive, Markdown, the memory list | Saved to a file by the user | Only when the user clicks an export button | Only to a file the user picks on this computer. |

The add-on has no server, no analytics and no error reports. Nothing goes
to the authors.

## Decision

foxcache reads the user's own data from sites the user signs in to, and
keeps it in the user's browser. It sends nothing off the device, so `none`
is the true declaration. The listing says what the add-on reads and that
nothing leaves the computer.

## When this changes

A later step (sync) may move this data between the user's devices. That
change must update the manifest, this page and the listing in the same
commit, and ask for Firefox's consent before the first send.
