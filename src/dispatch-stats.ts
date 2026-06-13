/** Lightweight counters for training dispatch optimisation. */
export class DispatchStats {
  hcsMessages = 0;
  evmTxs = 0;
  hfsUploads = 0;
  sdkTxs = 0;
  rpcTxs = 0;
  batchExecutes = 0;
  t0 = Date.now();

  markHcs(): void {
    this.hcsMessages++;
  }

  markEvm(kind: "rpc" | "sdk" | "hfs" = "rpc"): void {
    this.evmTxs++;
    if (kind === "sdk") this.sdkTxs++;
    if (kind === "hfs") this.hfsUploads++;
    else if (kind === "rpc") this.rpcTxs++;
  }

  markBatchExecute(): void {
    this.batchExecutes++;
  }

  summaryLine(): string {
    const sec = ((Date.now() - this.t0) / 1000).toFixed(1);
    return (
      `${this.evmTxs} EVM TXs (${this.rpcTxs} rpc, ${this.sdkTxs} sdk` +
      (this.hfsUploads ? `, ${this.hfsUploads} hfs` : "") +
      `) | ${this.hcsMessages} HCS | ${this.batchExecutes} batches | ${sec}s`
    );
  }
}
