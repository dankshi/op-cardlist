import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
