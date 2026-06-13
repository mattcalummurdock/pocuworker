import { expect } from "chai";
import { ethers } from "hardhat";

describe("TXHarvester", () => {
  it("derives deterministic projection rows from known hash", async () => {
    const TXHarvester = await ethers.getContractFactory("TXHarvester");
    const harvester = await TXHarvester.deploy(6);
    const hash = ethers.keccak256(ethers.toUtf8Bytes("test-tx-hash"));
    await harvester.harvestBatch([hash]);

    const row1 = await harvester.getProjectionRow(0, 6);
    const row2 = await harvester.getProjectionRow(0, 6);
    expect(row1).to.deep.equal(row2);
    expect(row1.length).to.equal(6);
  });
});
