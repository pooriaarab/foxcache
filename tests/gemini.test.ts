// GE1-GE5 in docs/providers/gemini.md, through the adapter's own reads.
import { describe, expect, it } from "vitest";
import { type Checkpoint, FoxcacheError, MAX_TEXT, check, gemini, runCapture } from "../src/index.js";
import { batchWire, fixture, fixtureHttp, type Routes } from "./fixture-http.js";

const PATH = "/_/BardChatUi/data/batchexecute";
const AT = "AJpMQsynthetic-xsrf-token:1760000000000";
const TAIL = "hl=en&rt=c&bl=boq_assistant-bard-web-server_20261001.00_p0&f.sid=-1234567890";
const A = "a1b2c3d4e5f60708";
const B = "0f1e2d3c4b5a6978";
const post = (rpcid: string, sourcePath: string) => `POST ${PATH}?rpcids=${rpcid}&source-path=${sourcePath}&${TAIL}`;
/** The fixture key of one call with its exact body, for answers that differ by args. */
const call = (rpcid: string, args: unknown, sourcePath: string) => `${post(rpcid, sourcePath)} ${new URLSearchParams({ "f.req": JSON.stringify([[[rpcid, JSON.stringify(args), null, "generic"]]]), at: AT })}`;
const be = (rpcid: string, result: unknown) => ({ $batchexecute: { [rpcid]: result } });
const LIST = post("MaZiqc", "/app");
const CHAT_A = post("hNvQHb", `/app/${A}`);
const row = (id: string, title: unknown, pinned: true | null, seconds: unknown = 1789000000) => [id, title, pinned, null, null, [seconds, 0], null, null, null, 2];
const turn = (q: unknown, a: unknown, seconds = 1789000000) => [["c_x", "r_1"], ["c_x", "r_1", "rc_1"], [[q], 1, null, 0], [[["rc_1", [a], [], null, null, null, null, null, [2]]]], [seconds, 0]];
const stub = (id: string) => ({ id, title: "T", updatedAt: "2026-09-21T14:13:20.500Z" });
const open = (routes: Routes = {}) => fixtureHttp(gemini, { ...fixture("gemini"), ...routes });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("gemini detect (GE5)", () => {
  it("is signed in with the page tokens", async () => {
    const f = open();
    expect(await gemini.detect(f.http)).toBe(true);
    expect(f.calls).toEqual(["/app", post("ESY5D", "/app")]);
  });
  it("is signed out on a guest page, a sign-in redirect or a 401", async () => {
    expect(await gemini.detect(open({ "/app": { $text: '<script>WIZ_global_data = {"cfb2h":"bl","FdrFJe":"1"}</script>' } }).http)).toBe(false);
    expect(await gemini.detect(open({ "/app": { $status: 302 } }).http)).toBe(false);
    expect(await gemini.detect(open({ [post("ESY5D", "/app")]: { $status: 401 } }).http)).toBe(false);
  });
  it("H40 is signed out when Google answers status 7", async () => {
    const status7 = `)]}'\n\n40\n${JSON.stringify([["wrb.fr", "ESY5D", null, null, null, [7], "generic"]])}`;
    expect(await gemini.detect(open({ [post("ESY5D", "/app")]: { $text: status7 } }).http)).toBe(false);
  });
});

describe("gemini list", () => {
  it("reads the pinned stream, then the rest, and reads each chat once (GE3)", async () => {
    const f = open();
    const pinned = await gemini.listConversations(f.http);
    expect(pinned).toEqual({ items: [{ id: A, title: "Lisbon in three days", updatedAt: "2026-09-21T14:13:20.500Z" }], next: "0:" });
    const rest = await gemini.listConversations(f.http, pinned.next);
    expect(rest).toEqual({ items: [{ id: B, title: "<b>Hostile</b> title", updatedAt: "2026-09-10T00:26:40.500Z" }], next: undefined });
  });
  it("follows the next-page token of a stream", async () => {
    const routes = { [call("MaZiqc", [20, null, [0, null, 1]], "/app")]: be("MaZiqc", [null, "tok-2", [row(`c_${A}`, "One", null)]]), [call("MaZiqc", [20, "tok-2", [0, null, 1]], "/app")]: be("MaZiqc", [null, null, [row(`c_${B}`, "Two", null)]]) };
    const f = open(routes);
    const first = await gemini.listConversations(f.http, "0:");
    expect([first.items.map((s) => s.id), first.next]).toEqual([[A], "0:tok-2"]);
    const second = await gemini.listConversations(f.http, first.next);
    expect([second.items.map((s) => s.id), second.next]).toEqual([[B], undefined]);
  });
  it("reads an empty stream as no chats", async () => {
    expect(await gemini.listConversations(open({ [LIST]: be("MaZiqc", []) }).http)).toEqual({ items: [], next: "0:" });
  });
  it.each([
    ["rows that are not a list", [null, null, { rows: [] }], /MaZiqc\[2\] is not a list/],
    ["a chat id that is not c_ and letters", [null, null, [row("c_../../x", "T", true)]], /MaZiqc\[2\]\[0\]\[0\] is not a chat id/],
    ["a title that is not text", [null, null, [row(`c_${A}`, 7, true)]], /MaZiqc\[2\]\[0\]\[1\] is not text/],
    ["a time that is not seconds", [null, null, [row(`c_${A}`, "T", true, "soon")]], /MaZiqc\[2\]\[0\]\[5\]\[0\] is not a number/],
  ])("GE1 throws provider-schema on %s", async (_, result, why) => {
    const message = await code(gemini.listConversations(open({ [LIST]: be("MaZiqc", result) }).http));
    expect(message).toMatch(/^provider-schema: gemini: /);
    expect(message).toMatch(why);
  });
  it("throws provider-schema when Google renamed the rpc id", async () => {
    expect(await code(gemini.listConversations(open({ [LIST]: { $text: batchWire({ XyZ123: [] }) } }).http))).toMatch(/^provider-schema: batchexecute MaZiqc: no frame/);
  });
  it("GE2 ends a stream that repeats its token with pagination-loop", async () => {
    const routes = { [LIST]: be("MaZiqc", [null, "same", [row(`c_${A}`, "T", true)]]), [post("hNvQHb", `/app/${A}`)]: be("hNvQHb", [[turn("q", "a")]]) };
    const cp: Checkpoint = await runCapture({ adapter: gemini, http: open(routes).http, stamps: {}, delayMs: 0, sink: { put: async () => ({ stop: false }), checkpoint: async () => ({ stop: false }), keep: async () => ({ stop: false }) } });
    expect([cp.status, cp.error?.code]).toEqual(["failed", "pagination-loop"]);
  });
});

