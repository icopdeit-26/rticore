/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Shared hosting exposes host CPUs but imposes a much smaller thread quota.
  experimental: {
    cpus: 1,
    workerThreads: false,
    staticGenerationMaxConcurrency: 1,
    webpackMemoryOptimizations: true,
  },
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
