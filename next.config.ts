import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "opcardlist.com" }],
        destination: "https://www.opcardlist.com/:path*",
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
      // Add your R2 custom domain here after setting up backup
      // {
      //   protocol: "https",
      //   hostname: "images.yourdomain.com",
      //   pathname: "/cards/**",
      // },
    ],
  },
  turbopack: {
    root: ".",
  },
};

export default nextConfig;
