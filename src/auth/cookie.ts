// The session cookies alone: the default. The browser adds them, so the
// kind adds nothing and foxcache never reads a cookie.
import type { Auth } from "./types.js";

export const cookie: Auth = { kind: "cookie", tokenPaths: [], renews: false, open: () => async () => ({}) };
