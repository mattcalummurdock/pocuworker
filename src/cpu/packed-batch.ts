import { Interface, keccak256 } from "ethers";
import { BatchStepCalldata } from "./postman";

const MAGIC = new Uint8Array([0x43, 0x50, 0x55, 0x42]); // CPUB
const VERSION = 1;

function writeU16(buf: number[], v: number): void {
  buf.push((v >> 8) & 0xff, v & 0xff);
}

function writeU32(buf: number[], v: number): void {
  buf.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
}

function writeBytes32(buf: number[], hex: string): void {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  for (let i = 0; i < 64; i += 2) buf.push(parseInt(h.slice(i, i + 2), 16));
}

function writeInt256(buf: number[], v: bigint): void {
  let u = v;
  if (u < 0n) u = (1n << 256n) + u;
  const hex = u.toString(16).padStart(64, "0");
  writeBytes32(buf, `0x${hex}`);
}

/** Pack batch steps into compact CPUB bytes (Phase C calldata). */
export function packBatchSteps(steps: BatchStepCalldata[]): Uint8Array {
  const parts: number[] = [...MAGIC, VERSION];
  writeU16(parts, steps.length);

  for (const s of steps) {
    writeBytes32(parts, s.outTensorId);
    parts.push(s.opcode & 0xff);
    parts.push(s.inputTensorIds.length & 0xff);
    for (const id of s.inputTensorIds) writeBytes32(parts, id);

    parts.push(s.inShape.length & 0xff);
    for (const d of s.inShape) writeU16(parts, d);

    writeU32(parts, s.literalData.length);
    for (const d of s.literalData) writeInt256(parts, d);

    parts.push(s.outShape.length & 0xff);
    for (const d of s.outShape) writeU16(parts, d);

    parts.push(s.params.length & 0xff);
    for (const p of s.params) writeInt256(parts, p);
  }

  return Uint8Array.from(parts);
}

export function hashPackedPayload(packed: Uint8Array): string {
  return keccak256(packed);
}

const PACKED_ABI =
  "function executeBatchPacked(bytes32 jobId, uint64 batchIndex, bytes32 batchHash, bytes32 payloadHash, bytes packed)";

const packedIface = new Interface([PACKED_ABI]);

export function encodeBatchPackedCalldataBytes(
  jobId: string,
  batchIndex: number,
  batchHash: string,
  payloadHash: string,
  packed: Uint8Array
): number {
  const data = packedIface.encodeFunctionData("executeBatchPacked", [
    jobId,
    BigInt(batchIndex),
    batchHash,
    payloadHash,
    packed,
  ]);
  return (data.length - 2) / 2;
}

export function usePackedBatch(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CPU_BATCH_PACKED ?? "1") !== "0";
}

export function shouldPinBatchPayload(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CPU_BATCH_VIA_IPFS === "1" && Boolean(env.PINATA_JWT?.trim());
}
