import type { ReactNode } from "react";

export interface Architecture {
  id: string;
  name: string;
  tier: string;
  description: string;
  taskType: string;
  maxInputDim: number;
}

export interface KaggleDataset {
  ref: string;
  title: string;
  vote_count?: number;
  download_count?: number;
  usability_rating?: number;
  total_bytes?: number;
}

export interface JobInfo {
  job_id: string;
  status?: string;
  message?: string;
  manifest_path?: string;
}

export interface ChatBlock {
  role: "user" | "assistant";
  text?: string;
  dataset?: KaggleDataset;
  datasets?: KaggleDataset[];
  job?: JobInfo;
}

export interface ChatThread {
  id: string;
  title: string | null;
  use_case?: string | null;
  architecture_id?: string | null;
  created_at: string;
}

export const USE_CASE_CHIPS = [
  "Fraud detection",
  "Heart disease screening",
  "Customer churn",
  "Credit default risk",
  "Diabetes prediction",
  "Spam detection",
  "Demand forecasting",
  "Predictive maintenance",
] as const;

export function formatBytes(bytes?: number): string {
  if (!bytes) return "—";
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

export type DatasetActions = ReactNode;
