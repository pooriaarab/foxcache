// An Http over a fixture file: tests/fixtures/<provider>.json maps a
// request ("<path>?<query>" or "<path>") to the JSON body the provider
// sends. The E2E serves the same files at the real provider origins.
import { readFileSync } from "node:fs";
import { type AuthKind, createHttp } from "../src/index.js";

export type Routes = Record<string, unknown>;
export const fixture = (name: string): Routes => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8")).routes;

/** A status reply in a fixture: { "$status": 401 }. */
const statusOf = (body: unknown) => (typeof body === "object" && body !== null && "$status" in body ? Number((body as { $status: unknown }).$status) : 200);

export function fixtureHttp(origin: string, routes: Routes, auth?: AuthKind, storage?: { getItem(k: string): string | null }) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    const u = new URL(url);
    const key = `${u.pathname}${u.search}`;
    calls.push(key);
    const body = key in routes ? routes[key] : routes[u.pathname];
    if (body === undefined) return new Response('{"error":"not in the fixture"}', { status: 404 });
    return new Response(JSON.stringify(body), { status: statusOf(body), headers: { "content-type": "application/json" } });
  };
  return { http: createHttp({ origin, fetch, auth, storage }), calls };
}
