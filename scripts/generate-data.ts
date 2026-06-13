import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

function generateFraudCsv(path: string, rows = 600): void {
  mkdirSync(dirname(path), { recursive: true });
  const header = "amount,merchant_category,hour,location_delta,velocity,is_weekend,is_fraud\n";
  const lines: string[] = [header];

  for (let i = 0; i < rows; i++) {
    const isFraud = Math.random() < 0.02 ? 1 : 0;
    const amount = isFraud
      ? 200 + Math.random() * 800
      : 10 + Math.random() * 150;
    const merchant = Math.floor(Math.random() * 8);
    const hour = Math.floor(Math.random() * 24);
    const locationDelta = isFraud
      ? 2 + Math.random() * 8
      : Math.random() * 2;
    const velocity = isFraud
      ? 3 + Math.random() * 5
      : Math.random() * 2;
    const isWeekend = Math.random() < 0.28 ? 1 : 0;

    lines.push(
      `${amount.toFixed(2)},${merchant},${hour},${locationDelta.toFixed(3)},${velocity.toFixed(3)},${isWeekend},${isFraud}\n`
    );
  }

  writeFileSync(path, lines.join(""));
  console.log(`Generated ${rows} rows at ${path}`);
}

generateFraudCsv("data/fraud_sample.csv");
