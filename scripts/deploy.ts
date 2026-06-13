import { ethers } from "hardhat";
import { writeFileSync, mkdirSync } from "fs";
import { DeploymentAddresses } from "../src/types";
import { resolveEngineParams, validateEngineParams, TRAINING_MODE } from "../src/config";
import { getOrCreateTopic } from "../src/hcs";

async function main() {
  const engine = resolveEngineParams();
  validateEngineParams(engine);

  const [deployer] = await ethers.getSigners();
  console.log("Deploying On-Chain CPU (cpuarc) with account:", deployer.address);
  console.log(`Envelope: input=${engine.inputDim} classes=${engine.numClasses} batch=${engine.batchSize}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "HBAR");

  const txOpts = { gasLimit: 15_000_000n };

  const TXHarvester = await ethers.getContractFactory("TXHarvester");
  const harvester = await TXHarvester.deploy(engine.inputDim, txOpts);
  await harvester.waitForDeployment();
  console.log("TXHarvester:", await harvester.getAddress());

  const CpuJobRegistry = await ethers.getContractFactory("CpuJobRegistry");
  const jobRegistry = await CpuJobRegistry.deploy(txOpts);
  await jobRegistry.waitForDeployment();
  await jobRegistry.setDispatcher(deployer.address);
  const jobRegistryAddr = await jobRegistry.getAddress();
  console.log("CpuJobRegistry:", jobRegistryAddr);

  const LinearAlgebraCore = await ethers.getContractFactory("LinearAlgebraCore");
  const linear = await LinearAlgebraCore.deploy(jobRegistryAddr, await harvester.getAddress(), txOpts);
  await linear.waitForDeployment();

  const ActivationCore = await ethers.getContractFactory("ActivationCore");
  const activation = await ActivationCore.deploy(jobRegistryAddr, txOpts);
  await activation.waitForDeployment();

  const GradientCore = await ethers.getContractFactory("GradientCore");
  const gradient = await GradientCore.deploy(jobRegistryAddr, txOpts);
  await gradient.waitForDeployment();

  const OptimizerCore = await ethers.getContractFactory("OptimizerCore");
  const optimizer = await OptimizerCore.deploy(jobRegistryAddr, txOpts);
  await optimizer.waitForDeployment();

  const AggregationCore = await ethers.getContractFactory("AggregationCore");
  const aggregation = await AggregationCore.deploy(jobRegistryAddr, txOpts);
  await aggregation.waitForDeployment();

  const CpuBatchExecutor = await ethers.getContractFactory("CpuBatchExecutor");
  const batchExecutor = await CpuBatchExecutor.deploy(jobRegistryAddr, txOpts);
  await batchExecutor.waitForDeployment();
  console.log("CpuBatchExecutor:", await batchExecutor.getAddress());

  const ModelRegistry = await ethers.getContractFactory("ModelRegistry");
  const registry = await ModelRegistry.deploy(txOpts);
  await registry.waitForDeployment();
  console.log("ModelRegistry:", await registry.getAddress());

  console.log("LinearAlgebraCore:", await linear.getAddress());
  console.log("ActivationCore:", await activation.getAddress());
  console.log("GradientCore:", await gradient.getAddress());
  console.log("OptimizerCore:", await optimizer.getAddress());
  console.log("AggregationCore:", await aggregation.getAddress());

  let hcsTopicId = process.env.HCS_TOPIC_ID ?? "";
  try {
    hcsTopicId = await getOrCreateTopic();
    console.log("HCS Topic:", hcsTopicId);
  } catch (e) {
    console.warn("HCS topic not created (set ACCOUNT_ID + key):", e);
  }

  const deployment: DeploymentAddresses = {
    network: "testnet",
    txHarvester: await harvester.getAddress(),
    cpuJobRegistry: jobRegistryAddr,
    cpuBatchExecutor: await batchExecutor.getAddress(),
    modelRegistry: await registry.getAddress(),
    cores: {
      linear: await linear.getAddress(),
      activation: await activation.getAddress(),
      gradient: await gradient.getAddress(),
      optimizer: await optimizer.getAddress(),
      aggregation: await aggregation.getAddress(),
    },
    inputDim: engine.inputDim,
    hcsTopicId,
    deployedAt: new Date().toISOString(),
    trainingMode: TRAINING_MODE,
  };

  mkdirSync("deployments", { recursive: true });
  writeFileSync("deployments/testnet.json", JSON.stringify(deployment, null, 2));
  console.log("\nDeployment saved to deployments/testnet.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
