// H30 in docs/failure-modes.md: a JSON body rule with keys takes no
// other top-level key, so a body that names a read operation cannot
// also carry a GraphQL query text.
import { describe, expect, it } from "vitest";
import { perplexity } from "../src/adapters/perplexity.js";
import { type Read, cookie, createHttp, defineReads, meta, poe } from "../src/index.js";
import { prepare } from "../src/reads.js";

const LIST = poe.reads[0]!.body as { match: Record<string, string> };
const MUTATION = "mutation { deleteChat(chatId: 1) { ok } }";
const notAllowed = { code: "not-allowed" };
const page = { fetch: async () => new Response("{}"), storage: { getItem: () => null }, cookie: () => "", scripts: () => [], call: () => undefined };
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
  it("lists the keys on every Poe, Perplexity and Meta JSON read", () => {
    for (const site of [poe, perplexity, meta]) for (const read of site.reads.filter((r) => r.body?.type === "json")) expect(read.body).toHaveProperty("keys");
  });
});

describe("H30 a wrong keys list (H11)", () => {
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
