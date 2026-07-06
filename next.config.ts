import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  env: {
    // shown as a small badge in the UI so it's obvious which build is live
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    // Vercel sets this automatically at build time; "dev" locally
    NEXT_PUBLIC_COMMIT_SHA: (process.env.VERCEL_GIT_COMMIT_SHA ?? "dev").slice(0, 7),
  },
};

export default nextConfig;
