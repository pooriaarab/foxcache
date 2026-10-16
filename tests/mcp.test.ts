// M1-M3 in docs/failure-modes.md: the MCP server is read-only, and it has
// conversation tools only when the user starts it with --allow conversations.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { updateNodeStore } from "../src/node.js";

async function connect(allowConversations: boolean) {
  const env = { FOXCACHE_HOME: mkdtempSync(join(tmpdir(), "foxcache-mcp-")) };
  await updateNodeStore(async (store) => {
    await store.put("memories", { provider: "chatgpt", id: "m1", text: "Prefers metric units." });
    await store.put("preferences", { provider: "claude", kind: "response-style", text: "Keep answers short." });
    await store.put("conversations", { provider: "claude", id: "c1", title: "Lisbon", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", messages: [{ role: "user", text: "Plan three days in Lisbon", attachments: [] }] });
  }, env);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer({ env, allowConversations }).connect(a);
  const client = new Client({ name: "test", version: "1" });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { text: r.content[0]!.text, isError: Boolean(r.isError) };
  };
  return { client, call };
}

describe("foxcache MCP server", () => {
  it("M1 M3 has two read-only tools by default, and no conversation tool", async () => {
    const { client, call } = await connect(false);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).toSorted()).toEqual(["list_memories", "list_preferences"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    expect((await call("search_conversations", { query: "lisbon" })).isError).toBe(true);
  });

  it("lists memories and preferences, by provider too", async () => {
    const { call } = await connect(false);
    expect(JSON.parse((await call("list_memories")).text)).toEqual([{ provider: "chatgpt", id: "m1", text: "Prefers metric units." }]);
    expect(JSON.parse((await call("list_memories", { provider: "claude" })).text)).toEqual([]);
    expect(JSON.parse((await call("list_preferences")).text)).toEqual([{ provider: "claude", kind: "response-style", text: "Keep answers short." }]);
  });

  it("with --allow conversations, searches and reads conversations", async () => {
    const { client, call } = await connect(true);
    expect((await client.listTools()).tools.map((t) => t.name).toSorted()).toEqual(["get_conversation", "list_memories", "list_preferences", "search_conversations"]);
    expect(JSON.parse((await call("search_conversations", { query: "lisbon" })).text)).toEqual([{ id: "claude:c1", provider: "claude", title: "Lisbon", snippet: "Plan three days in Lisbon" }]);
    expect(JSON.parse((await call("get_conversation", { id: "claude:c1" })).text)).toMatchObject({ id: "c1", messages: [{ text: "Plan three days in Lisbon" }] });
  });

  it("M2 bad arguments give a tool error, not a crash", async () => {
    const { call } = await connect(true);
    expect(await call("get_conversation", { id: "claude:none" })).toEqual({ text: "foxcache: not-found: No conversation has the id claude:none.", isError: true });
    expect((await call("search_conversations", { query: "" })).isError).toBe(true);
    expect((await call("list_memories", { provider: "bard" })).isError).toBe(true);
    expect((await call("search_conversations", { query: "x", limit: 1000 })).isError).toBe(true);
  });
});
