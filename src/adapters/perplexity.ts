// www.perplexity.ai. Cookies only. The thread list and the memories are
// POST reads; one thread is a GET paged by cursor. Endpoints and sources:
// docs/providers/perplexity.md.
import { cookie } from "../auth/cookie.js";
import { FoxcacheError } from "../errors.js";
import { defineReads } from "../reads.js";
import { MAX_MESSAGES, type Memory, type Message } from "../schema.js";
import { MAX_SUBPAGES, type Obj, reader } from "./read.js";
import type { Adapter, Stub } from "./types.js";

const r = reader("perplexity");
const MULTI = "https://github.com/mrlnlms/multi-ai-session-data-extractor/blob/01450c0dafcf4d1af62056392fd387124febe4b2/src/platforms/perplexity/extractor/api_client.py";
const DEPLEXITY = "https://github.com/clappingmonkey/Deplexity/blob/e286424e0148759ced551bf11536391a9c37d600/internal/api";
/** The memory query's persisted hash: it changes with a Perplexity deploy (docs/providers/perplexity.md). */
const MEMORY_QUERY = { name: "KnowledgeContextKnowledgeRelayQuery", hash: "2884580667156294c2dfab80de32b737ef7bdf1d2c765a1f37e45e0207afcc50" };
const V = { version: "2.18", source: "default" };
const PAGE = 50;
const ANSWERS = ["ask_text_0_markdown", "ask_text"];

function stubs(page: unknown, name: string): Stub[] {
  return r.arr(page, name).map((x, i) => {
    const t = r.obj(x, `${name}[${i}]`);
    return { id: r.str(t.uuid, `${name}[${i}].uuid`), title: r.optStr(t.title, `${name}[${i}].title`) ?? "", updatedAt: r.time(t.last_query_datetime, `${name}[${i}].last_query_datetime`) };
  });
}

/** The answer of an entry: the markdown of its first answer block, or undefined. */
function answer(e: Obj, where: string): string | undefined {
  const blocks = r.arr(e.blocks ?? [], `${where}.blocks`).map((b, i) => r.obj(b, `${where}.blocks[${i}]`));
  for (const usage of ANSWERS) {
    const b = blocks.find((x) => x.intended_usage === usage && x.markdown_block);
    if (b) return r.str(r.obj(b.markdown_block, `${where}.${usage}.markdown_block`).answer, `${where}.${usage}.markdown_block.answer`);
  }
  return undefined;
}

