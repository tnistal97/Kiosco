// next.config.ts
import type { NextConfig } from 'next';

// Import next-pwa. Since it's a CommonJS module, we'll use require.
// Make sure 'next-pwa' is in your dependencies.
import createPwaPlugin from 'next-pwa';

const withPWA = createPwaPlugin({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  // register: true, // Recommended: Set to true to register the service worker
  // skipWaiting: true, // Recommended: Set to true to make the new service worker activate immediately
});

const nextConfig: NextConfig = {
  experimental: {},
  reactStrictMode: true, // Good practice to have this explicitly
  // Add other Next.js options here as needed
};

export default (withPWA as any)(nextConfig);