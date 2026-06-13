export type ActivationName = "relu" | "sigmoid" | "tanh" | "none";
export type OptimizerName = "adam" | "sgd";
export type LossName = "cross_entropy" | "mse";

export interface MlpLayerSpec {
  size: number;
  activation: ActivationName;
}

export interface MlpModelSpec {
  architecture: "mlp";
  inputDim: number;
  layers: MlpLayerSpec[];
  numClasses: number;
  optimizer: OptimizerName;
  loss: LossName;
  epochs: number;
  batchSize: number;
  learningRate: number;
  adamBeta1?: number;
  adamBeta2?: number;
}

/** 3-layer MLP for fraud tabular (6 → 64 → 32 → 1), cpuarc Section 5. */
export const DEFAULT_FRAUD_MLP: MlpModelSpec = {
  architecture: "mlp",
  inputDim: 6,
  layers: [
    { size: 64, activation: "relu" },
    { size: 32, activation: "relu" },
  ],
  numClasses: 1,
  optimizer: "adam",
  loss: "cross_entropy",
  epochs: 2,
  batchSize: 1,
  learningRate: 0.01,
  adamBeta1: 0.9,
  adamBeta2: 0.999,
};
