import { ethers } from "hardhat";
import { readFileSync, writeFileSync } from "fs";

async function main() {
  const path = "deployments/testnet.json";
  const deployment = JSON.parse(readFileSync(path, "utf-8"));
  const txOpts = { gasLimit: 15_000_000n };

  const ModelRegistry = await ethers.getContractFactory("ModelRegistry");
  const registry = await ModelRegistry.deploy(txOpts);
  await registry.waitForDeployment();
  const addr = await registry.getAddress();
  console.log("ModelRegistry:", addr);

  deployment.modelRegistry = addr;
  deployment.deployedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(deployment, null, 2));
  console.log("Updated", path);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
