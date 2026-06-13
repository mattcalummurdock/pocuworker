import { config as loadEnv } from "dotenv";
loadEnv();

import { existsSync, readFileSync } from "fs";
import { ethers } from "hardhat";
import { preprocessFraudData, loadFraudCsv } from "../src/preprocess";
import { loadPreparedSamples } from "../src/preprocess-tabular";
import { StepLogger } from "../src/logger";
import { runCpuTraining, loadDeployment } from "../src/cpu/runner";
import {
  architectureToSpec,
  getArchitectureById,
} from "../src/cpu/models/architectures";
import { resolveEngineParams } from "../src/config";
import { TabularSample } from "../src/types";

const MAX_SAMPLES = parseInt(process.env.MAX_TRAIN_SAMPLES ?? "2", 10);
const TRAIN_EPOCHS = parseInt(process.env.TRAIN_EPOCHS ?? "1", 10);

async function main() {
  if (process.env.PINATA_JWT && process.env.CPU_IPFS_MODE !== "0") {
    process.env.CPU_IPFS_MODE = "1";
  }
  const log = new StepLogger("[OnChainCPU] ");
  const { resolveIpfsPinScope, isPinataEnabled } = await import("../src/ipfs/pinata");
  const ipfsOn = isPinataEnabled();
  const pinScope = resolveIpfsPinScope();
  const hcsAudit = (process.env.CPU_HCS_BATCH_AUDIT ?? "1") !== "0";
  log.info(
    `IPFS: ${ipfsOn ? `on (scope=${pinScope}${pinScope === "final" ? ", manifest only" : pinScope === "all" ? ", every tensor" : ""})` : "off"}`
  );
  log.info(`HCS batch audit: ${hcsAudit ? "on" : "off (saves ~1 msg/TX)"}`);
  const packed = (process.env.CPU_BATCH_PACKED ?? "1") !== "0";
  const batchIpfs = process.env.CPU_BATCH_VIA_IPFS === "1";
  const jumboEth = (process.env.CPU_JUMBO_ETH ?? "1") !== "0";
  const pollMs = process.env.TX_RECEIPT_POLL_MS ?? "750";
  log.info(`Phase C packed calldata: ${packed ? "on" : "off"} | batch IPFS: ${batchIpfs ? "on" : "off"}`);
  log.info(
    `Jumbo Ethereum TX: ${jumboEth ? "on (>120KB calldata only)" : "off"} | receipt poll: ${pollMs}ms`
  );

  const deployment = loadDeployment();
  const [signer] = await ethers.getSigners();

  log.section("On-Chain CPU Training (cpuarc)");
  log.info(`Signer: ${signer.address}`);
  const balanceBefore = await ethers.provider.getBalance(signer.address);
  log.info(`HBAR balance before: ${ethers.formatEther(balanceBefore)}`);

  let samples: TabularSample[];
  let dataHash: string;
  let spec;

  const archId = process.env.ARCHITECTURE_ID ?? "arch-mid-32-16";
  const arch = getArchitectureById(archId);
  log.info(`Architecture: ${arch.id} (${arch.name})`);

  const metaPath = process.env.PREPARED_META_PATH;
  if (metaPath && existsSync(metaPath)) {
    const prepared = loadPreparedSamples(metaPath);
    samples = prepared.samples.slice(0, MAX_SAMPLES);
    dataHash = String(prepared.meta.dataHash);
    const inputDim = Number(prepared.meta.inputDim);
    const numClasses = Number(prepared.meta.numClasses);
    process.env.INPUT_DIM = String(inputDim);
    process.env.NUM_CLASSES = String(numClasses);
    spec = architectureToSpec(arch, inputDim, numClasses, TRAIN_EPOCHS);
    log.info(
      `Prepared data: ${samples.length} samples | inputDim=${inputDim} | numClasses=${numClasses}`
    );
  } else if (process.env.INPUT_DIM && process.env.NUM_CLASSES) {
    const inputDim = parseInt(process.env.INPUT_DIM, 10);
    const numClasses = parseInt(process.env.NUM_CLASSES, 10);
    spec = architectureToSpec(arch, inputDim, numClasses, TRAIN_EPOCHS);
    const rows = loadFraudCsv(process.env.DATA_CSV_PATH ?? "data/fraud_sample.csv");
    const prepped = preprocessFraudData(rows);
    samples = prepped.train.slice(0, MAX_SAMPLES);
    dataHash = prepped.dataHash;
  } else {
    const engine = resolveEngineParams();
    spec = architectureToSpec(arch, engine.inputDim, engine.numClasses, TRAIN_EPOCHS);
    const rows = loadFraudCsv("data/fraud_sample.csv");
    const { train, dataHash: dh } = preprocessFraudData(rows);
    samples = train.slice(0, MAX_SAMPLES);
    dataHash = dh;
  }

  log.info(`Training ${samples.length} samples | dataHash: 0x${dataHash}`);

  const result = await runCpuTraining({
    deployment,
    signer,
    samples,
    dataHash,
    spec,
    log,
  });

  log.section("COMPLETE");
  log.info(`Job ID: ${result.jobId}`);
  log.info(`HCS topic: ${result.hcsTopicId}`);
  log.info(`Program hash: ${result.programHash}`);
  log.info(`Event log hash: ${result.eventLogHash}`);
  log.info(`Manifest: ${result.manifestPath}`);
  log.info(`Ledger TXs: ${result.txHashes.length}`);
  const balanceAfter = await ethers.provider.getBalance(signer.address);
  const spent = balanceBefore - balanceAfter;
  log.info(`HBAR spent (wallet delta): ${ethers.formatEther(spent)}`);
  log.summary();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
