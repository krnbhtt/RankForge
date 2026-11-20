/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@rankforge/schema',
    '@rankforge/scoring',
    '@rankforge/config',
  ],
  output: 'standalone',
};

export default nextConfig;
