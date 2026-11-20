/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@rankforge/schema',
    '@rankforge/scoring',
    '@rankforge/config',
    '@rankforge/ssrf',
    '@rankforge/audit-store',
    '@rankforge/storage',
  ],
  output: 'standalone',
  webpack: (config) => {
    // Workspace packages use NodeNext-style `./file.js` imports that point at `.ts` sources.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