export const perplexity: Adapter = {
  id: "perplexity",
  label: "Perplexity",
  origin: "https://www.perplexity.ai",
  auth: cookie,
  reads: defineReads([
    { method: "GET", path: "/api/auth/session", query: ["version", "source"], source: `${DEPLEXITY}/user.go#L28-L53` },
    { method: "POST", path: "/rest/thread/list_pinned_ask_threads", query: ["version", "source"], body: { type: "json", match: {}, keys: [] }, source: `${MULTI}#L62-L70` },
    { method: "POST", path: "/rest/thread/list_ask_threads", query: ["version", "source"], body: { type: "json", match: { search_term: "" }, keys: ["limit", "ascending", "offset", "search_term", "exclude_asi"] }, source: `${MULTI}#L50-L60` },
    { method: "GET", path: "/rest/thread/{uuid}", query: ["with_schematized_response", "version", "source", "limit", "offset", "from_first", "cursor"], source: `${DEPLEXITY}/threads.go#L104-L116` },
    // One GraphQL endpoint: the read names its query. Mutations are under "Never call" in the doc.
    { method: "POST", path: "/rest/perplexity_ask/graphql", body: { type: "json", match: { operationName: MEMORY_QUERY.name, "extensions.persistedQuery.sha256Hash": MEMORY_QUERY.hash }, keys: ["operationName", "variables", "extensions"] }, source: `${MULTI}#L126-L145` },
  ]),
  // No source says what the list is sorted by.
  newestFirst: false,

  async detect(http) {
    try {
      const user = r.obj(await http.get("/api/auth/session", V), "session").user as Obj | undefined;
      return Boolean(user?.id || user?.email);
    } catch (error) {
      if (error instanceof FoxcacheError && error.code === "logged-out") return false;
      throw error;
    }
  },

  // The first page is the pinned threads; then the cursor is the list offset.
  async listConversations(http, cursor) {
    if (cursor === undefined) return { items: stubs(await http.post("/rest/thread/list_pinned_ask_threads", {}, V), "list_pinned_ask_threads"), next: "0" };
    const offset = Number(cursor);
    const items = stubs(await http.post("/rest/thread/list_ask_threads", { limit: PAGE, ascending: false, offset, search_term: "", exclude_asi: false }, V), "list_ask_threads");
    return { items, next: items.length === PAGE ? String(offset + items.length) : undefined };
  },

  async getConversation(http, stub) {
    const entries: Obj[] = [];
    const seen = new Set<string>();
    const cursors = new Set<string>();
    for (let cursor: string | undefined, pages = 1; ; pages++) {
      const page = r.obj(await http.get(`/rest/thread/${stub.id}`, { with_schematized_response: true, ...V, limit: 100, offset: 0, from_first: true, cursor }), "thread");
      for (const [i, x] of r.arr(page.entries, "entries").entries()) {
        const e = r.obj(x, `entries[${i}]`);
        const id = r.str(e.uuid, `entries[${i}].uuid`);
        // A page boundary can repeat the last entry.
        if (!seen.has(id)) entries.push(e);
        seen.add(id);
      }
      if (entries.length * 2 > MAX_MESSAGES) throw new FoxcacheError("too-large", `perplexity: the thread has more than ${MAX_MESSAGES / 2} entries; foxcache keeps at most ${MAX_MESSAGES} messages.`);
      cursor = r.bool(page.has_next_page, "has_next_page") ? r.optStr(page.next_cursor, "next_cursor") : undefined;
      if (cursor === undefined) break;
      if (cursors.has(cursor) || pages >= MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `perplexity: thread ${stub.id} did not end: next_cursor came again or passed ${MAX_SUBPAGES} pages.`);
      cursors.add(cursor);
    }
    let model: string | undefined;
    const messages: Message[] = entries.flatMap((e, i) => {
      const where = `entries[${i}]`;
      const at = r.time(e.entry_created_datetime, `${where}.entry_created_datetime`);
      model = r.optStr(e.display_model, `${where}.display_model`) ?? model;
      const text = answer(e, where);
      const question: Message = { role: "user", text: r.str(e.query_str, `${where}.query_str`), createdAt: at, attachments: [] };
      return text === undefined ? [question] : [question, { role: "assistant", text, attachments: [] }];
    });
    const first = entries[0];
    const createdAt = first ? r.time(first.entry_created_datetime, "entries[0].entry_created_datetime") : stub.updatedAt;
    return {
      provider: "perplexity",
      id: stub.id,
      title: (first && r.optStr(first.thread_title, "entries[0].thread_title")) || stub.title,
      createdAt,
      // The list's last_query_datetime, so a second capture sees no change (C8).
      updatedAt: stub.updatedAt || messages.findLast((m) => m.createdAt)?.createdAt || createdAt,
      ...(model ? { model } : {}),
      messages,
    };
  },

  async memories(http) {
    const out: Memory[] = [];
    const cursors = new Set<string>();
    for (let after: string | null = null, pages = 1; ; pages++) {
      const variables = { knowledgeFirst: null, knowledgeAfter: null, memoriesFirst: 100, memoriesAfter: after, includeKnowledgePage: false, includeMemoriesPage: true, includeContent: true, includeOutboundLinks: true };
      const page = r.obj(await http.post("/rest/perplexity_ask/graphql", { operationName: MEMORY_QUERY.name, variables, extensions: { persistedQuery: { version: 1, sha256Hash: MEMORY_QUERY.hash } } }), "memory query");
      if (page.errors !== undefined) throw r.fail("memory query", "answered errors (the persisted query hash may be stale)");
      const scope = r.obj(r.obj(r.obj(r.obj(page.data, "data").viewer, "data.viewer").knowledgeContext, "knowledgeContext").scopeByKind, "scopeByKind");
      let info: Obj | undefined;
      for (const [i, x] of r.arr(scope.memoryCategories, "memoryCategories").entries()) {
        const items = r.obj(r.obj(x, `memoryCategories[${i}]`).items, `memoryCategories[${i}].items`);
        if (items.status !== "OK") throw r.fail(`memoryCategories[${i}].items.status`, `is ${JSON.stringify(items.status)}`);
        const pageInfo = r.obj(items.pageInfo, `memoryCategories[${i}].items.pageInfo`);
        if (info && JSON.stringify(info) !== JSON.stringify(pageInfo)) throw r.fail(`memoryCategories[${i}].items.pageInfo`, "differs from the other categories'");
        info = pageInfo;
        for (const [j, edge] of r.arr(items.edges, `memoryCategories[${i}].items.edges`).entries()) {
          const node = r.obj(r.obj(edge, `edges[${j}]`).node, `edges[${j}].node`);
          out.push({ provider: "perplexity", id: r.str(node.id, `edges[${j}].node.id`), text: r.str(node.displayValue, `edges[${j}].node.displayValue`) });
        }
      }
      if (!info || !r.bool(info.hasNextPage, "pageInfo.hasNextPage")) return out;
      after = r.str(info.endCursor, "pageInfo.endCursor");
      if (cursors.has(after) || pages >= MAX_SUBPAGES) throw new FoxcacheError("pagination-loop", `perplexity: the memories did not end: endCursor came again or passed ${MAX_SUBPAGES} pages.`);
      cursors.add(after);
    }
  },
};
