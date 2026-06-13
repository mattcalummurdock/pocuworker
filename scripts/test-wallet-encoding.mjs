/**
 * Verifies unfrozen HIP-745 transactions encode for HashPack (no freezeWith).
 * Run: node scripts/test-wallet-encoding.mjs
 */
import {
  TokenAssociateTransaction,
  AccountAllowanceApproveTransaction,
  TransferTransaction,
  AccountId,
  TokenId,
  Hbar,
} from "../web/node_modules/@hiero-ledger/sdk/lib/index.js";
import { transactionToBase64String } from "../web/node_modules/@hashgraph/hedera-wallet-connect/dist/lib/shared/utils.js";

const user = "0.0.9211283";
const agent = "0.0.6111100";
const token = "0.0.9211401";

function assertEncodes(name, tx) {
  const b64 = transactionToBase64String(tx.setMaxTransactionFee(new Hbar(5)));
  if (!b64 || typeof b64 !== "string" || b64.length < 16) {
    throw new Error(`${name}: invalid base64 payload`);
  }
  console.log(`OK ${name} (${b64.length} chars)`);
}

assertEncodes(
  "associate",
  new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(user))
    .setTokenIds([TokenId.fromString(token)])
);

assertEncodes(
  "allowance",
  new AccountAllowanceApproveTransaction().approveHbarAllowance(
    AccountId.fromString(user),
    AccountId.fromString(agent),
    Hbar.from(200)
  )
);

assertEncodes(
  "transfer",
  new TransferTransaction()
    .addHbarTransfer(AccountId.fromString(user), Hbar.from(-0.01))
    .addHbarTransfer(AccountId.fromString(agent), Hbar.from(0.01))
);

console.log("All wallet transaction encodings OK");
