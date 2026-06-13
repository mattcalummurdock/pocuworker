import { writeFileSync, mkdirSync } from "fs";
import { ARCHITECTURE_TEMPLATES } from "../src/cpu/models/architectures";

const out = ARCHITECTURE_TEMPLATES.map((a) => ({
  id: a.id,
  name: a.name,
  tier: a.tier,
  description: a.description,
  layers: a.layers,
  optimizer: a.optimizer,
  loss: a.loss,
  taskType: a.taskType,
  maxInputDim: a.maxInputDim,
  maxNumClasses: a.maxNumClasses,
}));

mkdirSync("agent", { recursive: true });
writeFileSync("agent/architectures.json", JSON.stringify(out, null, 2));
console.log(`Exported ${out.length} architectures to agent/architectures.json`);
