import { keccak256, toUtf8Bytes } from "ethers";
import { Op } from "./isa";
import { tensorId } from "./tensor-id";
import { CompiledInstruction, CompiledProgram } from "./types";
import { MlpModelSpec } from "./models/mlp-spec";
import { TabularSample } from "../types";
import { SCALE } from "../fixed-point";

function fp(n: number): bigint {
  return BigInt(Math.round(n * Number(SCALE)));
}

function initZeros(name: string, len: number): CompiledInstruction {
  return {
    seq: 0,
    op: "INIT",
    opcode: Op.FLATTEN,
    inputs: {},
    output: tensorId(name),
    inShape: [len],
    outShape: [len],
    params: [],
    literal: { shape: [len], data: Array(len).fill(0n) },
  };
}

function initSeedFromJob(jobId: string, layerIndex: number): number {
  const hex = keccak256(toUtf8Bytes(`weight-init:${jobId}:${layerIndex}`));
  return (parseInt(hex.slice(2, 10), 16) % 10000) + 1;
}

function initWeight(name: string, rows: number, cols: number, seed: number): CompiledInstruction {
  const len = rows * cols;
  return {
    seq: 0,
    op: "INIT_WEIGHT",
    opcode: Op.FLATTEN,
    inputs: {},
    output: tensorId(name),
    inShape: [len],
    outShape: [rows, cols],
    params: [],
    literal: {
      shape: [len],
      data: Array.from({ length: len }, (_, i) => BigInt(((i + seed) % 5) - 2) * 512n),
    },
  };
}

function outputActivation(spec: MlpModelSpec): "sigmoid" | "softmax" | "none" {
  if (spec.loss === "mse") return "none";
  if (spec.numClasses === 1) return "sigmoid";
  return "softmax";
}

/**
 * Compile MLP per cpuarc Section 5: MATMUL → ADD → activation → loss → backward → optimizer.
 * Supports任意 hidden layers; DEFAULT is 64 → 32 → numClasses with Adam.
 */
