// The exports: Markdown with one file per conversation, the memory list
// that foxpack reads, and a small zip writer for the extension, which has
// no zlib. The archive JSON itself is in archive.ts.
import type { Archive } from "./archive.js";
import { FoxcacheError } from "./errors.js";
import type { Attachment, Conversation } from "./schema.js";

export interface OutFile {
  path: string;
  text: string;
}

/** Escape HTML, and disarm script links, so a Markdown viewer shows the text and runs nothing (O2). */
function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/\]\(\s*(javascript|vbscript|data):/gi, "](unsafe-$1:");
}
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

function attachment(a: Attachment): string {
  const facts = [a.mimeType, a.size === undefined ? undefined : `${a.size} bytes`].filter(Boolean);
  return escape(oneLine(a.name)) + (facts.length ? ` (${facts.join(", ")})` : "");
}

export function toMarkdown(c: Conversation): string {
  const facts = [
    ["Provider", c.provider],
    ["Id", c.id],
    ["Created", c.createdAt],
    ["Updated", c.updatedAt],
    ["Model", c.model],
    ["Project", c.projectId],
  ].filter(([, v]) => v !== undefined);
  const out = [`# ${escape(oneLine(c.title)) || "Untitled"}`, "", ...facts.map(([k, v]) => `- ${k}: ${escape(v!)}`), ""];
  for (const m of c.messages) {
    const role = m.role[0]!.toUpperCase() + m.role.slice(1);
    out.push(`## ${role}${m.createdAt ? `, ${m.createdAt}` : ""}`, "", escape(m.text), "");
    if (m.truncated) out.push("(foxcache cut this message at 1 000 000 characters.)", "");
    if (m.attachments.length) out.push(`Attachments: ${m.attachments.map(attachment).join("; ")}`, "");
  }
  return out.join("\n");
}

/** A file name part: ASCII letters and digits, at most 60 characters (O1). */
export function slug(title: string): string {
  const s = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return s || "untitled";
}

/** One Markdown file per conversation, at <provider>/<date>-<slug>.md. A repeated name gets -2, -3 ... */
export function markdownFiles(archive: Archive): OutFile[] {
  const used = new Set<string>();
  return archive.conversations.map((c) => {
    const base = `${c.provider}/${c.createdAt.slice(0, 10)}-${slug(c.title)}`;
    let path = `${base}.md`;
    for (let n = 2; used.has(path); n++) path = `${base}-${n}.md`;
    used.add(path);
    return { path, text: toMarkdown(c) };
  });
}

/** The memory list for foxpack: a header, then one "- [provider] text" line per memory (O3). */
export function toMemoryList(archive: Archive): string {
  const lines = archive.memories.map((m) => `- [${m.provider}] ${oneLine(m.text)}`);
  return [`# foxcache memories, exported ${archive.exportedAt}`, ...lines, ""].join("\n");
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with stored (not deflated) entries and UTF-8 names. Names must be safe relative paths (O4). */
export function zip(files: OutFile[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const file of files) {
    if (!/^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/.test(file.path) || file.path.includes("..")) throw new FoxcacheError("bad-request", `The zip name ${JSON.stringify(file.path)} is unsafe.`);
    if (seen.has(file.path)) throw new FoxcacheError("bad-request", `The zip name ${file.path} is there twice.`);
    seen.add(file.path);
    const name = enc.encode(file.path);
    const data = enc.encode(file.text);
    const head = new Uint8Array(30 + name.length);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(12, 0x21, true); // 1980-01-01
    v.setUint32(14, crc32(data), true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    head.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const e = new DataView(entry.buffer);
    e.setUint32(0, 0x02014b50, true);
    e.setUint16(4, 20, true);
    entry.set(head.subarray(4, 30), 6);
    e.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(head, data);
    central.push(entry);
    offset += head.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const d = new DataView(end.buffer);
  d.setUint32(0, 0x06054b50, true);
  d.setUint16(8, central.length, true);
  d.setUint16(10, central.length, true);
  d.setUint32(12, size, true);
  d.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const b of [...parts, ...central, end]) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}
