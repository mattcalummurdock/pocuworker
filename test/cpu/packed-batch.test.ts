import { expect } from "chai";
import { ethers } from "hardhat";
import { deployCpuFixture } from "./helpers";
import { Op } from "../../src/cpu/isa";
import { packBatchSteps, hashPackedPayload } from "../../src/cpu/packed-batch";
import { batchStepsToAbi } from "../../src/cpu/postman";
import { encodeBatchCalldataBytes } from "../../src/cpu/calldata";
import { hydrateBatchReceipt } from "../../src/cpu/hydrate";
import { TensorStore } from "../../src/cpu/tensor-store";
import { TX_GAS_LIMIT } from "../../src/config";
import { sendAndWaitContract } from "../../src/tx-utils";

describe("Phase C packed batch", () => {
  it("executeBatchPacked matches ABI batch gas profile and hydrates", async () => {
    const fx = await deployCpuFixture();
    const [signer] = await ethers.getSigners();
    const jobId = ethers.id("packed-job");
    await fx.jobRegistry.registerJob(
      jobId,
      ethers.id("data"),
      "0.0.1",
      [
        await fx.linear.getAddress(),
        await fx.activation.getAddress(),
        await fx.gradient.getAddress(),
        await fx.optimizer.getAddress(),
        await fx.aggregation.getAddress(),
      ]
    );

    const steps = [
      {
        outTensorId: ethers.id("out"),
        opcode: Op.ADD,
        inputTensorIds: [] as string[],
        inShape: [2],
        literalData: [100n, 200n, 50n, 80n],
        outShape: [2],
        params: [] as bigint[],
      },
    ];

    const packed = packBatchSteps(steps);
    const payloadHash = hashPackedPayload(packed);
    const abiBytes = encodeBatchCalldataBytes(jobId, steps);
    const executor = await ethers.getContractAt(
      "CpuBatchExecutor",
      fx.cpuBatchExecutor,
      signer
    );
    const packedTx = await sendAndWaitContract(
      executor,
      "executeBatchPacked",
      [jobId, 0, ethers.ZeroHash, payloadHash, packed],
      { gasLimit: TX_GAS_LIMIT }
    );

    expect(packed.length).to.be.lt(abiBytes);

    const store = new TensorStore();
    await hydrateBatchReceipt(
      store,
      packedTx,
      fx.cpuBatchExecutor,
      steps,
      { network: "hardhat", txHarvester: "", cpuJobRegistry: "", cpuBatchExecutor: "", modelRegistry: "", cores: fx.cores, inputDim: 6, deployedAt: "", trainingMode: "onchain-cpu" },
      signer,
      { pinIpfs: false }
    );
    const t = store.get(jobId, steps[0].outTensorId);
    expect(t?.data).to.deep.equal([150n, 280n]);
  });
});