export function compileMlpProgram(
  spec: MlpModelSpec,
  samples: TabularSample[],
  jobId: string,
  dataHash: string
): CompiledProgram {
  const instructions: CompiledInstruction[] = [];
  let seq = 0;
  const push = (inst: Omit<CompiledInstruction, "seq">) => {
    instructions.push({ ...inst, seq: seq++ });
  };

  const inputDim = spec.inputDim;
  const hidden = spec.layers.map((l) => l.size);
  const layerDims = [inputDim, ...hidden, spec.numClasses];
  const nLayers = layerDims.length - 1;
  const lr = fp(spec.learningRate);
  const b1 = fp(spec.adamBeta1 ?? 0.9);
  const b2 = fp(spec.adamBeta2 ?? 0.999);
  const useAdam = spec.optimizer === "adam";

  const wIds: string[] = [];
  const bIds: string[] = [];
  const mWIds: string[] = [];
  const vWIds: string[] = [];
  const mbIds: string[] = [];
  const vbIds: string[] = [];

  for (let li = 0; li < nLayers; li++) {
    const rows = layerDims[li + 1];
    const cols = layerDims[li];
    const seed = initSeedFromJob(jobId, li);
    const wName = `W${li + 1}`;
    const bName = `b${li + 1}`;
    wIds.push(tensorId(wName));
    bIds.push(tensorId(bName));
    push(initWeight(wName, rows, cols, seed));
    push(initZeros(bName, rows));
    if (useAdam) {
      mWIds.push(tensorId(`m${wName}`));
      vWIds.push(tensorId(`v${wName}`));
      mbIds.push(tensorId(`m${bName}`));
      vbIds.push(tensorId(`v${bName}`));
      push(initZeros(`m${wName}`, rows * cols));
      push(initZeros(`v${wName}`, rows * cols));
      push(initZeros(`m${bName}`, rows));
      push(initZeros(`v${bName}`, rows));
    }
  }

  const weightTensorIds = [...wIds, ...bIds];
  const outAct = outputActivation(spec);

  for (let epoch = 0; epoch < spec.epochs; epoch++) {
    for (let si = 0; si < samples.length; si++) {
      const s = samples[si];
      const tag = `e${epoch}_s${si}`;
      const xId = tensorId(`x_${tag}`);
      const yId = tensorId(`y_${tag}`);

      push({
        op: "LOAD_X",
        opcode: Op.FLATTEN,
        inputs: {},
        output: xId,
        inShape: [inputDim],
        outShape: [inputDim],
        params: [],
        literal: { shape: [inputDim], data: [...s.features] },
      });
      push({
        op: "LOAD_Y",
        opcode: Op.FLATTEN,
        inputs: {},
        output: yId,
        inShape: [spec.numClasses],
        outShape: [spec.numClasses],
        params: [],
        literal: { shape: [spec.numClasses], data: [...s.labels] },
      });

      const zIds: string[] = [];
      const aIds: string[] = [];
      let prevId = xId;
      let prevCols = inputDim;

      for (let li = 0; li < nLayers; li++) {
        const rows = layerDims[li + 1];
        const zId = tensorId(`z${li + 1}_${tag}`);
        const isOutput = li === nLayers - 1;
        const aId = isOutput ? tensorId(`pred_${tag}`) : tensorId(`a${li + 1}_${tag}`);
        zIds.push(zId);

        push({
          op: `MATMUL_L${li + 1}`,
          opcode: Op.MATMUL,
          inputs: { W: wIds[li], x: prevId },
          output: zId,
          inShape: [rows, prevCols],
          outShape: [rows, 1],
          params: [],
        });
        push({
          op: `ADD_B${li + 1}`,
          opcode: Op.ADD,
          inputs: { z: zId, b: bIds[li] },
          output: zId,
          inShape: [rows],
          outShape: [rows],
          params: [],
        });

        const act = isOutput ? outAct : spec.layers[li].activation;
        if (act === "relu") {
          push({
            op: `RELU_L${li + 1}`,
            opcode: Op.RELU,
            inputs: { X: zId },
            output: aId,
            inShape: [rows],
            outShape: [rows],
            params: [],
          });
        } else if (act === "sigmoid") {
          push({
            op: `SIGMOID_L${li + 1}`,
            opcode: Op.SIGMOID,
            inputs: { X: zId },
            output: aId,
            inShape: [rows],
            outShape: [rows],
            params: [],
          });
        } else if (act === "softmax") {
          push({
            op: `SOFTMAX_L${li + 1}`,
            opcode: Op.SOFTMAX,
            inputs: { X: zId },
            output: aId,
            inShape: [rows],
            outShape: [rows],
            params: [],
          });
        } else {
          // linear output — pred is z
        }

        if (!isOutput) aIds.push(aId);
        prevId = aId;
        prevCols = rows;
      }

      const predId = tensorId(`pred_${tag}`);
      const lossId = tensorId(`loss_${tag}`);

      if (spec.loss === "mse") {
        push({
          op: "MSE",
          opcode: Op.MSE,
          inputs: { pred: predId, y: yId },
          output: lossId,
          inShape: [spec.numClasses * 2],
          outShape: [1],
          params: [],
        });
      } else {
        push({
          op: "CROSS_ENTROPY",
          opcode: Op.CROSS_ENTROPY,
          inputs: { pred: predId, y: yId },
          output: lossId,
          inShape: [spec.numClasses * 2],
          outShape: [1],
          params: [],
        });
      }

      const dPredId = tensorId(`dPred_${tag}`);
      push({
        op: "SUB_GRAD",
        opcode: Op.SUB,
        inputs: { pred: predId, y: yId },
        output: dPredId,
        inShape: [spec.numClasses],
        outShape: [spec.numClasses],
        params: [0n],
      });

      let dId = tensorId(`d_${nLayers}_${tag}`);
      const lastZ = zIds[nLayers - 1];
      if (outAct === "sigmoid") {
        push({
          op: "BACKWARD_SIGMOID",
          opcode: Op.BACKWARD_SIGMOID,
          inputs: { grad: dPredId, z: lastZ },
          output: dId,
          inShape: [spec.numClasses * 2],
          outShape: [spec.numClasses],
          params: [],
        });
      } else if (outAct === "softmax") {
        push({
          op: "BACKWARD_SOFTMAX",
          opcode: Op.BACKWARD_SOFTMAX,
          inputs: { grad: dPredId, y: yId },
          output: dId,
          inShape: [spec.numClasses * 2],
          outShape: [spec.numClasses],
          params: [],
        });
      } else {
        dId = dPredId;
      }

      for (let li = nLayers - 1; li >= 0; li--) {
        const rows = layerDims[li + 1];
        const cols = layerDims[li];
        const aPrev = li === 0 ? xId : aIds[li - 1];
        const dWId = tensorId(`dW${li + 1}_${tag}`);
        const wNewId = tensorId(`W${li + 1}_${tag}`);
        const bNewId = tensorId(`b${li + 1}_${tag}`);

        push({
          op: `OUTER_DW${li + 1}`,
          opcode: Op.OUTER,
          inputs: { d: dId, a: aPrev },
          output: dWId,
          inShape: [rows, cols],
          outShape: [rows, cols],
          params: [],
        });

        if (useAdam) {
          const tStep = BigInt(epoch * samples.length + si + 1);
          push({
            op: `ADAM_W${li + 1}`,
            opcode: Op.ADAM,
            inputs: { grad: dWId, W: wIds[li], m: mWIds[li], v: vWIds[li] },
            output: wNewId,
            inShape: [rows * cols],
            outShape: [rows * cols * 4],
            params: [lr, b1, b2, tStep],
          });
          push({
            op: `ADAM_B${li + 1}`,
            opcode: Op.ADAM,
            inputs: { grad: dId, W: bIds[li], m: mbIds[li], v: vbIds[li] },
            output: bNewId,
            inShape: [rows],
            outShape: [rows * 4],
            params: [lr, b1, b2, tStep],
          });
        } else {
          push({
            op: `SGD_W${li + 1}`,
            opcode: Op.SGD,
            inputs: { grad: dWId, W: wIds[li] },
            output: wNewId,
            inShape: [rows * cols],
            outShape: [rows * cols],
            params: [lr],
          });
          push({
            op: `SGD_B${li + 1}`,
            opcode: Op.SGD,
            inputs: { grad: dId, W: bIds[li] },
            output: bNewId,
            inShape: [rows],
            outShape: [rows],
            params: [lr],
          });
        }

        if (li > 0) {
          const wTId = tensorId(`WT${li + 1}_${tag}`);
          const dPrevId = tensorId(`d_${li}_${tag}`);
          push({
            op: `TRANSPOSE_W${li + 1}`,
            opcode: Op.TRANSPOSE,
            inputs: { W: wIds[li] },
            output: wTId,
            inShape: [rows, cols],
            outShape: [cols, rows],
            params: [],
          });
          push({
            op: `MATMUL_D${li + 1}`,
            opcode: Op.MATMUL,
            inputs: { W: wTId, d: dId },
            output: dPrevId,
            inShape: [cols, rows],
            outShape: [cols, 1],
            params: [],
          });
          const zPrev = zIds[li - 1];
          const dNextId = tensorId(`d_${li - 1}_${tag}`);
          push({
            op: `BACKWARD_RELU_L${li}`,
            opcode: Op.BACKWARD_RELU,
            inputs: { grad: dPrevId, z: zPrev },
            output: dNextId,
            inShape: [cols * 2],
            outShape: [cols],
            params: [],
          });
          dId = dNextId;
        }
      }
    }
  }

  const archHidden = hidden.join("-");
  return {
    jobId,
    dataHash,
    architecture: `mlp-${archHidden}-${spec.numClasses}`,
    instructions,
    weightTensorIds,
    epochs: spec.epochs,
    batchSize: spec.batchSize,
  };
}

export function jobIdFromData(dataHash: string): string {
  return keccak256(toUtf8Bytes(`cpu-job-${dataHash}-${Date.now()}`));
}

/** Stable bytes32 job id for a specific training run (Supabase job UUID). */
export function jobIdFromRunId(runId: string, dataHash: string): string {
  const dh = dataHash.replace(/^0x/i, "");
  return keccak256(toUtf8Bytes(`cpu-job-${runId}-${dh}`));
}
