import { createHash } from "crypto";
import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { floatToFixed } from "./fixed-point";
import { TabularSample } from "./types";
import {
  ArchitectureTemplate,
  validateArchitectureForData,
} from "./cpu/models/architectures";

const DEFAULT_TARGET_HINTS = [
  "label",
  "target",
  "class",
  "Class",
  "fraud",
  "is_fraud",
  "outcome",
  "Outcome",
  "y",
  "diagnosis",
];

export interface TabularPreprocessResult {
  train: TabularSample[];
  dataHash: string;
  targetColumn: string;
  featureColumns: string[];
  inputDim: number;
  numClasses: number;
  taskType: "classification" | "regression";
  outputCsvPath: string;
  metadataPath: string;
}

export interface TabularPreprocessOptions {
  csvPath: string;
  architecture: ArchitectureTemplate;
  targetColumn?: string;
  targetHints?: string[];
  maxSamples?: number;
  outputDir?: string;
  jobId?: string;
}

function detectTargetColumn(
  columns: string[],
  hints: string[]
): string | null {
  const lower = new Map(columns.map((c) => [c.toLowerCase(), c]));
  for (const h of hints) {
    const hit = lower.get(h.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

function pearson(x: number[], y: number[]): number {
  const n = x.length;
  if (n === 0) return 0;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    const a = x[i] - mx;
    const b = y[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den > 0 ? num / den : 0;
}

export function preprocessTabularCsv(
  options: TabularPreprocessOptions
): TabularPreprocessResult {
  const content = readFileSync(options.csvPath, "utf-8");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    cast: false,
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new Error("CSV is empty");
  }

  const columns = Object.keys(records[0]);
  const hints = [...(options.targetHints ?? []), ...DEFAULT_TARGET_HINTS];
  let targetColumn = options.targetColumn;
  if (!targetColumn || !columns.includes(targetColumn)) {
    targetColumn = detectTargetColumn(columns, hints) ?? columns[columns.length - 1];
  }
  if (!columns.includes(targetColumn)) {
    throw new Error(`Target column not found: ${targetColumn}`);
  }

  const numericCols = columns.filter((c) => {
    if (c === targetColumn) return false;
    const vals = records.slice(0, Math.min(50, records.length)).map((r) => Number(r[c]));
    return vals.every((v) => Number.isFinite(v));
  });

  const rawTarget = records.map((r) => r[targetColumn]);
  const targetNumeric = rawTarget.map((v) => Number(v));
  const allNumericTarget = targetNumeric.every((v) => Number.isFinite(v));

  let labelMap: Map<string, number> | null = null;
  let taskType: "classification" | "regression";
  let numClasses: number;

  if (allNumericTarget) {
    const unique = [...new Set(targetNumeric)];
    if (unique.length <= 10 && unique.every((u) => Number.isInteger(u))) {
      taskType = "classification";
      const sorted = [...unique].sort((a, b) => a - b);
      labelMap = new Map(sorted.map((v, i) => [String(v), i]));
      numClasses = sorted.length === 2 ? 1 : sorted.length;
    } else {
      taskType = "regression";
      numClasses = 1;
    }
  } else {
    taskType = "classification";
    const unique = [...new Set(rawTarget.map(String))];
    labelMap = new Map(unique.map((v, i) => [v, i]));
    numClasses = unique.length === 2 ? 1 : unique.length;
  }

  validateArchitectureForData(options.architecture, numClasses, taskType);

  const maxFeatures = options.architecture.maxInputDim;
  const targetForCorr = records.map((r) => {
    const raw = r[targetColumn!];
    if (labelMap) {
      const n = Number(raw);
      if (Number.isFinite(n) && labelMap.has(String(n))) return labelMap.get(String(n))!;
      return labelMap.get(String(raw)) ?? 0;
    }
    return Number(raw);
  });

  const scored = numericCols.map((col) => ({
    col,
    score: Math.abs(
      pearson(
        records.map((r) => Number(r[col])),
        targetForCorr
      )
    ),
  }));
  scored.sort((a, b) => b.score - a.score);
  const featureColumns = scored.slice(0, maxFeatures).map((s) => s.col);
  if (featureColumns.length === 0) {
    throw new Error("No numeric feature columns found");
  }

  const inputDim = featureColumns.length;
  const maxSamples = options.maxSamples ?? records.length;
  const slice = records.slice(0, maxSamples);

  const processed: TabularSample[] = slice.map((row) => {
    const features = featureColumns.map((col) => {
      const vals = slice.map((r) => Number(r[col]));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std =
        Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length) || 1;
      const norm = Math.max(-1, Math.min(1, (Number(row[col]) - mean) / std));
      return floatToFixed(norm);
    });

    let labels: bigint[];
    if (taskType === "regression") {
      const t = Number(row[targetColumn!]);
      const vals = slice.map((r) => Number(r[targetColumn!]));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std =
        Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length) || 1;
      const norm = Math.max(-1, Math.min(1, (t - mean) / std));
      labels = [floatToFixed(norm)];
    } else if (numClasses === 1) {
      const raw = row[targetColumn!];
      const n = Number(raw);
      const label =
        labelMap!.has(String(n)) && Number.isFinite(n)
          ? labelMap!.get(String(n))!
          : labelMap!.get(String(raw))!;
      labels = [floatToFixed(label === 1 ? 1 : 0)];
    } else {
      const raw = row[targetColumn!];
      const n = Number(raw);
      const idx =
        labelMap!.has(String(n)) && Number.isFinite(n)
          ? labelMap!.get(String(n))!
          : labelMap!.get(String(raw))!;
      const oneHot = Array(numClasses).fill(0);
      oneHot[idx!] = 1;
      labels = oneHot.map((v) => floatToFixed(v));
    }

    return { features, labels };
  });

  const dataHash = createHash("sha256")
    .update(
      JSON.stringify(
        processed.map((s) => ({
          f: s.features.map(String),
          l: s.labels.map(String),
        }))
      )
    )
    .digest("hex");

  const jobId = options.jobId ?? `job_${Date.now()}`;
  const outputDir = options.outputDir ?? "data";
  mkdirSync(outputDir, { recursive: true });
  const outputCsvPath = `${outputDir}/${jobId}_prepared.csv`;
  const metadataPath = `${outputDir}/${jobId}_meta.json`;

  const csvLines = [
    [...featureColumns, targetColumn].join(","),
    ...slice.map((row) =>
      [...featureColumns.map((c) => row[c]), row[targetColumn!]].join(",")
    ),
  ];
  writeFileSync(outputCsvPath, csvLines.join("\n"));

  const metadata = {
    jobId,
    sourceCsv: options.csvPath,
    outputCsvPath,
    targetColumn,
    featureColumns,
    inputDim,
    numClasses,
    taskType,
    sampleCount: processed.length,
    dataHash,
  };
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return {
    train: processed,
    dataHash,
    targetColumn,
    featureColumns,
    inputDim,
    numClasses,
    taskType,
    outputCsvPath,
    metadataPath,
  };
}

export function loadPreparedSamples(metaPath: string): {
  samples: TabularSample[];
  meta: Record<string, unknown>;
} {
  const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
  const metaDir = dirname(metaPath);
  const jobId = String(meta.jobId ?? "");
  const csvPath = String(meta.outputCsvPath ?? "").trim();

  const candidates = [
    csvPath,
    join(metaDir, "prepared.csv"),
    jobId ? join(metaDir, `${jobId}_prepared.csv`) : "",
  ].filter(Boolean);

  const preparedPath = candidates.find((p) => existsSync(p));
  if (!preparedPath) {
    throw new Error(
      `Prepared CSV not found for ${metaPath}. Tried: ${candidates.join(", ")}`
    );
  }

  const content = readFileSync(preparedPath, "utf-8");
  const records = parse(content, { columns: true, skip_empty_lines: true }) as Record<
    string,
    string
  >[];
  const featureColumns = meta.featureColumns as string[];
  const targetColumn = String(meta.targetColumn);
  const numClasses = Number(meta.numClasses);
  const taskType = meta.taskType as "classification" | "regression";

  const samples: TabularSample[] = records.map((row) => {
    const features = featureColumns.map((col) => {
      const vals = records.map((r) => Number(r[col]));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std =
        Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length) || 1;
      const norm = Math.max(-1, Math.min(1, (Number(row[col]) - mean) / std));
      return floatToFixed(norm);
    });
    let labels: bigint[];
    if (taskType === "regression") {
      const t = Number(row[targetColumn]);
      const vals = records.map((r) => Number(r[targetColumn]));
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const std =
        Math.sqrt(vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length) || 1;
      labels = [floatToFixed(Math.max(-1, Math.min(1, (t - mean) / std)))];
    } else if (numClasses === 1) {
      labels = [floatToFixed(Number(row[targetColumn]) ? 1 : 0)];
    } else {
      const idx = Number(row[targetColumn]);
      const oneHot = Array(numClasses).fill(0);
      oneHot[idx] = 1;
      labels = oneHot.map((v) => floatToFixed(v));
    }
    return { features, labels };
  });

  return { samples, meta };
}
