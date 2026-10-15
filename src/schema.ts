// The foxcache/v1 records and their checks. Every record that enters a store
// or an archive goes through check(), which keeps the named fields only, so
// raw provider JSON never reaches the store (S2).
import { FoxcacheError } from "./errors.js";

export const SCHEMA = "foxcache/v1";
// One id per line, so providers added in parallel do not edit the same line.
export const PROVIDERS = [
  "chatgpt",
  "claude",
  "mistral",
  "gemini",
  "perplexity",
  "grok",
  "deepseek",
  "github-copilot",
  "kimi",
] as const;
export type ProviderId = (typeof PROVIDERS)[number];
export const ROLES = ["user", "assistant", "system", "tool"] as const;
export type Role = (typeof ROLES)[number];
export const PREFERENCE_KINDS = ["about-me", "response-style", "instructions", "name", "occupation"] as const;
export type PreferenceKind = (typeof PREFERENCE_KINDS)[number];
export const LIBRARY_KINDS = ["gpt", "gem", "style", "agent", "space"] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];
export const KINDS = ["conversations", "projects", "memories", "preferences", "library"] as const;
export type Kind = (typeof KINDS)[number];

/** A message text longer than this is cut and marked truncated (S4). */
export const MAX_TEXT = 1_000_000;
/** A conversation with more messages than this is refused (S4). */
export const MAX_MESSAGES = 20_000;
const MAX_SHORT = 2_000;

/** File metadata only. foxcache never stores a file or its extracted text. */
export interface Attachment {
  name: string;
  id?: string;
  mimeType?: string;
  size?: number;
}
export interface Message {
  role: Role;
  text: string;
  createdAt?: string;
  attachments: Attachment[];
  truncated?: true;
}
export interface Conversation {
  provider: ProviderId;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  projectId?: string;
  messages: Message[];
}
export interface Project {
  provider: ProviderId;
  id: string;
  name: string;
  instructions?: string;
  files: Attachment[];
}
export interface Memory {
  provider: ProviderId;
  id?: string;
  text: string;
  createdAt?: string;
}
export interface Preference {
  provider: ProviderId;
  kind: PreferenceKind;
  text: string;
}
export interface LibraryItem {
  provider: ProviderId;
  id: string;
  name: string;
  kind: LibraryKind;
}
export interface RecordOf {
  conversations: Conversation;
  projects: Project;
  memories: Memory;
  preferences: Preference;
  library: LibraryItem;
}
export type AnyRecord = RecordOf[Kind];

type Obj = Record<string, unknown>;
const bad = (path: string, why: string) => new FoxcacheError("invalid-record", `${path}: ${why}`);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;
// 1-200 printable characters, no slash, not "." or "..". C0, DEL and C1 control characters are refused.
// oxlint-disable-next-line no-control-regex -- the control characters are what it refuses
const ID = /^(?!\.{1,2}$)[^\u0000-\u001f\u007f-\u009f/]{1,200}$/;

/** Remove NUL and replace lone surrogates (S5). */
export function cleanText(text: string): string {
  return text.replaceAll("\u0000", "").replace(LONE_SURROGATE, "�");
}

function obj(x: unknown, path: string): Obj {
  if (typeof x !== "object" || x === null || Array.isArray(x)) throw bad(path, "must be an object");
  return x as Obj;
}
function str(o: Obj, key: string, path: string, max = MAX_SHORT): string {
  const v = o[key];
  if (typeof v !== "string") throw bad(`${path}${key}`, "must be text");
  const text = cleanText(v);
  if (text.length > max) throw bad(`${path}${key}`, `is longer than ${max} characters`);
  return text;
}
function optStr(o: Obj, key: string, path: string, max = MAX_SHORT): string | undefined {
  return o[key] === undefined ? undefined : str(o, key, path, max);
}
function oneOf<T extends string>(o: Obj, key: string, path: string, values: readonly T[]): T {
  const v = o[key];
  if (!values.includes(v as T)) throw bad(`${path}${key}`, `must be one of ${values.join(", ")}`);
  return v as T;
}
function id(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string" || !ID.test(v)) throw bad(`${path}${key}`, "must be 1-200 printable characters without /");
  return v;
}
function time(o: Obj, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string" || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw bad(`${path}${key}`, "must be an ISO-8601 time with a zone");
  return new Date(v).toISOString();
}
function list(o: Obj, key: string, path: string): unknown[] {
  const v = o[key];
  if (!Array.isArray(v)) throw bad(`${path}${key}`, "must be a list");
  return v;
}
/** Copy the keys whose value is not undefined, in order. */
function compact<T extends Obj>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

