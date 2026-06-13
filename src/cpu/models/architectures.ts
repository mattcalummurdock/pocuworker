import { MlpLayerSpec, MlpModelSpec } from "./mlp-spec";

export type ArchitectureTier = "low" | "mid";
export type ArchitectureTaskType = "classification" | "regression";

export interface ArchitectureTemplate {
  id: string;
  name: string;
  tier: ArchitectureTier;
  description: string;
  layers: MlpLayerSpec[];
  optimizer: "adam" | "sgd";
  loss: "cross_entropy" | "mse";
  taskType: ArchitectureTaskType;
  maxInputDim: number;
  maxNumClasses: number;
  learningRate: number;
  batchSize: number;
}

export const ARCHITECTURE_TEMPLATES: ArchitectureTemplate[] = [
  {
    id: "arch-low-8",
    name: "Low 8",
    tier: "low",
    description: "Single hidden layer (8). Fastest testnet runs.",
    layers: [{ size: 8, activation: "relu" }],
    optimizer: "sgd",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 32,
    maxNumClasses: 10,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-low-16",
    name: "Low 16",
    tier: "low",
    description: "Single hidden layer (16). Low TX cost.",
    layers: [{ size: 16, activation: "relu" }],
    optimizer: "sgd",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 32,
    maxNumClasses: 10,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-low-16-8",
    name: "Low 16→8",
    tier: "low",
    description: "Two hidden layers (16→8). Balanced low-tier.",
    layers: [
      { size: 16, activation: "relu" },
      { size: 8, activation: "relu" },
    ],
    optimizer: "sgd",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 64,
    maxNumClasses: 10,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-low-mse-16",
    name: "Low 16→8 Regression",
    tier: "low",
    description: "Regression head with MSE loss.",
    layers: [
      { size: 16, activation: "relu" },
      { size: 8, activation: "relu" },
    ],
    optimizer: "sgd",
    loss: "mse",
    taskType: "regression",
    maxInputDim: 32,
    maxNumClasses: 1,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-mid-32-16",
    name: "Mid 32→16",
    tier: "mid",
    description: "Default mid-tier classifier (32→16). Good default.",
    layers: [
      { size: 32, activation: "relu" },
      { size: 16, activation: "relu" },
    ],
    optimizer: "adam",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 64,
    maxNumClasses: 10,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-mid-64-32",
    name: "Mid 64→32",
    tier: "mid",
    description: "Larger mid-tier classifier (64→32).",
    layers: [
      { size: 64, activation: "relu" },
      { size: 32, activation: "relu" },
    ],
    optimizer: "adam",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 64,
    maxNumClasses: 10,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-mid-24-12-3",
    name: "Mid 24→12 (≤3 class)",
    tier: "mid",
    description: "Multiclass up to 3 labels.",
    layers: [
      { size: 24, activation: "relu" },
      { size: 12, activation: "relu" },
    ],
    optimizer: "adam",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 32,
    maxNumClasses: 3,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-mid-32-16-5",
    name: "Mid 32→16 (≤5 class)",
    tier: "mid",
    description: "Multiclass up to 5 labels.",
    layers: [
      { size: 32, activation: "relu" },
      { size: 16, activation: "relu" },
    ],
    optimizer: "adam",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 64,
    maxNumClasses: 5,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-mid-mse-24-12",
    name: "Mid 24→12 Regression",
    tier: "mid",
    description: "Adam regression with MSE loss.",
    layers: [
      { size: 24, activation: "relu" },
      { size: 12, activation: "relu" },
    ],
    optimizer: "adam",
    loss: "mse",
    taskType: "regression",
    maxInputDim: 64,
    maxNumClasses: 1,
    learningRate: 0.01,
    batchSize: 1,
  },
  {
    id: "arch-mid-wide-48",
    name: "Mid 48→24 Wide",
    tier: "mid",
    description: "Wide input (up to 128 features).",
    layers: [
      { size: 48, activation: "relu" },
      { size: 24, activation: "relu" },
    ],
    optimizer: "adam",
    loss: "cross_entropy",
    taskType: "classification",
    maxInputDim: 128,
    maxNumClasses: 10,
    learningRate: 0.01,
    batchSize: 1,
  },
];

export function getArchitectureById(id: string): ArchitectureTemplate {
  const arch = ARCHITECTURE_TEMPLATES.find((a) => a.id === id);
  if (!arch) {
    throw new Error(
      `Unknown architecture: ${id}. Valid: ${ARCHITECTURE_TEMPLATES.map((a) => a.id).join(", ")}`
    );
  }
  return arch;
}

export function listArchitectures(tier?: ArchitectureTier): ArchitectureTemplate[] {
  if (!tier) return [...ARCHITECTURE_TEMPLATES];
  return ARCHITECTURE_TEMPLATES.filter((a) => a.tier === tier);
}

export function architectureToSpec(
  arch: ArchitectureTemplate,
  inputDim: number,
  numClasses: number,
  epochs: number
): MlpModelSpec {
  if (inputDim < 1 || inputDim > arch.maxInputDim) {
    throw new Error(`inputDim ${inputDim} outside architecture max ${arch.maxInputDim}`);
  }
  if (arch.taskType === "regression") {
    if (numClasses !== 1) {
      throw new Error("Regression architecture requires numClasses=1");
    }
  } else if (numClasses < 1 || numClasses > arch.maxNumClasses) {
    throw new Error(`numClasses ${numClasses} outside architecture max ${arch.maxNumClasses}`);
  }

  return {
    architecture: "mlp",
    inputDim,
    layers: arch.layers.map((l) => ({ ...l })),
    numClasses: arch.taskType === "regression" ? 1 : numClasses,
    optimizer: arch.optimizer,
    loss: arch.loss,
    epochs,
    batchSize: arch.batchSize,
    learningRate: arch.learningRate,
    adamBeta1: 0.9,
    adamBeta2: 0.999,
  };
}

export function validateArchitectureForData(
  arch: ArchitectureTemplate,
  numClasses: number,
  taskInferred: "classification" | "regression"
): void {
  if (arch.taskType === "regression" && taskInferred === "classification") {
    throw new Error(
      `Architecture ${arch.id} is regression (MSE) but dataset looks like classification`
    );
  }
  if (arch.taskType === "classification" && taskInferred === "regression") {
    throw new Error(
      `Architecture ${arch.id} is classification but dataset looks like regression`
    );
  }
  if (arch.taskType === "classification" && numClasses > arch.maxNumClasses) {
    throw new Error(
      `Dataset has ${numClasses} classes but ${arch.id} supports at most ${arch.maxNumClasses}`
    );
  }
}
