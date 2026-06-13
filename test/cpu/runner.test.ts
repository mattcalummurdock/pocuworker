import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCpuFixture } from "./helpers";
import { runCpuTraining } from "../../src/cpu/runner";
import { DEFAULT_FRAUD_MLP } from "../../src/cpu/models/mlp-spec";
import { SCALE } from "../../src/fixed-point";
import { existsSync, readFileSync, unlinkSync } from "fs";

describe("CPU runner (local)", () => {
  it("trains, commits weights, writes manifest", async function () {
    this.timeout(300_000);
    const fx = await deployCpuFixture();
    const [signer] = await ethers.getSigners();

    const ModelRegistry = await ethers.getContractFactory("ModelRegistry");
    const registry = await ModelRegistry.deploy();
    await registry.waitForDeployment();

    const samples = [
      { features: Array(6).fill(SCALE / 2n), labels: [0n] },
      { features: Array(6).fill(SCALE), labels: [SCALE] },
    ];

    const spec = {
      ...DEFAULT_FRAUD_MLP,
      layers: [
        { size: 4, activation: "relu" as const },
        { size: 2, activation: "relu" as const },
      ],
      epochs: 1,
      optimizer: "sgd" as const,
    };

    const dataHash = ethers.id("runner-data").slice(2);
    const deployment = {
      network: "hardhat",
      txHarvester: await fx.harvester.getAddress(),
      cpuJobRegistry: await fx.jobRegistry.getAddress(),
      cpuBatchExecutor: fx.cpuBatchExecutor,
      modelRegistry: await registry.getAddress(),
      cores: fx.cores,
      inputDim: 6,
      deployedAt: new Date().toISOString(),
      trainingMode: "onchain-cpu" as const,
    };

    const manifestPath = "output/cpu_model_manifest.json";
    if (existsSync(manifestPath)) unlinkSync(manifestPath);

    const result = await runCpuTraining({
      deployment,
      signer,
      topicId: "0.0.99999",
      samples,
      dataHash,
      spec,
    });

    expect(result.txHashes.length).to.be.gt(0);
    expect(existsSync(manifestPath)).to.equal(true);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    expect(manifest.architecture).to.equal("mlp-4-2-1");

    const onChainHash = await registry.weightsHashOf(result.jobId);
    expect(onChainHash).to.equal(manifest.weightsHash);
    expect(onChainHash).to.not.equal(ethers.ZeroHash);
  });
});
