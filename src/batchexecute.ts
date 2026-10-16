// Google batchexecute: the one POST endpoint behind Gemini and NotebookLM.
// Every call names an rpc id in f.req, and the rpc id alone decides whether
// it reads or writes, so each read lists one rpc id (H9). The answer is
// ")]}'" and then JSON frames, each after a line with its length; the frame
// ["wrb.fr", rpcid, "<inner JSON>", ...] holds the result, and a frame with
// no result may carry a google.rpc.Status at index 5 (H20). Sources:
// notebooklm-py decoder.py (framing, status) and encoder.py (f.req).
import { type ErrorCode, FoxcacheError } from "./errors.js";
import type { Http } from "./http.js";
import type { Read } from "./reads.js";

/** The query keys of a batchexecute read: the adapter's, and bl and f.sid that the page-token auth adds. */
const QUERY = ["rpcids", "source-path", "hl", "rt", "bl", "f.sid"];

/** A google.rpc.Status code that means something to a capture. Any other code is provider-error. */
const STATUS: Record<number, ErrorCode> = { 5: "not-found", 8: "rate-limited", 16: "logged-out" };
/** An "er" frame carries an HTTP-like code. */
const ER: Record<number, ErrorCode> = { 401: "logged-out", 403: "logged-out", 404: "not-found", 429: "rate-limited" };

/** The read of one rpc id on a batchexecute path, with the decoder of its answer. */
export function batchRead(o: { path: string; rpcid: string; source: string }): Read {
  return { method: "POST", path: o.path, query: QUERY, body: { type: "batchexecute", rpcids: [o.rpcid] }, decode: (text) => decodeBatch(text, o.rpcid), source: o.source };
}

/**
 * Call one rpc id and return its decoded result. f.req is the three-level
 * envelope [[[rpcid, args as JSON, null, "generic"]]], in compact JSON.
 */
export function callBatch(http: Http, path: string, rpcid: string, args: unknown, sourcePath: string): Promise<unknown> {
  const fReq = JSON.stringify([[[rpcid, JSON.stringify(args), null, "generic"]]]);
  return http.post(path, { "f.req": fReq }, { rpcids: rpcid, "source-path": sourcePath, hl: "en", rt: "c" });
}

/**
 * The result of rpcid in a batchexecute answer. The last frame with a result
 * wins, as a placeholder frame can come first. A frame with no result gives
 * null, or throws for its status. No message quotes the answer (H15).
 */
export function decodeBatch(text: string, rpcid: string): unknown {
  const fail = (why: string) => new FoxcacheError("provider-schema", `batchexecute ${rpcid}: ${why}. The site may have changed; foxcache needs an update.`);
  if (!/^\)\]\}'\r?\n/.test(text)) throw fail("the answer does not start with )]}'");
  let result: { value: unknown } | undefined;
  let empty = false;
  let error: FoxcacheError | undefined;
  for (const raw of text.slice(text.indexOf("\n") + 1).split("\n")) {
    const line = raw.trim();
    if (line === "" || /^\d+$/.test(line)) continue;
    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      throw fail("a frame is not JSON");
    }
    if (!Array.isArray(frame)) throw fail("a frame is not a list");
    for (const item of Array.isArray(frame[0]) ? frame : [frame]) {
      if (!Array.isArray(item) || item[1] !== rpcid) continue;
      if (item[0] === "er") throw new FoxcacheError(ER[item[2] as number] ?? "provider-error", `batchexecute ${rpcid} answered error ${typeof item[2] === "number" ? item[2] : "with no code"}.`);
      if (item[0] !== "wrb.fr") continue;
      if (typeof item[2] === "string") {
        try {
          result = { value: JSON.parse(item[2]) };
        } catch {
          throw fail("the result is not JSON");
        }
      } else if (item[2] === null || item[2] === undefined) {
        const status = item[5];
        if (status === null || status === undefined) empty = true;
        else if (JSON.stringify(status).includes("UserDisplayableError")) error = new FoxcacheError("rate-limited", `batchexecute ${rpcid}: Google refused for now (a usage limit).`);
        else {
          const code = Array.isArray(status) && typeof status[0] === "number" ? status[0] : undefined;
          error = new FoxcacheError((code !== undefined && STATUS[code]) || "provider-error", `batchexecute ${rpcid} answered status ${code ?? "with no code"}.`);
        }
      } else throw fail("the result is not text");
    }
  }
  if (result) return result.value;
  if (error) throw error;
  if (empty) return null;
  throw fail("no frame answers this rpc id; Google may have renamed it");
}
