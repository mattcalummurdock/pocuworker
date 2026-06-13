import { expect } from "chai";
import { ethers } from "ethers";
import {
  gasCostFromReceipt,
  gasCostHbarFromWei,
  getMppCumulativeSpentHbar,
  resetMppSpendTracker,
  wouldExceedMppCap,
} from "../../src/protocols/mpp";
import { ALLOWANCE_CAP_HBAR, estimateJobCostHbar } from "../../src/protocols/cost-estimate";

describe("MPP helpers", () => {
  it("computes gas from receipt", () => {
    const wei = gasCostFromReceipt({ gasUsed: 1_000_000n, gasPrice: 1_000_000_000n });
    expect(wei).to.equal(1_000_000_000_000_000n);
    expect(ethers.formatEther(wei)).to.equal("0.001");
  });

  it("tracks cumulative spend reset", () => {
    resetMppSpendTracker();
    expect(getMppCumulativeSpentHbar()).to.equal(0);
  });

  it("converts wei gas cost to HBAR for cap checks", () => {
    const wei = gasCostFromReceipt({ gasUsed: 1_343_654n, gasPrice: 1_070_000_000_000n });
    const hbar = gasCostHbarFromWei(wei);
    expect(hbar).to.be.closeTo(1.43770978, 0.0001);
    resetMppSpendTracker();
    expect(wouldExceedMppCap(wei, 200)).to.equal(false);
  });
});

describe("cost estimate", () => {
  it("estimates POC job under allowance cap", () => {
    const est = estimateJobCostHbar("arch-low-8", 2, 1);
    expect(est).to.be.lessThanOrEqual(ALLOWANCE_CAP_HBAR);
  });
});
