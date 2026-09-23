import type { NextConfig } from "next";
const nextConfig: NextConfig = { serverExternalPackages: ["pdf-parse", "mammoth", "xlsx"] };
export default nextConfig;
