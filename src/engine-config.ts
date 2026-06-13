/**
 * On-chain CPU operating envelope.
 * @see docs/cpuarc.md, docs/arcMods.md
 */
export const ENGINE_LIMITS = {
  inputDim: { min: 1, max: 128 },
  numClasses: { min: 1, max: 32 },
  batchSize: { min: 1, max: 32 },
  maxEpochs: 1000,
  maxMatDim: 64,
  maxTensorElements: 16384,
  maxProgramInstructions: 10_000,
  maxTreeDepth: 6,
} as const;

export interface EngineParams {
  inputDim: number;
  numClasses: number;
  batchSize: number;
  epochs: number;
  learningRate: bigint;
  defaultTrainSamples: number;
  costCapHbar: number;
}

function clampInt(
  raw: string | undefined,
  limits: { min: number; max: number },
  fallback: number
): number {
  const n = raw !== undefined ? parseInt(raw, 10) : fallback;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(limits.max, Math.max(limits.min, n));
}

export function resolveEngineParams(env: NodeJS.ProcessEnv = process.env): EngineParams {
  return {
    inputDim: clampInt(env.INPUT_DIM, ENGINE_LIMITS.inputDim, 6),
    numClasses: clampInt(env.NUM_CLASSES, ENGINE_LIMITS.numClasses, 1),
    batchSize: clampInt(env.BATCH_SIZE, ENGINE_LIMITS.batchSize, 10),
    epochs: clampInt(env.TRAIN_EPOCHS, { min: 1, max: ENGINE_LIMITS.maxEpochs }, 5),
    learningRate: env.LEARNING_RATE ? BigInt(env.LEARNING_RATE) : 3277n,
    defaultTrainSamples: clampInt(env.DEFAULT_TRAIN_SAMPLES, { min: 1, max: 100_000 }, 100),
    costCapHbar: clampInt(env.COST_CAP_HBAR, { min: 1, max: 1_000_000 }, 175),
  };
}

export function validateEngineParams(params: EngineParams): void {
  const L = ENGINE_LIMITS;
  if (params.inputDim < L.inputDim.min || params.inputDim > L.inputDim.max) {
    throw new Error(`inputDim ${params.inputDim} outside envelope`);
  }
  if (params.numClasses < L.numClasses.min || params.numClasses > L.numClasses.max) {
    throw new Error(`numClasses ${params.numClasses} outside envelope`);
  }
  if (params.batchSize < L.batchSize.min || params.batchSize > L.batchSize.max) {
    throw new Error(`batchSize ${params.batchSize} outside envelope`);
  }
}
