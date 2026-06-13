export interface FraudRow {
  amount: number;
  merchant_category: number;
  hour: number;
  location_delta: number;
  velocity: number;
  is_weekend: number;
  is_fraud: number;
}

/** Task-agnostic tabular row for the on-chain compute engine. */
export interface TabularSample {
  features: bigint[];
  labels: bigint[];
}

export interface TrainTestSplit {
  train: TabularSample[];
  test: TabularSample[];
  dataHash: string;
  featureStats: FeatureStats;
}

export interface FeatureStats {
  amountMean: number;
  amountStd: number;
  merchantCategories: number[];
}

export interface HarvestedTx {
  hash: string;
  timestamp: string;
}

export interface CpuCoreAddresses {
  linear: string;
  activation: string;
  gradient: string;
  optimizer: string;
  aggregation: string;
}

export interface DeploymentAddresses {
  network: string;
  txHarvester: string;
  cpuJobRegistry: string;
  cpuBatchExecutor?: string;
  modelRegistry: string;
  cores: CpuCoreAddresses;
  inputDim: number;
  hcsTopicId?: string;
  deployedAt: string;
  trainingMode: "onchain-cpu";
}
