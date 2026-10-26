import { defineChain } from "viem";

/**
 * Mezo testnet ("matsnet"). Values verified against https://mezo.org/docs and a live RPC probe.
 * Native gas token is BTC (18 decimals).
 */
export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://rpc.test.mezo.org"],
      webSocket: ["wss://rpc-ws.test.mezo.org"],
    },
  },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org", apiUrl: "https://api.explorer.test.mezo.org/api" },
  },
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" },
  },
  testnet: true,
});

export const SUPPORTED_CHAIN = mezoTestnet;
export const SUPPORTED_CHAIN_ID = mezoTestnet.id;
export const EXPLORER_URL = mezoTestnet.blockExplorers.default.url;
export const FAUCET_URL = "https://faucet.test.mezo.org/";
export const MEZO_DOCS_URL = "https://mezo.org/docs/developers/getting-started/";
export const MEZO_TESTNET_APP_URL = "https://testnet.mezo.org";

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (address: string) => `${EXPLORER_URL}/address/${address}`;
export const explorerToken = (address: string) => `${EXPLORER_URL}/token/${address}`;
export const explorerBlock = (n: bigint | number) => `${EXPLORER_URL}/block/${n.toString()}`;

/** Parameters for wallet_addEthereumChain. */
export const addChainParams = {
  chainId: `0x${mezoTestnet.id.toString(16)}`,
  chainName: mezoTestnet.name,
  nativeCurrency: mezoTestnet.nativeCurrency,
  rpcUrls: [...mezoTestnet.rpcUrls.default.http],
  blockExplorerUrls: [EXPLORER_URL],
} as const;
