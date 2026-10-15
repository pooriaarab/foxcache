// The MD5 codec for request tags (Poe poe-tag-id). Web Crypto has no MD5,
// so foxcache has its own; node:crypto checks it here.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5 } from "../src/md5.js";

const node = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

describe("md5", () => {
  // RFC 1321, appendix A.5.
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    ["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", "d174ab98d277d9f5a5611c2c9f419d9f"],
    ["12345678901234567890123456789012345678901234567890123456789012345678901234567890", "57edf4a22be3c955ac49da2e2107b67a"],
  ])("gives the RFC 1321 digest of %j", (text, digest) => {
    expect(md5(text)).toBe(digest);
  });
  it("pads every length across the block edges as node:crypto does", () => {
    for (let n = 0; n <= 200; n++) {
      const text = "x".repeat(n);
      expect(md5(text), `length ${n}`).toBe(node(text));
    }
  });
  it("hashes the UTF-8 bytes of text that is not ASCII", () => {
    for (const text of ["Café Lisboa", "日本の旅", "emoji 🦊 and \u0000 nul", '{"queryName":"ChatListPaginationQuery","variables":{"title":"<b>é</b>"}}']) expect(md5(text)).toBe(node(text));
  });
  it("hashes a body of a few hundred kilobytes", () => {
    const text = JSON.stringify({ variables: { blob: "a1b2".repeat(100_000) } });
    expect(md5(text)).toBe(node(text));
  });
});
