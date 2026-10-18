import type { NextConfig } from "next";

/**
 * Security headers (M7-2). The Content-Security-Policy itself is set per
 * request in src/proxy.ts (M7-26: script nonce, see src/lib/csp.ts). Here:
 * the static headers, plus X-Frame-Options (clickjacking) on every page
 * except the fallback widget page.
 */
const commonHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      // Everything except the fallback widget page (/w/*), which companies
      // frame on their own sites.
      {
        source: "/((?!w/).*)",
        headers: [
          ...commonHeaders,
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/w/:path*", headers: commonHeaders },
    ];
  },
};

export default nextConfig;
