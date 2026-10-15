// NB1-NB4 in docs/providers/notebooklm.md, through the adapter's own reads.
import { describe, expect, it } from "vitest";
import { FoxcacheError, MAX_TEXT, check, notebooklm } from "../src/index.js";
import { fixture, fixtureHttp, type Routes } from "./fixture-http.js";

const PATH = "/_/LabsTailwindUi/data/batchexecute";
const AT = "AJpMQsynthetic-notebook-xsrf:1760000000000";
const TAIL = "hl=en&rt=c&bl=boq_labs-tailwind-frontend_20261001.00_p0&f.sid=-987654321";
const N1 = "0a1b2c3d-1111-4222-8333-444455556666";
const N2 = "0a1b2c3d-2222-4222-8333-444455556666";
const post = (rpcid: string, sourcePath: string) => `POST ${PATH}?rpcids=${rpcid}&source-path=${sourcePath}&${TAIL}`;
const be = (rpcid: string, result: unknown) => ({ $batchexecute: { [rpcid]: result } });
const LIST = post("wXbhsf", "/");
const TURNS = post("khqZz", `/notebook/${N1}`);
const meta = [1, null, null, null, null, [1790000000, 0], null, null, [1780000000, 0]];
const STUB = { id: N1, title: "Thesis sources", updatedAt: "2026-09-21T14:13:20.000Z" };
const open = (routes: Routes = {}) => fixtureHttp(notebooklm, { ...fixture("notebooklm"), ...routes });

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("notebooklm detect (NB4)", () => {
  it("is signed in when the notebook list answers", async () => {
    const f = open();
    expect(await notebooklm.detect(f.http)).toBe(true);
    expect(f.calls).toEqual(["/", LIST]);
  });
  it("is signed out on a guest page or a 401", async () => {
    expect(await notebooklm.detect(open({ "/": { $text: "<html>Sign in</html>" } }).http)).toBe(false);
    expect(await notebooklm.detect(open({ [LIST]: { $status: 401 } }).http)).toBe(false);
  });
});

describe("notebooklm list", () => {
  it("lists the notebooks that have a chat (NB2), in one page", async () => {
    const f = open();
    expect(await notebooklm.listConversations(f.http)).toEqual({ items: [STUB], next: undefined });
    expect(f.calls.slice(1)).toEqual([LIST, post("hPTbtc", `/notebook/${N1}`), post("hPTbtc", `/notebook/${N2}`)]);
  });
  it("takes the created time of a notebook never viewed", async () => {
    const routes = { [LIST]: be("wXbhsf", [[["T", null, N1, null, null, [1, null, null, null, null, null, null, null, [1780000000, 0]]]]]) };
    expect((await notebooklm.listConversations(open(routes).http)).items).toEqual([{ id: N1, title: "T", updatedAt: "2026-05-28T20:26:40.000Z" }]);
  });
  it.each([[null], [[null]], [[[]]]])("reads %j as no notebooks", async (result) => {
    expect(await notebooklm.listConversations(open({ [LIST]: be("wXbhsf", result) }).http)).toEqual({ items: [], next: undefined });
  });
  it.each([
    ["rows that are not a list", [{ rows: [] }], /wXbhsf\[0\] is not a list/],
    ["a notebook id with a slash", [[["T", null, "../x", null, null, meta]]], /wXbhsf\[0\]\[0\]\[2\] is not a notebook id/],
    ["a title that is not text", [[[7, null, N1, null, null, meta]]], /wXbhsf\[0\]\[0\]\[0\] is not text/],
    ["no created time", [[["T", null, N1, null, null, [1]]]], /wXbhsf\[0\]\[0\]\[5\]\[8\] is not a list/],
  ])("NB1 throws provider-schema on %s", async (_, result, why) => {
    const message = await code(notebooklm.listConversations(open({ [LIST]: be("wXbhsf", result) }).http));
    expect(message).toMatch(/^provider-schema: notebooklm: /);
    expect(message).toMatch(why);
  });
});

