import { expect } from "chai";
import { ethers } from "hardhat";

describe("FixedPointMath", () => {
  it("sigmoid at 0 is approximately 0.5", async () => {
    const Wrapper = await ethers.getContractFactory("FixedPointMathTester");
    const wrapper = await Wrapper.deploy();
    const result = await wrapper.testSigmoid(0);
    const scale = 65536n;
    expect(result).to.be.closeTo(Number(scale / 2n), 2000);
  });

  it("mul and div round-trip", async () => {
    const Wrapper = await ethers.getContractFactory("FixedPointMathTester");
    const wrapper = await Wrapper.deploy();
    const a = 32768n;
    const b = 65536n;
    const product = await wrapper.testMul(a, b);
    const back = await wrapper.testDiv(product, b);
    expect(back).to.equal(a);
  });
});
