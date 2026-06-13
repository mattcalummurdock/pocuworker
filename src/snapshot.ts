import { solidityPackedKeccak256 } from "ethers";

export function computeMatrixSnapshot(hashes: string[]): string {
  let snapshot = `0x${"0".repeat(64)}`;
  for (const hash of hashes) {
    snapshot = solidityPackedKeccak256(["bytes32", "bytes32"], [snapshot, hash]);
  }
  return snapshot;
}
