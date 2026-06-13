import { ethers } from "hardhat";
import { Contract, ContractTransactionReceipt } from "ethers";
import { hydrateSingleReceipt } from "../../src/cpu/hydrate";

export const SCALE = 65536n;

export function tensorId(name: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

export interface TensorRecord {
  jobId: string;
  tensorId: string;
  shape: number[];
  data: bigint[];
  hcsSeq: number;
  messageHash: string;
}

export async function deployCpuFixture() {
  const [deployer] = await ethers.getSigners();
  const TXHarvester = await ethers.getContractFactory("TXHarvester");
  const harvester = await TXHarvester.deploy(6);

  const CpuJobRegistry = await ethers.getContractFactory("CpuJobRegistry");
  const jobRegistry = await CpuJobRegistry.deploy();
  const jobRegistryAddr = await jobRegistry.getAddress();
  await jobRegistry.setDispatcher(deployer.address);

  const LinearAlgebraCore = await ethers.getContractFactory("LinearAlgebraCore");
  const linear = await LinearAlgebraCore.deploy(jobRegistryAddr, await harvester.getAddress());

  const ActivationCore = await ethers.getContractFactory("ActivationCore");
  const activation = await ActivationCore.deploy(jobRegistryAddr);

  const GradientCore = await ethers.getContractFactory("GradientCore");
  const gradient = await GradientCore.deploy(jobRegistryAddr);

  const OptimizerCore = await ethers.getContractFactory("OptimizerCore");
  const optimizer = await OptimizerCore.deploy(jobRegistryAddr);

  const AggregationCore = await ethers.getContractFactory("AggregationCore");
  const aggregation = await AggregationCore.deploy(jobRegistryAddr);

  const CpuBatchExecutor = await ethers.getContractFactory("CpuBatchExecutor");
  const batchExecutor = await CpuBatchExecutor.deploy(jobRegistryAddr);

  const hashes = Array.from({ length: 64 }, (_, i) =>
    ethers.keccak256(ethers.toUtf8Bytes(`harvest-${i}`))
  );
  await harvester.harvestAll(hashes);

  return {
    deployer,
    harvester,
    jobRegistry,
    linear,
    activation,
    gradient,
    optimizer,
    aggregation,
    batchExecutor,
    cores: {
      linear: await linear.getAddress(),
      activation: await activation.getAddress(),
      gradient: await gradient.getAddress(),
      optimizer: await optimizer.getAddress(),
      aggregation: await aggregation.getAddress(),
    },
    cpuBatchExecutor: await batchExecutor.getAddress(),
  };
}

export async function executeOp(
  core: Contract,
  params: {
    jobId: string;
    opcode: number;
    inShape: number[];
    inData: bigint[];
    outShape: number[];
    outTensorId: string;
    opParams?: bigint[];
  }
): Promise<TensorRecord[]> {
  const [signer] = await ethers.getSigners();
  const tx = await core.execute(
    params.jobId,
    1,
    ethers.id(`hcs-${params.opcode}`),
    params.outTensorId,
    params.opcode,
    params.inShape,
    params.inData,
    params.outShape,
    params.opParams ?? []
  );
  const receipt = await tx.wait();
  const { TensorStore } = await import("../../src/cpu/tensor-store");
  const store = new TensorStore();
  const record = await hydrateSingleReceipt(
    store,
    receipt!,
    await core.getAddress(),
    params.opcode,
    params.inShape,
    params.inData,
    params.outShape,
    params.opParams ?? [],
    params.outTensorId,
    signer,
    { pinIpfs: false }
  );
  return record ? [record] : [];
}
