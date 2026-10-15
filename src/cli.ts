// The foxcache command. runCli takes the arguments and the output streams,
// so tests run it in process. Exit codes: 0 done, 1 a foxcache error, 2 bad usage.
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { MAX_ARCHIVE_BYTES, importArchive, toArchive } from "./archive.js";
import { FoxcacheError } from "./errors.js";
import { serveMcp } from "./mcp.js";
import { openNodeStore, updateNodeStore } from "./node.js";
import { markdownFiles, toMarkdown, toMemoryList } from "./outputs.js";
import { KINDS, type Kind, PROVIDERS, type ProviderId, type RecordOf, recordKey } from "./schema.js";

export const USAGE = `Usage: foxcache <command>

  import <archive>                      Merge an archive file that the extension exported
  list [--provider <p>] [--kind <k>]    Print one line per record
  search <text> [--provider <p>] [--kind <k>] [--limit <n>]
  show <id>                             Print one record; a conversation as Markdown
  export --json | --memories | --md <dir>
                                        Print the archive or the memory list, or write
                                        one Markdown file per conversation to an empty folder
  mcp [--allow conversations]           Serve the read-only MCP server on stdio. Without
                                        --allow conversations it serves memories and
                                        preferences only

Providers: ${PROVIDERS.join(", ")}. Kinds: ${KINDS.join(", ")}.
The store is $FOXCACHE_HOME/archive.json (default ~/.foxcache/archive.json).
`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env?: NodeJS.ProcessEnv;
}

class UsageError extends Error {}

/** Remove control characters but line breaks and tabs, so a title cannot rewrite the terminal (CL3). */
// oxlint-disable-next-line no-control-regex -- the control characters are what it removes
const printable = (text: string) => text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
const oneLine = (text: string) => printable(text).replace(/\s+/g, " ").trim();
/** JSON with DEL and C1 control characters escaped: JSON.stringify leaves them raw (CL3). */
// oxlint-disable-next-line no-control-regex -- the control characters are what it escapes
const json = (value: unknown) => JSON.stringify(value, null, 2).replace(/[\u007f-\u009f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

function line(kind: Kind, r: RecordOf[Kind]): string {
  const key = recordKey(kind, r);
  const what =
    kind === "conversations"
      ? `${(r as RecordOf["conversations"]).updatedAt.slice(0, 10)} ${(r as RecordOf["conversations"]).title}`
      : kind === "memories" || kind === "preferences"
        ? (r as RecordOf["memories"]).text
        : (r as RecordOf["projects"]).name;
  return `${kind.padEnd(14)} ${oneLine(key).padEnd(17)} ${oneLine(what).slice(0, 120)}\n`;
}

export async function runCli(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        provider: { type: "string" },
        kind: { type: "string" },
        limit: { type: "string" },
        json: { type: "boolean" },
        memories: { type: "boolean" },
        md: { type: "string" },
        allow: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    io.err(`foxcache: ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const [command, ...args] = parsed.positionals;
  const f = parsed.values;
  if (f.help || command === "help" || !command) {
    (command || f.help ? io.out : io.err)(USAGE);
    return command || f.help ? 0 : 2;
  }
  try {
    const provider = f.provider as ProviderId | undefined;
    const kind = f.kind as Kind | undefined;
    if (provider !== undefined && !PROVIDERS.includes(provider)) throw new UsageError(`--provider must be one of ${PROVIDERS.join(", ")}`);
    if (kind !== undefined && !KINDS.includes(kind)) throw new UsageError(`--kind must be one of ${KINDS.join(", ")}`);
    const need = (n: number) => {
      if (args.length !== n) throw new UsageError(`${command} takes ${n} argument${n === 1 ? "" : "s"}`);
    };
    switch (command) {
      case "import": {
        need(1);
        const path = resolve(args[0]!);
        // A2: refuse before reading.
        if ((await stat(path)).size > MAX_ARCHIVE_BYTES) throw new FoxcacheError("too-large", `${path} is larger than ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB.`);
        const text = await readFile(path, "utf8");
        const counts = await updateNodeStore((store) => importArchive(store, text), io.env);
        io.out(`Imported ${counts.added} new, ${counts.updated} updated, ${counts.same} unchanged records.\n`);
        return 0;
      }
      case "list": {
        need(0);
        const { store } = await openNodeStore(io.env);
        for (const k of kind ? [kind] : KINDS) for (const r of await store.all(k, { provider })) io.out(line(k, r));
        return 0;
      }
      case "search": {
        if (args.length === 0) throw new UsageError("search needs the text to find");
        const limit = f.limit === undefined ? undefined : Number(f.limit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new UsageError("--limit must be a whole number above 0");
        const { store } = await openNodeStore(io.env);
        for (const hit of await store.search(args.join(" "), { provider, kind, limit })) io.out(`${oneLine(hit.key)}  ${oneLine(hit.title)}\n    ${oneLine(hit.snippet)}\n`);
        return 0;
      }
      case "show": {
        need(1);
        const { store } = await openNodeStore(io.env);
        for (const k of KINDS) {
          const r = await store.get(k, args[0]!);
          if (!r) continue;
          io.out(k === "conversations" ? printable(toMarkdown(r as RecordOf["conversations"])) : `${json(r)}\n`);
          return 0;
        }
        throw new FoxcacheError("not-found", `No record has the id ${oneLine(args[0]!)}.`);
      }
      case "export": {
        need(0);
        if ([f.json, f.memories, f.md !== undefined].filter(Boolean).length !== 1) throw new UsageError("export takes exactly one of --json, --memories, --md <dir>");
        const archive = await toArchive((await openNodeStore(io.env)).store);
        if (f.json) io.out(`${json(archive)}\n`);
        else if (f.memories) io.out(printable(toMemoryList(archive)));
        else {
          const dir = resolve(f.md!);
          const there = await readdir(dir).catch((e: NodeJS.ErrnoException) => (e.code === "ENOENT" ? [] : Promise.reject(e)));
          if (there.length > 0) throw new FoxcacheError("not-empty", `${dir} has files. Pick an empty folder.`);
          const files = markdownFiles(archive);
          for (const file of files) {
            const path = join(dir, file.path);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, file.text, { flag: "wx" });
          }
          io.out(`Wrote ${files.length} Markdown files to ${dir}.\n`);
        }
        return 0;
      }
      case "mcp":
        need(0);
        if (f.allow !== undefined && f.allow !== "conversations") throw new UsageError("--allow takes only: conversations");
        await serveMcp({ env: io.env, allowConversations: f.allow === "conversations" });
        return 0;
      default:
        throw new UsageError(`unknown command ${command}`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`foxcache: ${error.message}\n\n${USAGE}`);
      return 2;
    }
    if (error instanceof FoxcacheError) {
      io.err(`foxcache: ${error.code}: ${oneLine(error.message)}\n`);
      return 1;
    }
    // Any file system error (ENOENT, EACCES, ENOTDIR, ENOSPC ...) is the user's to fix: one line, exit 1 (CL4).
    const e = error as NodeJS.ErrnoException;
    if (typeof e.code === "string" && typeof e.syscall === "string") {
      io.err(`foxcache: ${oneLine(e.message)}\n`);
      return 1;
    }
    throw error;
  }
}
