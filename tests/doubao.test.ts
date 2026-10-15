// docs/providers/doubao.md: the Doubao failure modes D1-D7, through the
// adapter's own reads on the synthetic fixture.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoxcacheError, check, createHttp, doubao } from "../src/index.js";
import { type Routes, fixture, fixtureHttp } from "./fixture-http.js";

const Q = "version_code=20800&language=zh&device_platform=web&aid=497858&real_aid=497858&pkg_type=release_version&region=CN&sys_region=CN&samantha_web=1&web_platform=browser&use-olympus-account=1";
const LIST = `POST /im/chain/recent_conv?${Q}`;
const INFO = `POST /im/conversation/info?${Q}`;
const CHAIN = `POST /im/chain/single?${Q}`;
const D1 = "7420000000000000001";
const SEQ = "5e9e0000-0000-4000-8000-000000000000";
const open = (routes: Routes = fixture("doubao")) => fixtureHttp(doubao, routes);
const routes = (extra: Routes) => ({ ...fixture("doubao"), ...extra });
const stub = (id: string, title = "") => ({ id, title, updatedAt: "" });
const ok = (key: string, body: unknown) => ({ status_code: 0, status_desc: "", downlink_body: { [key]: body } });
const envelope = (cmd: number, key: string, payload: unknown) => JSON.stringify({ cmd, uplink_body: { [key]: payload }, sequence_id: SEQ, channel: 2, version: "1" });
const OPTION = { not_need_message: true, need_complete_conversation: true, need_coco_conversation: true, need_coco_bot: true, need_pc_pin_chain: true, pc_pin_query_type: 0 };
/** The exact request of a list page. */
const listAt = (version: number | string, direction: number) => `${LIST} ${envelope(3200, "pull_recent_conv_chain_uplink_body", { api_version: 1, conv_version: version, direction, limit: 50, message_count_per_conv: 0, option: OPTION })}`;
/** The exact request of a message page of D1. */
const chainAt = (anchor: number) => `${CHAIN} ${envelope(3100, "pull_singe_chain_uplink_body", { conversation_id: D1, anchor_index: anchor, conversation_type: 3, direction: 1, limit: 50, ext: {}, filter: { index_list: [] } })}`;
const messages = (list: unknown[], hasMore: boolean) => ok("pull_singe_chain_downlink_body", { messages: list, has_more: hasMore });
/** A list page of one chat. */
const listPage = (id: string, more: boolean) => ok("pull_recent_conv_chain_downlink_body", { cells: [{ conversation: { conversation_id: id, update_time: "1788336000" } }], next_conv_version: "1788336000123", has_more: more });
const msg = (i: number) => ({ message_id: `m${i}`, index_in_conv: String(i), user_type: 1, content_type: 1, content: JSON.stringify({ text: `t${i}` }), create_time: "1788300000" });

beforeEach(() => {
  vi.spyOn(crypto, "randomUUID").mockReturnValue(SEQ);
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (error) {
    if (error instanceof FoxcacheError) return `${error.code}: ${error.message}`;
    throw error;
  }
  return "no error";
}

describe("doubao requests", () => {
  it("sends the IM headers, the page's query and the envelope, and no token", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response(JSON.stringify(fixture("doubao")["POST /im/chain/recent_conv"]));
    };
    await doubao.detect(createHttp(doubao, { fetch, storage: { getItem: () => null }, scripts: () => [], call: () => undefined }));
    const headers = new Headers(sent[0]!.init.headers);
    expect([headers.get("content-type"), headers.get("agw-js-conv"), headers.get("authorization")]).toEqual(["application/json; encoding=utf-8", "str", null]);
    expect(sent[0]!.url).toBe(`https://www.doubao.com/im/chain/recent_conv?${Q}`);
    expect(JSON.parse(sent[0]!.init.body as string)).toMatchObject({ cmd: 3200, sequence_id: SEQ, channel: 2, version: "1", uplink_body: { pull_recent_conv_chain_uplink_body: { limit: 1, conv_version: 0, direction: 3 } } });
  });
  it("refuses an IM cmd the reads do not list on a read path (H9)", async () => {
    const f = open();
    expect(await code(f.http.post("/im/chain/single", { cmd: 3101 }, {}))).toMatch(/^not-allowed: /);
    expect(f.calls).toEqual([]);
  });
});

describe("doubao detect (D1, D2)", () => {
  it("is signed in when the list answers status 0, and signed out on a 401", async () => {
    expect(await doubao.detect(open().http)).toBe(true);
    expect(await doubao.detect(open(routes({ "POST /im/chain/recent_conv": { $status: 401 } })).http)).toBe(false);
  });
  it("throws provider-error with the code when status_code is not 0", async () => {
    expect(await code(doubao.detect(open(routes({ "POST /im/chain/recent_conv": { status_code: 710022004, status_desc: "<b>verify</b>" } })).http))).toBe("provider-error: doubao: /im/chain/recent_conv answered status 710022004.");
  });
});

