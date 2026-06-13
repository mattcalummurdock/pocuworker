import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.HEX_ENCODED_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    testnet: {
      url: process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api",
      chainId: 296,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      gas: 15_000_000,
      gasPrice: 1_200_000_000_000,
      timeout: 300_000,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
