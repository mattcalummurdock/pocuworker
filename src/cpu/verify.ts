import { keccak256, solidityPacked } from "ethers";
import { CompiledProgram } from "./types";
import { TensorStore } from "./tensor-store";

export function hashProgram(program: CompiledProgram): string {
  return keccak256(
    new TextEncoder().encode(
      JSON.stringify({
        jobId: program.jobId,
        dataHash: program.dataHash,
        architecture: program.architecture,
        instructions: program.instructions.map((i) => ({
          seq: i.seq,
          op: i.op,
          opcode: i.opcode,
          output: i.output,
        })),
      })
    )
  );
}

export function hashEventLog(
  acks: { hcsSeq: number; opcode: number; messageHash: string }[]
): string {
  const sorted = [...acks].sort((a, b) => a.hcsSeq - b.hcsSeq);
  let packed = "0x";
  for (const a of sorted) {
    packed = solidityPacked(
      ["bytes", "uint64", "uint8", "bytes32"],
      [packed, a.hcsSeq, a.opcode, a.messageHash]
    );
  }
  return keccak256(packed);
}

export function verifyProgramReplay(
  program: CompiledProgram,
  store: TensorStore,
  jobId: string
): void {
  for (const w of program.weightTensorIds) {
    if (!store.get(jobId, w)) {
      throw new Error(`Missing weight tensor after replay: ${w}`);
    }
  }
}
