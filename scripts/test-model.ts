import { existsSync, readFileSync } from "fs";
import { ethers } from "ethers";
import { loadFraudCsv, preprocessFraudData, featuresToFloats, labelsToFloats } from "../src/preprocess";
import { computeClassificationMetrics, bestF1Threshold, computeAUC } from "../src/ml/metrics";
import { mlpForward, unpackWeights } from "../src/cpu/inference";
import { loadDeployment } from "../src/cpu/runner";

async function main() {
  const manifestPath = "output/cpu_model_manifest.json";
  if (!existsSync(manifestPath)) {
    throw new Error("Run training first: npm run train");
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const deployment = loadDeployment();
  const rows = loadFraudCsv("data/fraud_sample.csv");
  const { test } = preprocessFraudData(rows);

  const labels = test.map((s) => labelsToFloats(s)[0]);
  const features = test.map((s) => featuresToFloats(s));

  const provider = new ethers.JsonRpcProvider(
    process.env.HEDERA_RPC_URL ?? "https://testnet.hashio.io/api"
  );
  let flat: bigint[];
  if (manifest.finalWeights?.length) {
    flat = manifest.finalWeights.map((w: string) => BigInt(w));
  } else {
    const registryAbi = [
      "function getWeight(bytes32 jobId, uint256 i) view returns (int256)",
      "function weightCount(bytes32 jobId) view returns (uint256)",
    ];
    const registry = new ethers.Contract(deployment.modelRegistry, registryAbi, provider);
    const count = Number(await registry.weightCount(manifest.jobId));
    flat = [];
    for (let i = 0; i < count; i++) {
      flat.push(await registry.getWeight(manifest.jobId, i));
    }
  }

  const arch = manifest.architecture as string;
  const parts = arch.replace("mlp-", "").split("-");
  const outDim = parseInt(parts[parts.length - 1] ?? "1", 10);
  const hiddenSizes = parts.slice(0, -1).map((p) => parseInt(p, 10));
  const inputDim = features[0]?.length ?? 6;
  const weights = unpackWeights(flat, hiddenSizes, inputDim, outDim);

  const scores = features.map((f) => mlpForward(f, weights));
  const metrics05 = computeClassificationMetrics(labels, scores, 0.5);
  const metricsBest = bestF1Threshold(labels, scores);

  console.log("=== On-Chain CPU Model Test ===");
  console.log(`Architecture: ${manifest.architecture}`);
  console.log(`Trained: ${manifest.samplesTrained} samples × ${manifest.epochs} epochs`);
  console.log(`Test set: ${test.length} samples`);
  console.log(`AUC: ${metrics05.auc.toFixed(4)}`);
  console.log(`Best F1 threshold: ${metricsBest.threshold.toFixed(4)} → F1=${metricsBest.f1.toFixed(4)}`);
  console.log(`Program hash: ${manifest.programHash}`);
  console.log(`Event log hash: ${manifest.eventLogHash}`);
  console.log(`HCS topic: ${manifest.hcsTopicId}`);
  console.log(`Training TXs: ${manifest.trainingTxIds?.length ?? 0}`);

  if (metrics05.auc <= 0.5) {
    throw new Error(`AUC ${metrics05.auc} not better than random`);
  }
  console.log("\nAll tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
