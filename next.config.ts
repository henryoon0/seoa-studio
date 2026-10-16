import type { NextConfig } from "next";
import { MAX_UPLOAD_BYTES } from "./src/lib/meetings/upload-limit";

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    // proxy 가 본문을 복제할 때 기본 10MB 에서 잘라 녹음 업로드가 깨진다.
    proxyClientMaxBodySize: MAX_UPLOAD_BYTES,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
