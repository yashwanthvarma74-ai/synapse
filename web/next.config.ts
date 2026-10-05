import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second dev origin (127.0.0.1) work, so two different accounts can be
  // signed in at once during manual testing (each origin has its own localStorage).
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