describe("notebooklm conversations", () => {
  it("reads the latest chat oldest first, in its notebook, and passes the foxcache/v1 check", async () => {
    const c = check("conversations", await notebooklm.getConversation(open().http, STUB));
    expect(c.messages.map((m) => [m.role, m.text])).toEqual([
      ["user", "What does chapter 1 argue?"],
      ["assistant", "Chapter 1 argues <script>alert(1)</script> is text."],
    ]);
    expect([c.provider, c.id, c.projectId, c.title, c.createdAt, c.updatedAt]).toEqual(["notebooklm", N1, N1, "Thesis sources", STUB.updatedAt, STUB.updatedAt]);
    expect(JSON.stringify(c)).not.toContain(AT);
  });
  it("NB2 throws not-found when the chat is gone since the list", async () => {
    expect(await code(notebooklm.getConversation(open({ [post("hPTbtc", `/notebook/${N1}`)]: be("hPTbtc", []) }).http, STUB))).toMatch(/^not-found: notebooklm: /);
  });
  it("NB3 throws too-large for a chat of 1000 turns, which khqZz would cut", async () => {
    const turns = Array.from({ length: 1000 }, () => [null, null, 1, "q"]);
    expect(await code(notebooklm.getConversation(open({ [TURNS]: be("khqZz", [turns]) }).http, STUB))).toMatch(/^too-large: notebooklm: /);
  });
  it("cuts a huge answer to the text limit and marks it", async () => {
    const c = check("conversations", await notebooklm.getConversation(open({ [TURNS]: be("khqZz", [[[null, null, 2, null, [["x".repeat(MAX_TEXT + 5)]]]]]) }).http, STUB));
    expect([c.messages[0]!.text.length, c.messages[0]!.truncated]).toEqual([MAX_TEXT, true]);
  });
  it.each([
    ["a role that is not 1 or 2", [[[null, null, 3, "q"]]], /khqZz\[0\]\[0\]\[2\] is 3/],
    ["a question that is not text", [[[null, null, 1, ["q"]]]], /khqZz\[0\]\[0\]\[3\] is not text/],
    ["an answer that is not text", [[[null, null, 2, null, [[5]]]]], /khqZz\[0\]\[0\]\[4\]\[0\]\[0\] is not text/],
  ])("NB1 throws provider-schema on %s", async (_, result, why) => {
    const message = await code(notebooklm.getConversation(open({ [TURNS]: be("khqZz", result) }).http, STUB));
    expect(message).toMatch(/^provider-schema: notebooklm: /);
    expect(message).toMatch(why);
  });
  it("NB4 gives rate-limited on a 429 and on status 8", async () => {
    expect(await code(notebooklm.getConversation(open({ [TURNS]: { $status: 429 } }).http, STUB))).toMatch(/^rate-limited: /);
    const status8 = `)]}'\n\n40\n${JSON.stringify([["wrb.fr", "khqZz", null, null, null, [8], "generic"]])}`;
    expect(await code(notebooklm.getConversation(open({ [TURNS]: { $text: status8 } }).http, STUB))).toMatch(/^rate-limited: /);
  });
});

describe("notebooklm projects", () => {
  it("reads each notebook with its chat prompt and its sources' names, never their text", async () => {
    expect((await notebooklm.projects!(open().http)).map((p) => check("projects", p))).toEqual([
      { provider: "notebooklm", id: N1, name: "Thesis sources", instructions: "Answer as a thesis advisor.", files: [{ name: "chapter1.pdf", id: "src-synthetic-1" }, { name: "Field notes", id: "drive-synthetic-2" }] },
      { provider: "notebooklm", id: N2, name: "Recipes", files: [] },
    ]);
  });
  it("NB1 throws provider-schema on a source with no id", async () => {
    const bad = be("rLM1Ne", [["T", [[[null, true, []], "x"]], N1, null, null, meta, null, null]]);
    expect(await code(notebooklm.projects!(open({ [post("rLM1Ne", `/notebook/${N1}`)]: bad }).http))).toMatch(/^provider-schema: notebooklm: rLM1Ne\[0\]\[1\]\[0\]\[0\] is not a source id/);
  });
});
