// Fixed headers that a site's own script adds to every API call, such as
// Qwen Chat's "source: web", on top of another kind that carries the
// token. It may not name a header that http or the token kind sets, so it
// can never replace the bearer or send a cookie (H19).
import type { Auth } from "./types.js";

const OWN = /^(accept|authorization|content-type|cookie)$/i;

export function withHeaders(inner: Auth, headers: Readonly<Record<string, string>>): Auth {
  for (const name of Object.keys(headers)) if (OWN.test(name)) throw new Error(`with-headers may not set ${name}: http or the ${inner.kind} kind sets it.`);
  const fixed = { ...headers };
  return {
    kind: "with-headers",
    tokenPaths: inner.tokenPaths,
    renews: inner.renews,
    open: (page) => {
      const sign = inner.open(page);
      return async (request, fresh) => {
        const parts = await sign(request, fresh);
        return { ...parts, headers: { ...fixed, ...parts.headers } };
      };
    },
  };
}
