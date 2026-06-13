import { keccak256, toUtf8Bytes } from "ethers";

export function tensorId(name: string): string {
  return keccak256(toUtf8Bytes(name));
}
