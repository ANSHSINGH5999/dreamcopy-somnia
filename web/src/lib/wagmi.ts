import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { somniaTestnet } from "./chain";

// A WalletConnect Cloud (reown.com) project id is required for the
// WalletConnect connector/relay client. Without a REAL one, RainbowKit's
// default config eagerly opens a relay websocket at page load using a fake
// id and throws an unhandled "Connection interrupted while trying to
// subscribe" rejection — a real bug, not cosmetic. Fix: only wire up
// WalletConnect-backed wallets when a real project id is actually
// configured; otherwise fall back to the injected-provider-only wallet
// (MetaMask/any browser extension), which needs no relay client at all.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";
const hasWalletConnect = projectId.length > 0;

const wallets = hasWalletConnect
  ? [
      {
        groupName: "Recommended",
        wallets: [injectedWallet, metaMaskWallet, rainbowWallet, coinbaseWallet, walletConnectWallet],
      },
    ]
  : [
      {
        groupName: "Browser wallet",
        wallets: [injectedWallet],
      },
    ];

const connectors = connectorsForWallets(wallets, {
  appName: "DreamCopy",
  projectId: hasWalletConnect ? projectId : "no-walletconnect-project-id-configured",
});

export const wagmiConfig = createConfig({
  connectors,
  chains: [somniaTestnet],
  transports: {
    [somniaTestnet.id]: http(),
  },
  ssr: true,
});
