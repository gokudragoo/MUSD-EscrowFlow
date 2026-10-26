import { createConfig, http, injected, cookieStorage, createStorage } from "wagmi";
import { mezoTestnet } from "./chains";

/**
 * Injected wallets only (MetaMask, Rabby, OKX, …) discovered via EIP-6963 — no WalletConnect
 * project id required. Non-custodial: the app never sees keys and never signs on a user's behalf.
 */
export const wagmiConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected({ shimDisconnect: true })],
  multiInjectedProviderDiscovery: true,
  transports: { [mezoTestnet.id]: http(mezoTestnet.rpcUrls.default.http[0], { retryCount: 2 }) },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
