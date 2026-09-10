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
