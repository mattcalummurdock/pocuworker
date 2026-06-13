import { expect } from "chai";
import { ethers } from "hardhat";
import { Op } from "../../src/cpu/isa";
import { deployCpuFixture, executeOp, SCALE, tensorId } from "./helpers";

describe("On-Chain CPU cores", () => {
  const jobId = ethers.keccak256(ethers.toUtf8Bytes("cpu-test-job"));

  it("LinearAlgebra: MATMUL 2x2", async () => {
    const { linear } = await deployCpuFixture();
    // A = [[1,0],[0,1]] B = [[2,0],[0,2]] in Q16.16
    const one = SCALE;
    const two = SCALE * 2n;
    const inData = [one, 0n, 0n, one, two, 0n, 0n, two];
    const tensors = await executeOp(linear, {
      jobId,
      opcode: Op.MATMUL,
      inShape: [2, 2],
      inData,
      outShape: [2, 2],
      outTensorId: tensorId("matmul_out"),
    });
    expect(tensors[0].data[0]).to.equal(two);
    expect(tensors[0].data[3]).to.equal(two);
  });

  it("LinearAlgebra: ADD vectors", async () => {
    const { linear } = await deployCpuFixture();
    const tensors = await executeOp(linear, {
      jobId,
      opcode: Op.ADD,
      inShape: [2],
      inData: [SCALE, SCALE, SCALE, SCALE],
      outShape: [2],
      outTensorId: tensorId("add_out"),
    });
    expect(tensors[0].data[0]).to.equal(SCALE * 2n);
  });

  it("Activation: RELU zeroes negative", async () => {
    const { activation } = await deployCpuFixture();
    const tensors = await executeOp(activation, {
      jobId,
      opcode: Op.RELU,
      inShape: [2],
      inData: [-SCALE, SCALE],
      outShape: [2],
      outTensorId: tensorId("relu_out"),
    });
    expect(tensors[0].data[0]).to.equal(0n);
    expect(tensors[0].data[1]).to.equal(SCALE);
  });

  it("Activation: SIGMOID at 0 ~ 0.5", async () => {
    const { activation } = await deployCpuFixture();
    const tensors = await executeOp(activation, {
      jobId,
      opcode: Op.SIGMOID,
      inShape: [1],
      inData: [0n],
      outShape: [1],
      outTensorId: tensorId("sig_out"),
    });
    expect(Number(tensors[0].data[0])).to.be.closeTo(Number(SCALE / 2n), 3000);
  });

  it("Gradient: MSE loss", async () => {
    const { gradient } = await deployCpuFixture();
    const half = SCALE / 2n;
    const tensors = await executeOp(gradient, {
      jobId,
      opcode: Op.MSE,
      inShape: [1],
      inData: [half, 0n],
      outShape: [1],
      outTensorId: tensorId("mse_out"),
    });
    expect(tensors[0].data[0]).to.be.gt(0n);
  });

  it("Optimizer: SGD step", async () => {
    const { optimizer } = await deployCpuFixture();
    const grad = SCALE / 10n;
    const weight = SCALE;
    const lr = SCALE / 10n;
    const tensors = await executeOp(optimizer, {
      jobId,
      opcode: Op.SGD,
      inShape: [1],
      inData: [grad, weight],
      outShape: [1],
      outTensorId: tensorId("sgd_out"),
      opParams: [lr],
    });
    expect(tensors[0].data[0]).to.be.lt(weight);
  });

  it("Aggregation: REDUCE_SUM", async () => {
    const { aggregation } = await deployCpuFixture();
    const tensors = await executeOp(aggregation, {
      jobId,
      opcode: Op.REDUCE_SUM,
      inShape: [3],
      inData: [SCALE, SCALE, SCALE],
      outShape: [1],
      outTensorId: tensorId("sum_out"),
    });
    expect(tensors[0].data[0]).to.equal(SCALE * 3n);
  });

  it("LinearAlgebra: OUTER", async () => {
    const { linear } = await deployCpuFixture();
    const tensors = await executeOp(linear, {
      jobId,
      opcode: Op.OUTER,
      inShape: [2, 2],
      inData: [SCALE, SCALE * 2n, SCALE, SCALE * 3n],
      outShape: [2, 2],
      outTensorId: tensorId("outer_out"),
    });
    expect(tensors[0].data.length).to.equal(4);
    expect(tensors[0].data[0]).to.equal(SCALE);
    expect(tensors[0].data[3]).to.equal(SCALE * 6n);
  });

  it("LinearAlgebra: TRANSPOSE", async () => {
    const { linear } = await deployCpuFixture();
    const tensors = await executeOp(linear, {
      jobId,
      opcode: Op.TRANSPOSE,
      inShape: [2, 2],
      inData: [SCALE, 0n, SCALE * 2n, SCALE * 3n],
      outShape: [2, 2],
      outTensorId: tensorId("transpose_out"),
    });
    expect(tensors[0].data[0]).to.equal(SCALE);
    expect(tensors[0].data[1]).to.equal(SCALE * 2n);
    expect(tensors[0].data[2]).to.equal(0n);
  });

  it("Aggregation: LAYERNORM", async () => {
    const { aggregation } = await deployCpuFixture();
    const tensors = await executeOp(aggregation, {
      jobId,
      opcode: Op.LAYERNORM,
      inShape: [4],
      inData: [SCALE, SCALE * 2n, SCALE * 3n, SCALE * 4n],
      outShape: [4],
      outTensorId: tensorId("ln_out"),
      opParams: [655n],
    });
    expect(tensors[0].data.length).to.equal(4);
  });
});
