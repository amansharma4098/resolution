// A local URL in an exported production bundle sends customer requests to their own
// computers. Reject that build instead of publishing a broken authentication flow.
const configuredApi = process.env.NEXT_PUBLIC_API_URL;
if (process.env.NODE_ENV === "production" && configuredApi) {
  const endpoint = new URL(configuredApi);
  if (endpoint.protocol !== "https:" || /^(localhost|127\.|0\.|\[::1\])/.test(endpoint.hostname)) {
    throw new Error(
      "Production NEXT_PUBLIC_API_URL must be empty (same-origin proxy) or a public HTTPS URL",
    );
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@resolution/ui", "@resolution/shared"],
  // Static export — deployed as-is to Cloudflare Pages (see docs/deployment.md). Every
  // page here is a client component with no server-side data fetching, no middleware, and
  // no dynamic route segments, so this has no effect on behavior; it just changes `next
  // build`'s output to plain static files. Client components call apps/api directly via
  // NEXT_PUBLIC_API_URL rather than Next.js server routes, so no Node runtime is needed to
  // serve this app. Revisit if a future page needs real SSR.
  output: "export",
  images: { unoptimized: true },
};

module.exports = nextConfig;
