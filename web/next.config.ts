import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // RainbowKit's Coinbase Wallet connector pulls in @coinbase/cdp-sdk, which
  // has optional dynamic imports of @x402/* packages (payment-protocol
  // support) we don't use and haven't installed. Marking these external
  // keeps Turbopack from trying to statically resolve those dynamic imports
  // at build time; the wallet connector itself works fine without them.
  serverExternalPackages: ["@coinbase/cdp-sdk", "@base-org/account"],
};

export default nextConfig;
