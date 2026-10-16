/** Every error foxcache throws on purpose. The codes are in docs/failure-modes.md. */
export type ErrorCode =
  | "invalid-record"
  | "too-large"
  | "bad-archive"
  | "bad-query"
  | "bad-request"
  | "not-allowed"
  | "logged-out"
  | "rate-limited"
  | "provider-schema"
  | "provider-error"
  | "pagination-loop"
  | "corrupt-store"
  | "not-found"
  | "not-empty"
  | "locked"
  | "usage";

export class FoxcacheError extends Error {
  readonly code: ErrorCode;
  /** The HTTP status, for an error from a provider request. */
  readonly status?: number;
  /** Seconds to wait, from a 429's Retry-After header. */
  readonly retryAfter?: number;
  constructor(code: ErrorCode, message: string, extra: { status?: number; retryAfter?: number } = {}) {
    super(message);
    this.name = "FoxcacheError";
    this.code = code;
    if (extra.status !== undefined) this.status = extra.status;
    if (extra.retryAfter !== undefined) this.retryAfter = extra.retryAfter;
  }
}
