export interface ClassificationMetrics {
  auc: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  threshold: number;
}

export function computeAUC(labels: number[], scores: number[]): number {
  const pairs = labels.map((l, i) => ({ l, s: scores[i] }));
  pairs.sort((a, b) => b.s - a.s);
  let tp = 0;
  let fp = 0;
  const totalPos = labels.filter((l) => l === 1).length;
  const totalNeg = labels.length - totalPos;
  if (totalPos === 0 || totalNeg === 0) return 0.5;

  let auc = 0;
  let prevTp = 0;
  let prevFp = 0;
  for (const p of pairs) {
    if (p.l === 1) tp++;
    else fp++;
    auc += ((fp - prevFp) * (tp + prevTp)) / 2;
    prevTp = tp;
    prevFp = fp;
  }
  return auc / (totalPos * totalNeg);
}

export function computeClassificationMetrics(
  labels: number[],
  scores: number[],
  threshold = 0.5
): ClassificationMetrics {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (let i = 0; i < labels.length; i++) {
    const pred = scores[i] >= threshold ? 1 : 0;
    if (pred === 1 && labels[i] === 1) tp++;
    else if (pred === 1 && labels[i] === 0) fp++;
    else if (pred === 0 && labels[i] === 0) tn++;
    else fn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const accuracy = (tp + tn) / labels.length;
  const auc = computeAUC(labels, scores);
  return { auc, precision, recall, f1, accuracy, threshold };
}

/** Scan unique score cutoffs and return the threshold that maximizes F1. */
export function bestF1Threshold(labels: number[], scores: number[]): ClassificationMetrics {
  const candidates = [...new Set(scores)].sort((a, b) => a - b);
  if (candidates.length === 0) {
    return computeClassificationMetrics(labels, scores, 0.5);
  }

  let best = computeClassificationMetrics(labels, scores, candidates[0]);
  for (const t of candidates) {
    const m = computeClassificationMetrics(labels, scores, t);
    if (m.f1 > best.f1) best = m;
  }
  return best;
}
