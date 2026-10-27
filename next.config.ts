import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: true },
  // Dev only: let phones load the dev server through an ngrok tunnel (`npm run dev` starts one).
  // Without this, Next blocks its dev scripts on the tunnel host and pages never become interactive.
  allowedDevOrigins: ['*.ngrok-free.dev', '*.ngrok-free.app', '*.ngrok.app', '*.ngrok.io'],
  experimental: {
    serverActions: { bodySizeLimit: '8mb' },
  },
};

export default nextConfig;
