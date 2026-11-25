/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(process.env.RTICORE_BUILD_CPUS === '1' ? { experimental: { cpus: 1, webpackMemoryOptimizations: true } } : {}),
  serverExternalPackages: ['unpdf'],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
      };
    }
    return config;
  },
};

export default nextConfig;
