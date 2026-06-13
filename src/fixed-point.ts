import { AbiCoder, keccak256 } from "ethers";

const abiCoder = AbiCoder.defaultAbiCoder();

function deriveSparseWeight(hash: string, dim: number): bigint {
  const hashBytes = hash.startsWith("0x") ? hash : `0x${hash}`;
  const derived = keccak256(abiCoder.encode(["bytes32", "uint256"], [hashBytes, dim]));
  const selector = Number(BigInt(derived) >> 248n) & 0xff;
  if (selector % 3 === 0) return 0n;
  const sign = (Number(BigInt(derived) >> 240n) & 0xff) % 2 === 0 ? -1n : 1n;
  return sign * SCALE;
}

export const SCALE = 65536n;
export const SCALE_BITS = 16n;

export function mul(a: bigint, b: bigint): bigint {
  return (a * b) >> SCALE_BITS;
}

export function div(a: bigint, b: bigint): bigint {
  return (a << SCALE_BITS) / b;
}

export function relu(x: bigint): bigint {
  return x > 0n ? x : 0n;
}

export function sigmoid(x: bigint): bigint {
  if (x > 4n * SCALE) return SCALE;
  if (x < -4n * SCALE) return 0n;
  const half = SCALE / 2n;
  const c1 = 12909n;
  const c2 = 262n;
  const x2 = mul(x, x);
  const inner = mul(c1 - mul(c2, x2), x);
  return half + inner;
}

export function dot(a: bigint[], b: bigint[]): bigint {
  let sum = 0n;
  for (let i = 0; i < a.length; i++) {
    sum += mul(a[i], b[i]);
  }
  return sum;
}

export function floatToFixed(n: number): bigint {
  return BigInt(Math.round(n * Number(SCALE)));
}

export function fixedToFloat(n: bigint): number {
  return Number(n) / Number(SCALE);
}

export function sparseDot(hash: string, x: bigint[]): bigint {
  const row = getSparseProjectionRow(hash, x.length);
  return dot(row, x);
}

export function getSparseProjectionRow(hash: string, inputDim: number): bigint[] {
  const row = new Array(inputDim).fill(0n);
  for (let i = 0; i < inputDim; i++) {
    row[i] = deriveSparseWeight(hash, i);
  }
  return row;
}

export function computePhiRelu(
  x: bigint[],
  hashes: string[],
  bias: bigint[]
): bigint[] {
  const phi: bigint[] = [];
  for (let i = 0; i < hashes.length; i++) {
    const z = sparseDot(hashes[i], x) + bias[i];
    phi.push(relu(z));
  }
  return phi;
}

export function predict(phi: bigint[], beta: bigint[]): bigint {
  let out = 0n;
  for (let i = 0; i < phi.length; i++) {
    out += mul(phi[i], beta[i]);
  }
  return sigmoid(out);
}
