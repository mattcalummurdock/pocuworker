import { createHash } from "crypto";
import { parse } from "csv-parse/sync";
import { readFileSync } from "fs";
import { floatToFixed } from "./fixed-point";
import { FraudRow, TabularSample, TrainTestSplit, FeatureStats } from "./types";

const FEATURE_COLS = [
  "amount",
  "merchant_category",
  "hour",
  "location_delta",
  "velocity",
  "is_weekend",
] as const;

export function loadFraudCsv(path: string): FraudRow[] {
  const content = readFileSync(path, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true });
  return records as FraudRow[];
}

function normalizeAmount(amount: number, mean: number, std: number): number {
  return std > 0 ? (amount - mean) / std : 0;
}

export function preprocessFraudData(
  rows: FraudRow[],
  trainRatio = 0.8
): TrainTestSplit {
  const amounts = rows.map((r) => Number(r.amount));
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length;
  const std = Math.sqrt(variance) || 1;

  const merchants = [...new Set(rows.map((r) => Number(r.merchant_category)))];
  const featureStats: FeatureStats = { amountMean: mean, amountStd: std, merchantCategories: merchants };

  const processed: TabularSample[] = rows.map((row) => {
    const features = [
      normalizeAmount(Number(row.amount), mean, std),
      Number(row.merchant_category) / 10,
      Number(row.hour) / 24,
      Number(row.location_delta),
      Number(row.velocity) / 5,
      Number(row.is_weekend),
    ].map((f) => floatToFixed(f));

    return {
      features,
      labels: [floatToFixed(Number(row.is_fraud))],
    };
  });

  const shuffled = [...processed].sort(() => Math.random() - 0.42);
  const splitIdx = Math.floor(shuffled.length * trainRatio);
  const train = shuffled.slice(0, splitIdx);
  const test = shuffled.slice(splitIdx);

  const dataHash = createHash("sha256")
    .update(JSON.stringify(train.map((s) => ({ f: s.features.map(String), l: s.labels.map(String) }))))
    .digest("hex");

  return { train, test, dataHash, featureStats };
}

export function featuresToFloats(sample: TabularSample): number[] {
  return sample.features.map((f) => Number(f) / 65536);
}

export function labelsToFloats(sample: TabularSample): number[] {
  return sample.labels.map((l) => Number(l) / 65536);
}
