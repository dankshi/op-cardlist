import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "^nomimarket\\.com$" }],
        destination: "https://www.nomimarket.com/:path*",
        permanent: true,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "en.onepiece-cardgame.com",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "pub-7ca7df93bad849619d03ad7adf4515e8.r2.dev",
        pathname: "/cards/**",
      },
    ],
  },
  turbopack: {
    root: ".",
  },
};

export default nextConfig;
