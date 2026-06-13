import { expect } from "chai";
import {
  buildAp2Mandate,
  canonicalizeMandate,
  isMandateExpired,
  mandateHash,
  ALLOWANCE_HBAR,
} from "../../src/protocols/ap2";

describe("AP2 mandate", () => {
  it("builds mandate with 200 HBAR budget", () => {
    const m = buildAp2Mandate({
      intent: "fraud detection",
      userAccountId: "0.0.1234",
      agentAccountId: "0.0.5678",
    });
    expect(m.budget.amount).to.equal(ALLOWANCE_HBAR);
    expect(m.vct).to.equal("mandate.payment.open.1");
  });

  it("canonical JSON is stable", () => {
    const m = buildAp2Mandate({
      intent: "test",
      userAccountId: "0.0.1",
      agentAccountId: "0.0.2",
    });
    m.iat = 1000;
    m.exp = 8200;
    const c1 = canonicalizeMandate(m);
    const c2 = canonicalizeMandate(m);
    expect(c1).to.equal(c2);
    expect(mandateHash(m)).to.match(/^[a-f0-9]{64}$/);
  });

  it("detects expired mandate", () => {
    const m = buildAp2Mandate({
      intent: "x",
      userAccountId: "0.0.1",
      agentAccountId: "0.0.2",
    });
    m.exp = 100;
    expect(isMandateExpired(m, 200)).to.be.true;
  });
});