describe("gemini conversations", () => {
  it("reads the turns oldest first and passes the foxcache/v1 check", async () => {
    const f = open();
    const c = check("conversations", await gemini.getConversation(f.http, stub(A)));
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "Plan three days in Lisbon"],
      ["assistant", "Day 1: Alfama. Day 2: Belem."],
      ["user", "And day 3?"],
      ["assistant", "Day 3: Sintra."],
    ]);
    expect([c.provider, c.id, c.createdAt, c.updatedAt]).toEqual(["gemini", A, "2026-09-21T11:26:40.000Z", "2026-09-21T14:13:20.500Z"]);
    expect(f.calls).toEqual(["/app", CHAT_A]);
  });
  it("keeps hostile text as text, and no record holds the page token", async () => {
    const c = await gemini.getConversation(open().http, stub(B));
    expect(c.messages.map((m) => m.text)).toEqual(["<img src=x onerror=alert(1)>", "I show <script>alert(2)</script> as text."]);
    expect(JSON.stringify(c)).not.toContain(AT);
  });
  it("reads a turn with no time, and takes the list time for the chat", async () => {
    const c = check("conversations", await gemini.getConversation(open({ [CHAT_A]: be("hNvQHb", [[turn("q", "a").slice(0, 4)]]) }).http, stub(A)));
    expect([c.messages[0]!.createdAt, c.createdAt, c.updatedAt]).toEqual([undefined, stub(A).updatedAt, stub(A).updatedAt]);
  });
  it("cuts a huge reply to the text limit and marks it", async () => {
    const c = check("conversations", await gemini.getConversation(open({ [CHAT_A]: be("hNvQHb", [[turn("q", "x".repeat(MAX_TEXT + 5))]]) }).http, stub(A)));
    expect([c.messages[1]!.text.length, c.messages[1]!.truncated]).toEqual([MAX_TEXT, true]);
  });
  it("GE4 throws too-large for a chat of 1000 turns, which hNvQHb would cut", async () => {
    const turns = Array.from({ length: 1000 }, () => turn("q", "a"));
    expect(await code(gemini.getConversation(open({ [CHAT_A]: be("hNvQHb", [turns]) }).http, stub(A)))).toMatch(/^too-large: gemini: /);
  });
  it.each([
    ["turns that are not a list", [{}], /hNvQHb\[0\] is not a list/],
    ["a prompt that is not text", [[turn(5, "a")]], /turns\[0\]\[2\]\[0\]\[0\] is not text/],
    ["a reply that is not text", [[turn("q", null)]], /turns\[0\]\[3\]\[0\]\[0\]\[1\]\[0\] is not text/],
  ])("GE1 throws provider-schema on %s", async (_, result, why) => {
    const message = await code(gemini.getConversation(open({ [CHAT_A]: be("hNvQHb", result) }).http, stub(A)));
    expect(message).toMatch(/^provider-schema: gemini: /);
    expect(message).toMatch(why);
  });
  it("GE5 gives rate-limited on a 429 and on status 8", async () => {
    expect(await code(gemini.getConversation(open({ [CHAT_A]: { $status: 429 } }).http, stub(A)))).toMatch(/^rate-limited: /);
    const status8 = `)]}'\n\n40\n${JSON.stringify([["wrb.fr", "hNvQHb", null, null, null, [8], "generic"]])}`;
    expect(await code(gemini.getConversation(open({ [CHAT_A]: { $text: status8 } }).http, stub(A)))).toMatch(/^rate-limited: /);
  });
});

describe("gemini Gems and saved info", () => {
  it("lists the user's Gems by name", async () => {
    expect((await gemini.library!(open().http)).map((g) => check("library", g))).toEqual([{ provider: "gemini", id: "gem-synthetic-1", name: "Travel planner", kind: "gem" }]);
  });
  it("reads no Gems as none", async () => {
    expect(await gemini.library!(open({ [post("CNgdBe", "/app")]: be("CNgdBe", []) }).http)).toEqual([]);
  });
  it("reads each saved-info item as a memory, and an empty list as none", async () => {
    expect((await gemini.memories!(open().http)).map((m) => check("memories", m))).toEqual([{ provider: "gemini", id: "saved-synthetic-1", text: "I am vegetarian.", createdAt: "2026-05-28T20:26:40.000Z" }]);
    expect(await gemini.memories!(open({ [post("ZKcapf", "/saved-info")]: be("ZKcapf", []) }).http)).toEqual([]);
  });
  it("GE1 throws provider-schema on a saved-info item with no text", async () => {
    expect(await code(gemini.memories!(open({ [post("ZKcapf", "/saved-info")]: be("ZKcapf", [[["id-1", null, [1, 0]]], "t"]) }).http))).toMatch(/^provider-schema: gemini: ZKcapf\[0\]\[0\]\[1\] is not text/);
  });
});
