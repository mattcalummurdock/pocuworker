import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCpuFixture } from "./helpers";
import { compileMlpProgram } from "../../src/cpu/compiler";
import { DEFAULT_FRAUD_MLP } from "../../src/cpu/models/mlp-spec";
import { dispatchProgram, registerCpuJob } from "../../src/cpu/dispatcher";
import { groupInstructionBatches, resolveSamplesPerTx } from "../../src/cpu/batch";
import { SCALE } from "../../src/fixed-point";

describe("CPU e2e (local)", () => {
  it("compiles and dispatches a tiny MLP program", async function () {
    this.timeout(300_000);
    const fx = await deployCpuFixture();
    const [signer] = await ethers.getSigners();

    const samples = [
      {
        features: Array(6).fill(SCALE / 2n),
        labels: [0n],
      },
      {
        features: Array(6).fill(SCALE),
        labels: [SCALE],
      },
    ];

    const jobId = ethers.keccak256(ethers.toUtf8Bytes("e2e-cpu"));
    const dataHash = ethers.id("e2e-data").slice(2);
    const spec = {
      ...DEFAULT_FRAUD_MLP,
      layers: [
        { size: 4, activation: "relu" as const },
        { size: 2, activation: "relu" as const },
      ],
      epochs: 1,
      optimizer: "sgd" as const,
    };
    const program = compileMlpProgram(spec, samples, jobId, dataHash);

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

    const ctx = {
      deployment,
      signer,
      topicId: "0.0.99999",
    };

    await registerCpuJob(ctx, program);
    const result = await dispatchProgram(ctx, program);

    const batches = groupInstructionBatches(program.instructions, resolveSamplesPerTx());
    expect(result.txHashes.length).to.equal(batches.length);
    expect(result.txHashes.length).to.be.lt(program.instructions.length);
    expect(result.eventLogHash).to.match(/^0x/);
    expect(result.store.get(jobId, program.weightTensorIds[0])).to.not.be.undefined;
  });
});
