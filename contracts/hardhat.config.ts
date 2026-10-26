import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// Deployment to Mezo testnet is done by ../scripts/deploy-escrow.ts (viem, explicit gas,
// key read at runtime from outside the repo). This config only compiles/tests/verifies.
const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "london",
    },
  },
  networks: {
    mezotestnet: { url: "https://rpc.test.mezo.org", chainId: 31611 },
  },
  etherscan: {
    apiKey: { mezotestnet: "blockscout" },
    customChains: [
      {
        network: "mezotestnet",
        chainId: 31611,
        urls: {
          apiURL: "https://api.explorer.test.mezo.org/api",
          browserURL: "https://explorer.test.mezo.org",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  gasReporter: { enabled: process.env.REPORT_GAS === "1", currency: "USD" },
  mocha: { timeout: 120000 },
};

export default config;
