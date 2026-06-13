import { expect } from "chai";
import { ethers } from "hardhat";
import { hashTensorData } from "../../src/cpu/tensor-hash";

describe("tensor hash (Phase B)", () => {
  it("matches Solidity TensorEvents.tensorDataHash", async () => {
    const HashProbe = await ethers.getContractFactory("HashProbe");
    const probe = await HashProbe.deploy();
    await probe.waitForDeployment();
    const samples = [
      [1n, 2n, 3n],
      Array.from({ length: 64 }, (_, i) => BigInt(i - 32)),
      [65536n, -32768n, 0n],
    ];
    for (const data of samples) {
      const ts = hashTensorData(data);
      const sol = await probe.hashPacked.staticCall(data);
      expect(ts).to.equal(sol);
    }
  });
});
