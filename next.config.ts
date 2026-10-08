import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["postgres"],
  async redirects() {
    return [{ source: "/waitlist", destination: "/admin/waitlist", permanent: false }];
  },
};

export default nextConfig;
