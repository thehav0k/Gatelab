import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `/diagrams` was the worked-solutions catalogue before the builder took the
   * `/diagram` name. The old URL is already deployed and linked, so it forwards
   * rather than 404s — permanently, because the move is not going to be undone.
   */
  async redirects() {
    return [{ source: "/diagrams", destination: "/solutions", permanent: true }];
  },
};

export default nextConfig;
