// An Http over a fixture file: tests/fixtures/<provider>.json maps a
// request ("<path>?<query>" with the query decoded, or "<path>") to the
// JSON body the provider sends. A POST looks for "POST <path>?<query>
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

export function fixtureHttp(site: HttpSite, routes: Routes, storage: { getItem(k: string): string | null } = { getItem: () => null }) {
  const calls: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const query = u.search ? `${u.pathname}?${[...u.searchParams].map(([k, v]) => `${k}=${v}`).join("&")}` : u.pathname;
    const key = init.method === "POST" ? `POST ${query}` : query;
    calls.push(key);
    const keys = init.method === "POST" ? [`${key} ${String(init.body)}`, key, `POST ${u.pathname}`] : [key, u.pathname];
    const body = routes[keys.find((k) => k in routes) ?? ""];
    if (body === undefined) return new Response('{"error":"not in the fixture"}', { status: 404 });
    return new Response(JSON.stringify(body), { status: statusOf(body), headers: { "content-type": "application/json" } });
  };
  return { http: createHttp(site, { fetch, storage, cookie: () => "" }), calls };
}
