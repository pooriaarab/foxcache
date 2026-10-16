// An Http over a fixture file: tests/fixtures/<provider>.json maps a
// request ("<path>?<query>" with the query decoded, or "<path>") to the
// JSON body the provider sends, or to a text answer: {"$text": ...} as it
// is, {"$batchexecute": {rpcid: result}} as Google frames it. A POST looks for "POST <path>?<query>
// <body>" first, then "POST <path>?<query>" and "POST <path>". The E2E
// serves the same files at the real provider origins, without the body
// keys: BiDi does not show a POST body. The Http is the adapter's own, with its reads, so a
// test fails when an adapter sends a request its reads do not list.
import { readFileSync } from "node:fs";
import { type HttpSite, createHttp } from "../src/index.js";

export type Routes = Record<string, unknown>;
export const fixture = (name: string): Routes => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")).routes;

/** A status reply in a fixture: { "$status": 401 }. */
const statusOf = (body: unknown) => (typeof body === "object" && body !== null && "$status" in body ? Number((body as { $status: unknown }).$status) : 200);
/** A batchexecute answer: )]}' and one wrb.fr frame per rpc id, each after its length. e2e/intercept.mjs frames it the same way. */
export const batchWire = (frames: Record<string, unknown>) =>
  `)]}'\n${Object.entries(frames).map(([id, result]) => {
    const line = JSON.stringify([["wrb.fr", id, JSON.stringify(result), null, null, null, "generic"]]);
    return `\n${line.length}\n${line}`;
  }).join("")}`;
/** The text on the wire for a fixture body. */
function wire(body: unknown): string {
  if (typeof body === "object" && body !== null && "$text" in body) return String((body as { $text: unknown }).$text);
  if (typeof body === "object" && body !== null && "$batchexecute" in body) return batchWire((body as { $batchexecute: Record<string, unknown> }).$batchexecute);
  return JSON.stringify(body);
}

/** The page parts an auth kind may read: inline scripts and the functions the page set on window. */
export interface FixturePage {
  scripts?: string[];
  globals?: Record<string, () => unknown>;
}

export function fixtureHttp(site: HttpSite, routes: Routes, storage: { getItem(k: string): string | null } = { getItem: () => null }, page: FixturePage = {}) {
  const calls: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const query = u.search ? `${u.pathname}?${[...u.searchParams].map(([k, v]) => `${k}=${v}`).join("&")}` : u.pathname;
    const key = init.method === "POST" ? `POST ${query}` : query;
    calls.push(key);
    const keys = init.method === "POST" ? [`${key} ${String(init.body)}`, key, `POST ${u.pathname}`] : [key, u.pathname];
    const body = routes[keys.find((k) => k in routes) ?? ""];
    if (body === undefined) return new Response('{"error":"not in the fixture"}', { status: 404 });
    return new Response(wire(body), { status: statusOf(body), headers: { "content-type": "application/json" } });
  };
  return { http: createHttp(site, { fetch, storage, cookie: () => "", scripts: () => page.scripts ?? [], call: (name) => page.globals?.[name]?.() }), calls };
}
