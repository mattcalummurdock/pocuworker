import { TensorRecord } from "./types";

export class TensorStore {
  private tensors = new Map<string, TensorRecord>();

  private key(jobId: string, id: string): string {
    return `${jobId}:${id}`;
  }

  put(record: TensorRecord): void {
    this.tensors.set(this.key(record.jobId, record.tensorId), record);
  }

  get(jobId: string, tensorId: string): TensorRecord | undefined {
    return this.tensors.get(this.key(jobId, tensorId));
  }

  require(jobId: string, tensorId: string): TensorRecord {
    const t = this.get(jobId, tensorId);
    if (!t) throw new Error(`Tensor not found: ${tensorId}`);
    return t;
  }

  allForJob(jobId: string): TensorRecord[] {
    return [...this.tensors.values()].filter((t) => t.jobId === jobId);
  }
}
