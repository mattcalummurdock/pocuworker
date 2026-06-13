import { ethers } from "ethers";

export class StepLogger {
  private stepStart = Date.now();
  private totalHbar = 0n;
  private txCount = 0;
  private hcsCount = 0;

  constructor(private readonly prefix = "") {}

  section(title: string): void {
    this.stepStart = Date.now();
    console.log(`\n${"=".repeat(60)}`);
    console.log(`${this.prefix}${title}`);
    console.log(`${"=".repeat(60)}`);
  }

  info(msg: string): void {
    console.log(`[${ts()}] ${this.prefix}${msg}`);
  }

  /** Log an HCS topic message (coordination / audit trail — not EVM gas). */
  logIpfsPin(cid: string, tensorId: string, shape: number[]): void {
    const shapeStr = shape.length > 0 ? shape.join("×") : "flat";
    this.info(
      `IPFS cid=${cid} tensor=${tensorId.slice(0, 14)}… shape=${shapeStr}`
    );
  }

  logHcs(
    type: string,
    topicId: string,
    sequenceNumber: number,
    messageHash: string,
    detail?: string
  ): void {
    this.hcsCount++;
    const shortHash = `${messageHash.slice(0, 10)}…`;
    const extra = detail ? ` | ${detail}` : "";
    this.info(
      `HCS ${type} → topic=${topicId} seq=${sequenceNumber} msgHash=${shortHash}${extra}`
    );
  }

  progress(current: number, total: number, detail?: string): void {
    const pct = total > 0 ? ((current / total) * 100).toFixed(1) : "0";
    const extra = detail ? ` | ${detail}` : "";
    console.log(`[${ts()}] ${this.prefix}[${current}/${total}] ${pct}%${extra}`);
  }

  recordTxCost(
    label: string,
    gasUsed: bigint,
    gasPrice: bigint,
    hash: string,
    blockNumber?: number
  ): void {
    this.txCount++;
    const costWei = gasUsed * gasPrice;
    this.totalHbar += costWei;
    const block = blockNumber != null ? ` | block=${blockNumber}` : "";
    this.info(
      `TX confirmed: ${label} → ${hash} | gas=${gasUsed} | cost≈${ethers.formatEther(costWei)} HBAR${block}`
    );
  }

  async trackTx(
    label: string,
    txPromise: Promise<ethers.ContractTransactionResponse>,
    provider: ethers.Provider
  ): Promise<ethers.ContractTransactionReceipt> {
    const tx = await txPromise;
    this.info(`TX submitted: ${label} → ${tx.hash}`);
    const { waitForContractReceipt } = await import("./tx-utils");
    const receipt = await waitForContractReceipt(provider, tx.hash);
    this.txCount++;

    const gasUsed = receipt.gasUsed;
    const gasPrice = receipt.gasPrice ?? tx.gasPrice ?? 0n;
    const costWei = gasUsed * gasPrice;
    this.totalHbar += costWei;

    this.info(
      `TX confirmed: ${label} | gas=${gasUsed} | cost≈${ethers.formatEther(costWei)} HBAR | block=${receipt.blockNumber}`
    );
    return receipt;
  }

  summary(): void {
    const elapsed = ((Date.now() - this.stepStart) / 1000).toFixed(1);
    console.log(`\n${"-".repeat(60)}`);
    console.log(
      `Session summary: ${this.txCount} EVM TXs | ${this.hcsCount} HCS msgs | ≈${ethers.formatEther(this.totalHbar)} HBAR (EVM only) | ${elapsed}s`
    );
    console.log(`${"-".repeat(60)}`);
  }
}

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}