function checkAttachment(x: unknown, path: string): Attachment {
  const o = obj(x, path);
  const size = o.size;
  if (size !== undefined && (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)) throw bad(`${path}.size`, "must be a whole number of bytes");
  return compact({ name: str(o, "name", `${path}.`), id: optStr(o, "id", `${path}.`), mimeType: optStr(o, "mimeType", `${path}.`, 200), size: size as number | undefined });
}

function checkMessage(x: unknown, path: string): Message {
  const o = obj(x, path);
  if (typeof o.text !== "string") throw bad(`${path}.text`, "must be text");
  let text = cleanText(o.text);
  const truncated = text.length > MAX_TEXT || o.truncated === true;
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);
  return compact({
    role: oneOf(o, "role", `${path}.`, ROLES),
    text,
    createdAt: o.createdAt === undefined ? undefined : time(o, "createdAt", `${path}.`),
    attachments: list(o, "attachments", `${path}.`).map((a, i) => checkAttachment(a, `${path}.attachments[${i}]`)),
    truncated: truncated ? (true as const) : undefined,
  });
}

export function checkConversation(x: unknown): Conversation {
  const o = obj(x, "conversation");
  const messages = list(o, "messages", "");
  if (messages.length > MAX_MESSAGES) throw new FoxcacheError("too-large", `The conversation has ${messages.length} messages; foxcache keeps at most ${MAX_MESSAGES}.`);
  return compact({
    provider: oneOf(o, "provider", "", PROVIDERS),
    id: id(o, "id", ""),
    title: str(o, "title", ""),
    createdAt: time(o, "createdAt", ""),
    updatedAt: time(o, "updatedAt", ""),
    model: optStr(o, "model", "", 200),
    projectId: o.projectId === undefined ? undefined : id(o, "projectId", ""),
    messages: messages.map((m, i) => checkMessage(m, `messages[${i}]`)),
  });
}

export function checkProject(x: unknown): Project {
  const o = obj(x, "project");
  return compact({
    provider: oneOf(o, "provider", "", PROVIDERS),
    id: id(o, "id", ""),
    name: str(o, "name", ""),
    instructions: optStr(o, "instructions", "", MAX_TEXT),
    files: list(o, "files", "").map((f, i) => checkAttachment(f, `files[${i}]`)),
  });
}

export function checkMemory(x: unknown): Memory {
  const o = obj(x, "memory");
  return compact({
    provider: oneOf(o, "provider", "", PROVIDERS),
    id: o.id === undefined ? undefined : id(o, "id", ""),
    text: str(o, "text", "", MAX_TEXT),
    createdAt: o.createdAt === undefined ? undefined : time(o, "createdAt", ""),
  });
}

export function checkPreference(x: unknown): Preference {
  const o = obj(x, "preference");
  return { provider: oneOf(o, "provider", "", PROVIDERS), kind: oneOf(o, "kind", "", PREFERENCE_KINDS), text: str(o, "text", "", MAX_TEXT) };
}

export function checkLibraryItem(x: unknown): LibraryItem {
  const o = obj(x, "library item");
  return { provider: oneOf(o, "provider", "", PROVIDERS), id: id(o, "id", ""), name: str(o, "name", ""), kind: oneOf(o, "kind", "", LIBRARY_KINDS) };
}

const CHECKS: { [K in Kind]: (x: unknown) => RecordOf[K] } = {
  conversations: checkConversation,
  projects: checkProject,
  memories: checkMemory,
  preferences: checkPreference,
  library: checkLibraryItem,
};

/** Check a record of one kind. Throws invalid-record or too-large. */
export function check<K extends Kind>(kind: K, x: unknown): RecordOf[K] {
  return CHECKS[kind](x);
}

/** FNV-1a, 64 bit, as 16 hex digits: the same in Firefox and Node, with no crypto API. */
export function hash64(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(text)) h = BigInt.asUintN(64, (h ^ BigInt(byte)) * 0x100000001b3n);
  return h.toString(16).padStart(16, "0");
}

/** The store key of a record: <provider>:<id>. A memory with no id gets a hash of its text (ST2). */
export function recordKey(kind: Kind, record: AnyRecord): string {
  if (kind === "preferences") return `${record.provider}:${(record as Preference).kind}`;
  if (kind === "memories" && (record as Memory).id === undefined) return `${record.provider}:m-${hash64((record as Memory).text)}`;
  return `${record.provider}:${(record as { id: string }).id}`;
}
