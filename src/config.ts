import { resolveEngineParams } from "./engine-config";

const engine = resolveEngineParams();

export const INPUT_DIM = engine.inputDim;
export const NUM_CLASSES = engine.numClasses;
export const BATCH_SIZE = engine.batchSize;
export const DEFAULT_TRAIN_SAMPLES = engine.defaultTrainSamples;
export const TRAIN_EPOCHS = engine.epochs;
export const LEARNING_RATE = engine.learningRate;
export const COST_CAP_HBAR = engine.costCapHbar;
/** Hedera testnet max gas per TX is 15M; chunked logs + optimizer split keep batches under this. */
export const TX_GAS_LIMIT = 15_000_000n;
export const TRAINING_MODE = "onchain-cpu" as const;

export {
  ENGINE_LIMITS,
  resolveEngineParams,
  validateEngineParams,
} from "./engine-config";
export type { EngineParams } from "./engine-config";
