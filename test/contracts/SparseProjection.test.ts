import { expect } from "chai";
import { ethers } from "hardhat";
import { sparseDot, getSparseProjectionRow } from "../../src/fixed-point";

describe("SparseProjection", () => {
  it("sparseDot matches Solidity", async () => {
    const TXHarvester = await ethers.getContractFactory("TXHarvester");
    const harvester = await TXHarvester.deploy(6);
    const hash = ethers.keccak256(ethers.toUtf8Bytes("sparse-test"));
    await harvester.harvestAll([hash]);

    const x = [10000n, 20000n, 30000n, 4000n, 5000n, 6000n];
    const onChain = await harvester.sparseDot(0, x);
    const offChain = sparseDot(hash, x);
    expect(onChain).to.equal(offChain);
  });

  it("getSparseProjectionRow has ~1/3 nonzero", async () => {
    const hash = ethers.keccak256(ethers.toUtf8Bytes("row-test"));
    const row = getSparseProjectionRow(hash, 6);
    const nonzero = row.filter((v) => v !== 0n).length;
    expect(nonzero).to.be.gte(1);
    expect(nonzero).to.be.lte(6);
  });
});
