// H30 in docs/failure-modes.md: a JSON body rule with keys takes no
// other top-level key, so a body that names a read operation cannot
// also carry a GraphQL query text.
import { describe, expect, it } from "vitest";
import { type Read, cookie, createHttp, defineReads, doubao, grok, kimi, meta, notion, perplexity, poe } from "../src/index.js";
import { ADAPTERS } from "../src/adapters/index.js";
import { prepare } from "../src/reads.js";

const LIST = poe.reads[0]!.body as { match: Record<string, string> };
const MUTATION = "mutation { deleteChat(chatId: 1) { ok } }";
const notAllowed = { code: "not-allowed" };
const page = { fetch: async () => new Response("{}"), storage: { getItem: () => null }, scripts: () => [], call: () => undefined };
const post = (body: unknown): Read => ({ method: "POST", path: "/graphql", body: body as Read["body"], source: "https://example.test/docs" });
const open = (read: Read) => () => createHttp({ origin: "https://chatgpt.com", reads: defineReads([read]), auth: cookie }, page);

describe("H30 a JSON body with a key its rule does not list", () => {
  it("refuses a Poe read operation that also carries a query text", () => {
    const body = { queryName: LIST.match.queryName, variables: {}, extensions: { hash: LIST.match["extensions.hash"] } };
    expect(prepare(poe, "POST", "/api/gql_POST", {}, body).body?.text).toBe(JSON.stringify(body));
    expect(() => prepare(poe, "POST", "/api/gql_POST", {}, { ...body, query: MUTATION })).toThrow(expect.objectContaining(notAllowed));
  });
  it("refuses a Perplexity persisted query that also carries a query text", () => {
    const rule = perplexity.reads.find((r) => r.path === "/rest/perplexity_ask/graphql")!.body as { match: Record<string, string> };
    const body = { operationName: rule.match.operationName, variables: {}, extensions: { persistedQuery: { version: 1, sha256Hash: rule.match["extensions.persistedQuery.sha256Hash"] } } };
    expect(prepare(perplexity, "POST", "/rest/perplexity_ask/graphql", {}, body).body).toBeDefined();
    expect(() => prepare(perplexity, "POST", "/rest/perplexity_ask/graphql", {}, { ...body, query: MUTATION })).toThrow(expect.objectContaining(notAllowed));
  });
  it("refuses a Perplexity thread list with a key the page does not send", () => {
    const V = { version: "2.18", source: "default" };
    expect(() => prepare(perplexity, "POST", "/rest/thread/list_pinned_ask_threads", V, { query: MUTATION })).toThrow(expect.objectContaining(notAllowed));
    expect(() => prepare(perplexity, "POST", "/rest/thread/list_ask_threads", V, { search_term: "", query: MUTATION })).toThrow(expect.objectContaining(notAllowed));
  });
  it("refuses a Meta doc_id that also carries a query_id or a query text", () => {
    const docId = (meta.reads[0]!.body as { match: Record<string, string> }).match.doc_id!;
    expect(prepare(meta, "POST", "/api/graphql", {}, { doc_id: docId, variables: {} }).body).toBeDefined();
    for (const extra of [{ query_id: "1" }, { query: MUTATION }]) expect(() => prepare(meta, "POST", "/api/graphql", {}, { doc_id: docId, variables: {}, ...extra })).toThrow(expect.objectContaining(notAllowed));
  });
  it("lists the keys on every JSON read of every adapter", () => {
    for (const site of ADAPTERS) for (const read of site.reads.filter((r) => r.body?.type === "json")) expect(read.body, `${site.id} ${read.path}`).toHaveProperty("keys");
  });
  it("refuses a Kimi, Grok, Notion or Doubao body with a key the adapter does not send", () => {
    const D = { version_code: "20800", language: "zh", device_platform: "web", aid: "497858", real_aid: "497858", pkg_type: "release_version", region: "CN", sys_region: "CN", samantha_web: "1", web_platform: "browser", "use-olympus-account": "1" };
    const cases = [
      [kimi, "/apiv2/kimi.chat.v1.ChatService/ListChats", {}, { page_size: 1, query: "" }],
      [kimi, "/apiv2/kimi.chat.v1.ChatService/GetChat", {}, { chatId: "c" }],
      [kimi, "/apiv2/kimi.chat.v1.ChatService/ListMessages", {}, { chatId: "c" }],
      [grok, "/rest/app-chat/conversations/c/load-responses", {}, { responseIds: ["r"] }],
      [notion, "/api/v3/loadUserContent", {}, {}],
      [notion, "/api/v3/getInferenceTranscriptsForUser", {}, { threadParentPointer: { table: "space" }, limit: 1 }],
      [notion, "/api/v3/syncRecordValuesSpaceInitial", {}, { requests: [], spacePointer: { table: "space" } }],
      [doubao, "/im/chain/recent_conv", D, { cmd: 3200, uplink_body: {}, sequence_id: "s", channel: 2, version: "1" }],
    ] as const;
    for (const [site, path, query, body] of cases) {
      expect(prepare(site, "POST", path, query, body).body, path).toBeDefined();
      expect(() => prepare(site, "POST", path, query, { ...body, query: MUTATION, operations: [] }), path).toThrow(expect.objectContaining(notAllowed));
    }
  });
});

describe("H30 a wrong keys list (H11)", () => {
  it("refuses a JSON rule with no keys", () => {
    expect(open(post({ type: "json", match: {} }))).toThrow(/keys/);
    expect(open(post({ type: "json", match: { queryName: "Q" } }))).toThrow(/keys/);
  });
  it("refuses keys that do not hold a match path", () => {
    expect(open(post({ type: "json", match: { "extensions.hash": "h" }, keys: ["queryName"] }))).toThrow(/keys/);
  });
  it("refuses keys that are not a list of distinct names", () => {
    for (const keys of ["queryName", [""], ["a", "a"], [1]]) expect(open(post({ type: "json", match: {}, keys }))).toThrow(/keys/);
  });
  it("takes keys that hold every match path", () => {
    expect(open(post({ type: "json", match: { queryName: "Q", "extensions.hash": "h" }, keys: ["queryName", "variables", "extensions"] }))).not.toThrow();
  });
});
