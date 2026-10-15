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
  | "usage";

export class FoxcacheError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "FoxcacheError";
    this.code = code;
  }
}
