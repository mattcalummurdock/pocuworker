import { config as loadEnv } from "dotenv";
loadEnv();

import { AccountId, Hbar, TransferTransaction } from "@hashgraph/sdk";
import { getHederaSdkClient } from "../src/hedera-client";

async function main() {
  const recipient = process.argv[2] ?? "0.0.10579216";
  const amount = parseFloat(process.argv[3] ?? "120");
  const fromId = process.env.ACCOUNT_ID;

  if (!fromId) {
    throw new Error("ACCOUNT_ID required in .env (agent wallet)");
  }
  if (!/^0\.0\.\d+$/.test(recipient)) {
    throw new Error(`Invalid recipient account id: ${recipient}`);
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amount: ${amount}`);
  }

  const client = getHederaSdkClient();
  const from = AccountId.fromString(fromId);
  const to = AccountId.fromString(recipient);

  console.log(`Sending ${amount} HBAR`);
  console.log(`  from: ${fromId}`);
  console.log(`  to:   ${recipient}`);

  const tx = await new TransferTransaction()
    .addHbarTransfer(from, new Hbar(-amount))
    .addHbarTransfer(to, new Hbar(amount))
    .setTransactionMemo(`POCU transfer ${amount} HBAR`)
    .execute(client);

  const receipt = await tx.getReceipt(client);
  console.log(`Done: tx=${tx.transactionId.toString()} status=${receipt.status}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
