import { expect } from "chai";
import { ethers } from "hardhat";
import {
  HEDERA_CALLDATA_LIMIT,
  encodeExecuteCalldataBytes,
  instructionFitsCalldataLimit,
  maxAdamShardElements,
  maxSgdShardElements,
} from "../../src/cpu/calldata";
import { Op } from "../../src/cpu/isa";
import { compileMlpProgram } from "../../src/cpu/compiler";
import { DEFAULT_FRAUD_MLP } from "../../src/cpu/models/mlp-spec";
import { SCALE } from "../../src/fixed-point";
import { packInstructionCalldata } from "../../src/cpu/postman";
import { TensorStore } from "../../src/cpu/tensor-store";
import { needsShardedAdam } from "../../src/cpu/shard-dispatch";

describe("CPU calldata limits", () => {
  const jobId = ethers.keccak256(ethers.toUtf8Bytes("calldata-test"));

  it("detects ADAM_W2 exceeds Hedera limit", () => {
    const samples = [{ features: Array(6).fill(SCALE), labels: [0n] }];
    const program = compileMlpProgram(
      { ...DEFAULT_FRAUD_MLP, epochs: 1 },
      samples,
      jobId,
      "hash"
    );
    const adam = program.instructions.find((i) => i.op === "ADAM_W2")!;
    const n = adam.inShape[0];
    const store = new TensorStore();
    for (const k of Object.keys(adam.inputs)) {
      store.put({
        jobId,
        tensorId: adam.inputs[k],
        shape: [n],
        data: Array(n).fill(1n),
        hcsSeq: 0,
        messageHash: "0x",
      });
    }
    expect(needsShardedAdam(jobId, adam, store)).to.equal(true);
    const packed = packInstructionCalldata(jobId, adam, store);
    const bytes = encodeExecuteCalldataBytes(
      jobId,
      adam.opcode,
      packed.inShape,
      packed.inData,
      packed.outShape,
      packed.params
    );
    expect(bytes).to.be.gt(HEDERA_CALLDATA_LIMIT);
  });

  it("computes shard sizes under safe limit", () => {
    const adamShard = maxAdamShardElements(jobId);
    const sgdShard = maxSgdShardElements(jobId);
    expect(adamShard).to.be.gt(0);
    expect(sgdShard).to.be.gt(0);

    const adamBytes = encodeExecuteCalldataBytes(
      jobId,
      Op.ADAM,
      [adamShard],
      Array(adamShard * 4).fill(1n),
      [adamShard * 4],
      [1n, 1n, 1n, 1n]
    );
    expect(adamBytes).to.be.lte(HEDERA_CALLDATA_LIMIT);
    expect(
      instructionFitsCalldataLimit(
        jobId,
        Op.SGD,
        [sgdShard],
        Array(sgdShard * 2).fill(1n),
        [sgdShard],
        [1n]
      )
    ).to.equal(true);
  });
});
