/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@resolution/ui", "@resolution/shared"],
  // Cloudflare Pages serves static/edge output — see docs/deployment.md. Client components
  // call apps/api directly via NEXT_PUBLIC_API_URL rather than Next.js server routes, so no
  // API routes need the Node runtime here.
};

module.exports = nextConfig;