describe("doubao list", () => {
  it("reads the cells, with times in seconds or milliseconds as text or numbers (D4)", async () => {
    expect(await doubao.listConversations(open().http)).toEqual({
      items: [
        { id: D1, title: "周末去杭州", updatedAt: "2026-09-02T08:00:00.000Z" },
        { id: "7420000000000000002", title: "Notes", updatedAt: "2026-08-31T18:15:00.000Z" },
      ],
      next: undefined,
    });
  });
  it("pages by next_conv_version, older from the second page", async () => {
    const f = open(routes({ [listAt(0, 3)]: listPage("a", true), [listAt(1788336000123, 1)]: listPage("b", false) }));
    const first = await doubao.listConversations(f.http);
    expect(first.next).toBe("1788336000123");
    expect(await doubao.listConversations(f.http, first.next)).toEqual({ items: [{ id: "b", title: "", updatedAt: "2026-09-02T08:00:00.000Z" }], next: undefined });
  });
  it.each([
    ["no downlink body", { status_code: 0 }, /\/im\/chain\/recent_conv downlink_body is not an object/],
    ["cells is not a list", ok("pull_recent_conv_chain_downlink_body", { cells: {} }), /recent_conv cells is not a list/],
    ["a cell has no conversation", ok("pull_recent_conv_chain_downlink_body", { cells: [{}] }), /cells\[0\].conversation is not an object/],
    ["a time is not epoch", ok("pull_recent_conv_chain_downlink_body", { cells: [{ conversation: { conversation_id: "a", update_time: "2026-09-02" } }] }), /cells\[0\].update_time is not a time/],
    ["has_more with no next_conv_version", ok("pull_recent_conv_chain_downlink_body", { cells: [{ conversation: { conversation_id: "a", update_time: 1 } }], has_more: true }), /recent_conv next_conv_version is not text/],
  ])("throws provider-schema when %s (D3, D4)", async (_, answer, why) => {
    expect(await code(doubao.listConversations(open(routes({ [listAt(0, 3)]: answer })).http))).toMatch(new RegExp(`^provider-schema: doubao: ${why.source}`));
  });
  it("passes a 429 on as rate-limited (H3)", async () => {
    expect(await code(doubao.listConversations(open(routes({ [listAt(0, 3)]: { $status: 429 } })).http))).toMatch(/^rate-limited: /);
  });
});

describe("doubao conversations", () => {
  it("reads every text shape, oldest first, and keeps hostile text as text (S3)", async () => {
    const c = check("conversations", await doubao.getConversation(open().http, stub(D1, "周末去杭州")));
    expect(c).toMatchObject({ provider: "doubao", id: D1, title: "周末去杭州", createdAt: "2026-09-01T22:00:00.000Z", updatedAt: "2026-09-02T08:00:00.000Z" });
    expect(c.messages.map((m) => [m.role, m.text, m.createdAt])).toEqual([
      ["user", "周末去杭州玩两天？", "2026-09-01T22:00:00.000Z"],
      ["assistant", "两天够了。", "2026-09-01T22:00:10.000Z"],
      ["user", "<img src=x onerror=alert(1)>", "2026-09-02T07:59:50.000Z"],
      ["assistant", "西湖边走走，\n\n再去灵隐寺。", "2026-09-02T08:00:00.000Z"],
    ]);
    expect(JSON.stringify(c)).not.toMatch(/example\.invalid|card/);
  });
  it("pages older from the smallest index, and keeps a repeated anchor message once (D6)", async () => {
    const f = open(routes({ [chainAt(Number.MAX_SAFE_INTEGER)]: messages([msg(4), msg(3)], true), [chainAt(3)]: messages([msg(3), msg(2), msg(1)], false) }));
    expect((await doubao.getConversation(f.http, stub(D1))).messages.map((m) => m.text)).toEqual(["t1", "t2", "t3", "t4"]);
  });
  it("throws pagination-loop when has_more is true and no older message comes (D5)", async () => {
    const f = open(routes({ [chainAt(Number.MAX_SAFE_INTEGER)]: messages([msg(4)], true), [chainAt(4)]: messages([msg(4)], true) }));
    expect(await code(doubao.getConversation(f.http, stub(D1)))).toMatch(/^pagination-loop: doubao: \/im\/chain\/single gave no older message/);
  });
  it("throws pagination-loop when the pages never end (D5, P9)", async () => {
    const pages: Routes = { [chainAt(Number.MAX_SAFE_INTEGER)]: messages([msg(5000)], true) };
    for (let i = 5000; i > 3000; i--) pages[chainAt(i)] = messages([msg(i - 1)], true);
    expect(await code(doubao.getConversation(open(routes(pages)).http, stub(D1)))).toMatch(/^pagination-loop: doubao: \/im\/chain\/single did not end after 1000 pages/);
  });
  it("throws too-large while it reads, once the chat passes the message limit (D7)", async () => {
    const huge = messages(Array.from({ length: 20_001 }, (_, i) => msg(i + 1)), true);
    expect(await code(doubao.getConversation(open(routes({ [chainAt(Number.MAX_SAFE_INTEGER)]: huge })).http, stub(D1)))).toMatch(/^too-large: doubao: /);
  });
  it.each([
    ["an index that is not a number", { ...msg(1), index_in_conv: "one" }, /message m1.index_in_conv is not an index/],
    ["a user_type that is not a number", { ...msg(1), user_type: "1" }, /message m1.user_type is not a number/],
    ["a text block with no text", { ...msg(1), content_block: [{ block_type: 10000, content: {} }] }, /message m1.content_block\[0\].content.text_block is not an object/],
    ["a block list that is not JSON", { ...msg(1), content_type: 9999, content: "[{" }, /message m1.content is not JSON/],
  ])("throws provider-schema on %s (D3)", async (_, m, why) => {
    expect(await code(doubao.getConversation(open(routes({ "POST /im/chain/single": messages([m], false) })).http, stub(D1)))).toMatch(new RegExp(`^provider-schema: doubao: ${why.source}`));
  });
  it("throws provider-error when info answers a status that is not 0 (D2)", async () => {
    expect(await code(doubao.getConversation(open(routes({ [INFO]: { status_code: 712010702, status_desc: "error" } })).http, stub(D1)))).toBe("provider-error: doubao: /im/conversation/info answered status 712010702.");
  });
});
