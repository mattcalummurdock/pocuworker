import { config as loadEnv } from "dotenv";
loadEnv();

import { getArchitectureById } from "../src/cpu/models/architectures";
import { preprocessTabularCsv } from "../src/preprocess-tabular";

async function main() {
  const csvPath = process.env.DATA_CSV_PATH;
  const archId = process.env.ARCHITECTURE_ID ?? "arch-mid-32-16";
  const jobId = process.env.JOB_ID ?? `job_${Date.now()}`;
  const targetColumn = process.env.TARGET_COLUMN;
  const maxSamples = parseInt(process.env.MAX_TRAIN_SAMPLES ?? "2", 10);

  if (!csvPath) {
    throw new Error("DATA_CSV_PATH required");
  }

  const arch = getArchitectureById(archId);
  const result = preprocessTabularCsv({
    csvPath,
    architecture: arch,
    targetColumn: targetColumn || undefined,
    maxSamples,
    jobId,
  });

  console.log(
    JSON.stringify({
      ok: true,
      metadataPath: result.metadataPath,
      outputCsvPath: result.outputCsvPath,
      inputDim: result.inputDim,
      numClasses: result.numClasses,
      taskType: result.taskType,
      targetColumn: result.targetColumn,
      featureColumns: result.featureColumns,
      dataHash: result.dataHash,
      sampleCount: result.train.length,
    })
  );
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err.message ?? err) }));
  process.exit(1);
});
