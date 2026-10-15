// Serve the fixtures in tests/fixtures/ at the real provider origins with
// WebDriver BiDi network interception (network.addIntercept and
// network.provideResponse), so Firefox runs the real origin matching, the
// real permission checks and same-origin fetches. Nothing reaches the
// real sites. The test can change an answer with override().
import { readFileSync } from "node:fs";

export const load = (provider) => JSON.parse(readFileSync(`tests/fixtures/${provider}.json`, "utf8"));
const keyOf = (u) => (u.search ? `${u.pathname}?${[...u.searchParams].map(([k, v]) => `${k}=${v}`).join("&")}` : u.pathname);
const PAGE = (host) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${host} (fixture)</title></head><body><p>A fixture page for ${host}. The E2E serves it in place of the real site.</p></body></html>`;

/**
 * Intercept every request to the fixture origins. Each request is logged
 * as { method, url, status }. override(url-key, fn) answers one route with
 * fn(count) -> { status, body, headers } | undefined (the fixture).
 */
export async function serveFixtures(connection, providers) {
  const byHost = new Map(providers.map((p) => load(p)).map((f) => [new URL(f.origin).host, f]));
  const log = [];
  const overrides = new Map();
  const counts = new Map();
  connection.on("network.beforeRequestSent", async (event) => {
    if (!event.isBlocked) return;
    const u = new URL(event.request.url);
    const f = byHost.get(u.host);
    const key = keyOf(u);
    const n = (counts.get(`${u.host}${key}`) ?? 0) + 1;
    counts.set(`${u.host}${key}`, n);
    let reply = overrides.get(`${u.host}${key}`)?.(n);
    if (!reply) {
      const body = f && (key in f.routes ? f.routes[key] : f.routes[u.pathname]);
      if (u.pathname === "/") reply = { status: 200, body: PAGE(u.host), type: "text/html" };
      else if (body === undefined) reply = { status: 404, body: '{"error":"not in the fixture"}' };
      else reply = { status: typeof body === "object" && body && "$status" in body ? body.$status : 200, body: JSON.stringify(body) };
    }
    log.push({ method: event.request.method, url: event.request.url, status: reply.status });
    const headers = [{ name: "content-type", value: { type: "string", value: reply.type ?? "application/json" } }, ...Object.entries(reply.headers ?? {}).map(([name, value]) => ({ name, value: { type: "string", value } }))];
    await connection.send("network.provideResponse", { request: event.request.request, statusCode: reply.status, reasonPhrase: reply.status === 200 ? "OK" : "Fixture", headers, body: { type: "string", value: reply.body } });
  });
  await connection.send("session.subscribe", { events: ["network.beforeRequestSent"] });
  for (const host of byHost.keys()) await connection.send("network.addIntercept", { phases: ["beforeRequestSent"], urlPatterns: [{ type: "pattern", protocol: "https", hostname: host }] });
  return {
    log,
    override: (origin, key, fn) => overrides.set(`${new URL(origin).host}${key}`, fn),
    fixture: (provider) => load(provider),
  };
}
