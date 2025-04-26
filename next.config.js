/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow the app to use our Node.js implementations
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
  // Specify that API routes should use the Node.js runtime
  experimental: {
    allowMiddlewareResponseBody: true,
    serverComponentsExternalPackages: ["fs", "path"],
    runtime: 'nodejs',
  },
};

module.exports = nextConfig; 