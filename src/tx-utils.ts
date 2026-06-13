import {
  Contract,
  ContractTransactionReceipt,
  Overrides,
  Provider,
  Signer,
  TransactionReceipt,
  TransactionRequest,
  toQuantity,
} from "ethers";
import {
  executeViaHederaSdk,
  executeViaHfsCalldata,
  executeViaJumboEthereum,
  shouldUseHederaSdk,
  shouldUseHfsCalldata,
  shouldUseJumboEthereum,
} from "./hedera-hfs";
import type { DispatchStats } from "./dispatch-stats";
import type { StepLogger } from "./logger";

/**
 * Hedera EVM returns transactions with empty signature fields (r/s/v = 0x),
 * which breaks ethers v6 `sendTransaction` / `tx.wait()` (they call getTransaction).
 * Send via eth_sendTransaction and poll receipt only.
 */
export async function sendHederaTransaction(
  signer: Signer,
  tx: TransactionRequest
): Promise<string> {
  const provider = signer.provider;
  if (!provider) throw new Error("Signer has no provider");

  const from = await signer.getAddress();
  const nonce =
    tx.nonce ?? (await provider.getTransactionCount(from, "pending"));
  const gasLimit = tx.gasLimit ?? 15_000_000n;

  const hexTx: Record<string, string> = {
    from,
    to: tx.to as string,
    data: (tx.data as string) ?? "0x",
    gas: toQuantity(gasLimit),
    value: toQuantity(tx.value ?? 0n),
    nonce: toQuantity(nonce),
  };

  if (tx.gasPrice != null) {
    hexTx.gasPrice = toQuantity(tx.gasPrice);
  }

  return provider.send("eth_sendTransaction", [hexTx]);
}

export async function sendContractMethod(
  contract: Contract,
  method: string,
  args: unknown[],
  overrides?: Overrides
): Promise<string> {
  const signer = contract.runner as Signer;
  if (!signer) throw new Error("Contract has no signer");

  const populated = await contract.getFunction(method).populateTransaction(...args);
  return sendHederaTransaction(signer, {
    to: populated.to,
    data: populated.data,
    gasLimit: overrides?.gasLimit,
    gasPrice: overrides?.gasPrice,
  });
}

export async function waitForTransactionReceipt(
  provider: Provider,
  txHash: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<TransactionReceipt> {
  const timeoutMs = options?.timeoutMs ?? 300_000;
  const envPoll = parseInt(process.env.TX_RECEIPT_POLL_MS ?? "750", 10);
  const intervalMs = options?.intervalMs ?? (Number.isFinite(envPoll) ? envPoll : 750);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const receipt = await provider.getTransactionReceipt(txHash);
    if (receipt) {
      if (receipt.status === 0) {
        throw new Error(`Transaction reverted on-chain: ${txHash}`);
      }
      return receipt;
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timeout waiting for transaction receipt: ${txHash}`);
}

export async function waitForContractReceipt(
  provider: Provider,
  txHash: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<ContractTransactionReceipt> {
  return (await waitForTransactionReceipt(provider, txHash, options)) as ContractTransactionReceipt;
}

export interface SendContractOptions extends Overrides {
  stats?: DispatchStats;
  log?: StepLogger;
  txLabel?: string;
}

function logReceiptCost(
  log: StepLogger | undefined,
  label: string,
  receipt: ContractTransactionReceipt
): void {
  if (!log) return;
  const gasUsed = receipt.gasUsed;
  const gasPrice = receipt.gasPrice ?? 0n;
  log.recordTxCost(label, gasUsed, gasPrice, receipt.hash, receipt.blockNumber);
}

/** Send contract call and wait for Hedera-safe receipt. */
export async function sendAndWaitContract(
  contract: Contract,
  method: string,
  args: unknown[],
  overrides?: SendContractOptions
): Promise<ContractTransactionReceipt> {
  const signer = contract.runner as Signer;
  if (!signer?.provider) throw new Error("Contract has no signer/provider");

  const populated = await contract.getFunction(method).populateTransaction(...args);
  const data = (populated.data as string) ?? "0x";
  const gasLimit = overrides?.gasLimit ?? 15_000_000n;
  const network = await signer.provider.getNetwork();
  const to = await contract.getAddress();
  const label = overrides?.txLabel ?? method;

  let receipt: ContractTransactionReceipt;

  if (shouldUseHfsCalldata(network.chainId, data)) {
    overrides?.stats?.markEvm("hfs");
    receipt = await executeViaHfsCalldata(signer, to, data, gasLimit);
  } else if (shouldUseJumboEthereum(network.chainId, data)) {
    overrides?.stats?.markEvm("rpc");
    receipt = await executeViaJumboEthereum(signer, to, data, gasLimit);
  } else if (shouldUseHederaSdk(network.chainId, data)) {
    overrides?.stats?.markEvm("sdk");
    receipt = await executeViaHederaSdk(signer, to, data, gasLimit);
  } else {
    overrides?.stats?.markEvm("rpc");
    const hash = await sendHederaTransaction(signer, {
      to: populated.to,
      data,
      gasLimit,
      gasPrice: overrides?.gasPrice,
    });
    overrides?.log?.info(`TX submitted: ${label} → ${hash}`);
    receipt = await waitForContractReceipt(signer.provider, hash);
  }

  logReceiptCost(overrides?.log, label, receipt);
  return receipt;
}
