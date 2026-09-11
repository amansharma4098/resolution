/**
 * A Cloudflare Pages Function — proxies every /api/* request from resolution-a7j.pages.dev
 * to the real apps/api Worker, server-side. Lives at the repo root (not apps/web/functions)
 * because this Pages project's "root directory" build setting is the repo root (confirmed
 * via the Pages API: build_config.root_dir === ""), and Pages Functions are discovered
 * relative to that setting, not the build output directory (apps/web/out).
 *
 * Why this exists at all: apps/web and apps/api are two different origins
 * (resolution-a7j.pages.dev vs resolution-api.*.workers.dev), which forces the session
 * cookie to be SameSite=None — exactly the kind of cross-site cookie Safari's cross-site
 * tracking prevention blocks or strips (most aggressively in Private Browsing), causing
 * login/signup to appear to succeed but the browser to silently drop the session. Cloudflare
 * Pages' own _redirects file can rewrite paths, but per Cloudflare's docs it can only proxy
 * to *relative* (same-project) destinations — it explicitly cannot proxy an external domain
 * — so a real Function (which can `fetch()` anywhere) is what this needs. With this in
 * place, the browser only ever talks to its own origin; this function forwards the request
 * to the Worker and returns its response — including Set-Cookie — completely transparently,
 * so the browser treats the session cookie as first-party and Safari never touches it. See
 * docs/deployment.md and ARCHITECTURE.md §2/§11 for the fuller writeup.
 */
// Typed structurally (not via the ambient `PagesFunction` global from
// @cloudflare/workers-types) — this file lives outside every workspace package's own
// tsconfig/node_modules, and Cloudflare's Pages Functions build pipeline bundles /functions
// independently (esbuild-based, stripping types rather than type-checking them), so it
// doesn't need or use this repo's own TypeScript project setup either way.
export const onRequest = async (context: { request: Request }): Promise<Response> => {
  const url = new URL(context.request.url);
  const target = new URL(url.pathname + url.search, "https://resolution-api.amansharma4098.workers.dev");
  const proxiedRequest = new Request(target.toString(), context.request);
  return fetch(proxiedRequest);
};
