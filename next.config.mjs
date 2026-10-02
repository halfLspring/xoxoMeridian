/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  // Next 已加载 .env*；即使未配置主题，也显式内联缺省值，冻结构建结果。
  env: {
    NEXT_PUBLIC_AGENT_ENTRY_THEME: process.env.NEXT_PUBLIC_AGENT_ENTRY_THEME ?? "default",
  },
  serverExternalPackages: ["@prisma/client", "ali-oss", "prisma"],
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 300,
    },
  }
};

export default nextConfig;
