import { AbiCoder, keccak256 } from "ethers";

const coder = AbiCoder.defaultAbiCoder();

/** Must match TensorEvents.tensorDataHash — keccak256(abi.encode(int256[])). */
export function hashTensorData(data: bigint[]): string {
  return keccak256(coder.encode(["int256[]"], [data]));
}
