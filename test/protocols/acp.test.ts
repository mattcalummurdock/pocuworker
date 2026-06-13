import { expect } from "chai";

describe("ACP message shape", () => {
  it("serializes order payload", () => {
    const order = {
      type: "ACP_ORDER" as const,
      order_id: "job-001",
      service: "train_ml_model" as const,
      intent: "fraud",
      budget_hbar: 200,
      ap2_mandate_hash: "abc",
      status: "PENDING" as const,
    };
    const json = JSON.stringify(order);
    const parsed = JSON.parse(json);
    expect(parsed.type).to.equal("ACP_ORDER");
    expect(parsed.budget_hbar).to.equal(200);
  });
});
