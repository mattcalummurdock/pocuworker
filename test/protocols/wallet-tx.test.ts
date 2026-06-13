import { expect } from "chai";
import {
  AccountAllowanceApproveTransaction,
  AccountId,
  Hbar,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
} from "@hashgraph/sdk";

describe("wallet transaction build", () => {
  const user = "0.0.9211283";
  const agent = "0.0.6111100";
  const token = "0.0.9211401";

  it("builds unfrozen associate tx bytes (HIP-745)", () => {
    const tx = new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(user))
      .setTokenIds([TokenId.fromString(token)])
      .setMaxTransactionFee(Hbar.from(5));
    const bytes = tx.toBytes();
    expect(bytes).to.be.instanceOf(Uint8Array);
    expect(bytes.length).to.be.greaterThan(10);
  });

  it("builds allowance and transfer txs without freezing", () => {
    const allowance = new AccountAllowanceApproveTransaction()
      .approveHbarAllowance(
        AccountId.fromString(user),
        AccountId.fromString(agent),
        Hbar.from(200)
      )
      .setMaxTransactionFee(Hbar.from(5));
    expect(allowance.toBytes().length).to.be.greaterThan(10);

    const transfer = new TransferTransaction()
      .addHbarTransfer(AccountId.fromString(user), Hbar.from(-0.01))
      .addHbarTransfer(AccountId.fromString(agent), Hbar.from(0.01))
      .setMaxTransactionFee(Hbar.from(5));
    expect(transfer.toBytes().length).to.be.greaterThan(10);
  });
});
