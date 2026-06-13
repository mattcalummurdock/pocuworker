import { CompiledInstruction } from "./types";
import { TensorRecord } from "./types";
import { TensorStore } from "./tensor-store";
import { Op } from "./isa";

export interface BatchStepCalldata {
  outTensorId: string;
  opcode: number;
  inputTensorIds: string[];
  inShape: number[];
  literalData: bigint[];
  outShape: number[];
  params: bigint[];
}

export type BatchStepAbiTuple = [
  string,
  number,
  string[],
  number[],
  bigint[],
  number[],
  bigint[],
];

/** ethers populateTransaction expects tuple arrays, not keyed objects. */
export function batchStepsToAbi(steps: BatchStepCalldata[]): BatchStepAbiTuple[] {
  return steps.map((s) => [
    s.outTensorId,
    s.opcode,
    s.inputTensorIds,
    s.inShape,
    s.literalData,
    s.outShape,
    s.params,
  ]);
}

function orderedInputIds(inst: CompiledInstruction): string[] {
  if (inst.literal) return [];
  const keys = Object.keys(inst.inputs);
  if (inst.opcode === Op.MATMUL) {
    const w = inst.inputs.W ?? inst.inputs[keys[0]];
    const x = inst.inputs.x ?? inst.inputs.a ?? inst.inputs[keys[1]];
    return [w, x].filter(Boolean);
  }
  if (inst.opcode === Op.ADAM) {
    return ["grad", "W", "m", "v"].filter((k) => inst.inputs[k]).map((k) => inst.inputs[k]);
  }
  if (inst.opcode === Op.TRANSPOSE) {
    return [inst.inputs.W ?? inst.inputs[keys[0]]];
  }
  return keys.map((k) => inst.inputs[k]);
}

/** Carry tensors from prior TXs into batch memory via calldata (hybrid log-only pattern). */
export function seedStepFromTensor(t: TensorRecord): BatchStepCalldata {
  const flatLen = t.data.length;
  const outShape = t.shape.length > 0 ? t.shape : [flatLen];
  return {
    outTensorId: t.tensorId,
    opcode: Op.FLATTEN,
    inputTensorIds: [],
    inShape: [flatLen],
    literalData: [...t.data],
    outShape,
    params: [],
  };
}

export function collectExternalTensorIds(
  batch: CompiledInstruction[]
): string[] {
  const available = new Set<string>();
  const external: string[] = [];
  for (const inst of batch) {
    if (inst.literal) {
      available.add(inst.output);
      continue;
    }
    for (const id of orderedInputIds(inst)) {
      if (!available.has(id) && !external.includes(id)) external.push(id);
    }
    available.add(inst.output);
  }
  return external;
}

/**
 * Pack batch step: within-batch refs use memory cache IDs;
 * cross-TX tensors are seeded via calldata before the batch runs.
 */
export function packBatchStep(
  inst: CompiledInstruction,
  available: Set<string>
): BatchStepCalldata {
  if (inst.literal) {
    return {
      outTensorId: inst.output,
      opcode: inst.opcode,
      inputTensorIds: [],
      inShape: inst.literal.shape,
      literalData: [...inst.literal.data],
      outShape: inst.outShape,
      params: inst.params,
    };
  }

  const inputTensorIds = orderedInputIds(inst);
  if (inputTensorIds.every((id) => available.has(id))) {
    return {
      outTensorId: inst.output,
      opcode: inst.opcode,
      inputTensorIds,
      inShape: inst.inShape,
      literalData: [],
      outShape: inst.outShape,
      params: inst.params,
    };
  }

  throw new Error(
    `Batch step ${inst.op} missing seeded tensors: ${inputTensorIds.filter((id) => !available.has(id)).join(", ")}`
  );
}

/** Packs calldata for core.execute — reads tensors only, no math. */
export function packInstructionCalldata(
  jobId: string,
  inst: CompiledInstruction,
  store: TensorStore
): {
  inShape: number[];
  inData: bigint[];
  outShape: number[];
  params: bigint[];
  outTensorId: string;
} {
  if (inst.literal) {
    return {
      inShape: inst.literal.shape,
      inData: [...inst.literal.data],
      outShape: inst.outShape,
      params: inst.params,
      outTensorId: inst.output,
    };
  }

  const keys = Object.keys(inst.inputs);
  const inData: bigint[] = [];

  if (inst.opcode === 1) {
    const w = store.require(jobId, inst.inputs.W ?? inst.inputs[keys[0]]);
    const x = store.require(jobId, inst.inputs.x ?? inst.inputs.a ?? inst.inputs[keys[1]]);
    inData.push(...w.data, ...x.data);
  } else if (inst.opcode === 2 || inst.opcode === 3) {
    for (const k of keys) {
      inData.push(...store.require(jobId, inst.inputs[k]).data);
    }
  } else if (inst.opcode === Op.OUTER) {
    const d = store.require(jobId, inst.inputs.d);
    const a = store.require(jobId, inst.inputs.a);
    inData.push(...d.data, ...a.data);
  } else if (inst.opcode === 6 || inst.opcode === 5) {
    for (const k of keys) {
      inData.push(...store.require(jobId, inst.inputs[k]).data);
    }
  } else if (inst.opcode === 32 || inst.opcode === 33) {
    for (const k of keys) {
      inData.push(...store.require(jobId, inst.inputs[k]).data);
    }
  } else if (inst.opcode >= 34 && inst.opcode <= 39) {
    for (const k of keys) {
      inData.push(...store.require(jobId, inst.inputs[k]).data);
    }
  } else if (inst.opcode === 49) {
    for (const k of ["grad", "W", "m", "v"]) {
      if (inst.inputs[k]) inData.push(...store.require(jobId, inst.inputs[k]).data);
    }
    if (inData.length === 0) {
      for (const k of keys) {
        inData.push(...store.require(jobId, inst.inputs[k]).data);
      }
    }
  } else if (inst.opcode === 48 || inst.opcode === 50) {
    for (const k of keys) {
      inData.push(...store.require(jobId, inst.inputs[k]).data);
    }
  } else if (inst.opcode === 7) {
    const t = store.require(jobId, inst.inputs.W ?? inst.inputs[keys[0]]);
    inData.push(...t.data);
  } else {
    const key = keys[0];
    const t = store.require(jobId, inst.inputs[key]);
    inData.push(...t.data);
  }

  return {
    inShape: inst.inShape,
    inData,
    outShape: inst.outShape,
    params: inst.params,
    outTensorId: inst.output,
  };
}
