import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCpuFixture } from "./helpers";
import { compileMlpProgram } from "../../src/cpu/compiler";
import { DEFAULT_FRAUD_MLP } from "../../src/cpu/models/mlp-spec";
import { dispatchProgram, registerCpuJob } from "../../src/cpu/dispatcher";
import { SCALE } from "../../src/fixed-point";

describe("CPU sharded dispatch (local)", () => {
  it("trains default MLP (64-32) via calldata-split + sharding", async function () {
    this.timeout(600_000);
    const fx = await deployCpuFixture();
    const [signer] = await ethers.getSigners();

    const samples = [
      { features: Array(6).fill(SCALE / 2n), labels: [0n] },
      { features: Array(6).fill(SCALE), labels: [SCALE] },
    ];

    const jobId = ethers.keccak256(ethers.toUtf8Bytes("shard-cpu"));
    const dataHash = ethers.id("shard-data").slice(2);
    const program = compileMlpProgram(
      { ...DEFAULT_FRAUD_MLP, epochs: 1 },
      samples,
      jobId,
      dataHash
    );

    const deployment = {
      network: "hardhat",
      txHarvester: await fx.harvester.getAddress(),
      cpuJobRegistry: await fx.jobRegistry.getAddress(),
      cpuBatchExecutor: fx.cpuBatchExecutor,
      modelRegistry: ethers.ZeroAddress,
      cores: fx.cores,
      inputDim: 6,
      deployedAt: new Date().toISOString(),
      trainingMode: "onchain-cpu" as const,
    };

    const prev = process.env.CPU_DISPATCH_MODE;
    const prevSamples = process.env.SAMPLES_PER_TX;
    process.env.CPU_DISPATCH_MODE = "batch";
    process.env.SAMPLES_PER_TX = "10";

    try {
      const ctx = { deployment, signer, topicId: "0.0.99999" };
      await registerCpuJob(ctx, program);
      const result = await dispatchProgram(ctx, program);
      expect(result.txHashes.length).to.be.gt(0);
      expect(result.store.get(jobId, program.weightTensorIds[0])).to.not.be.undefined;
    } finally {
      if (prev === undefined) delete process.env.CPU_DISPATCH_MODE;
      else process.env.CPU_DISPATCH_MODE = prev;
      if (prevSamples === undefined) delete process.env.SAMPLES_PER_TX;
      else process.env.SAMPLES_PER_TX = prevSamples;
    }
  });
});
