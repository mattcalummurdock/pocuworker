import { SCALE, mul, relu, sigmoid } from "../fixed-point";

export interface MlpWeights {
  layers: { W: number[][]; b: number[] }[];
}

export function mlpForward(features: number[], weights: MlpWeights): number {
  const x = features.map((f) => BigInt(Math.round(f * Number(SCALE))));
  let h = x;

  for (let li = 0; li < weights.layers.length; li++) {
    const { W, b } = weights.layers[li];
    const out: bigint[] = [];
    for (let i = 0; i < W.length; i++) {
      let z = BigInt(Math.round(b[i] * Number(SCALE)));
      for (let j = 0; j < h.length; j++) {
        const w = BigInt(Math.round(W[i][j] * Number(SCALE)));
        z += mul(w, h[j]);
      }
      const isLast = li === weights.layers.length - 1;
      out.push(isLast ? sigmoid(z) : relu(z));
    }
    h = out;
  }

  return Number(h[0]) / Number(SCALE);
}

export function unpackWeights(
  flat: bigint[],
  hiddenSizes: number[],
  inputDim: number,
  outDim: number
): MlpWeights {
  const toF = (v: bigint) => Number(v) / Number(SCALE);
  let o = 0;
  const dims = [inputDim, ...hiddenSizes, outDim];
  const layers: { W: number[][]; b: number[] }[] = [];

  for (let li = 0; li < dims.length - 1; li++) {
    const rows = dims[li + 1];
    const cols = dims[li];
    const W: number[][] = [];
    for (let i = 0; i < rows; i++) {
      W.push(Array.from({ length: cols }, () => toF(flat[o++])));
    }
    const b = Array.from({ length: rows }, () => toF(flat[o++]));
    layers.push({ W, b });
  }

  return { layers };
}

/** @deprecated Use unpackWeights with hiddenSizes */
export function unpackWeightsLegacy(
  flat: bigint[],
  h1: number,
  inputDim: number,
  outDim: number
): { W1: number[][]; b1: number[]; W2: number[][]; b2: number[] } {
  const w = unpackWeights(flat, [h1], inputDim, outDim);
  return {
    W1: w.layers[0].W,
    b1: w.layers[0].b,
    W2: w.layers[1].W,
    b2: w.layers[1].b,
  };
}
