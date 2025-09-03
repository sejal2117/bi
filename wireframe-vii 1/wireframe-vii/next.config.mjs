// next.config.mjs

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep this file minimal for Turbopack.
  // No turbopack.resolveAlias and no webpack() override.
  // Rationale: Turbopack aliases are global (server+client) and can break Next's own imports.
  // Docs: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack
};

export default nextConfig;