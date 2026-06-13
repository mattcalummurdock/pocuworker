import {
  ContractExecuteTransaction,
  ContractId,
  EthereumTransaction,
  FileCreateTransaction,
  Hbar,
} from "@hashgraph/sdk";
import { ContractTransactionReceipt, Signer, Wallet } from "ethers";
import {
  evmTxHashFromHederaRecord,
  getHederaSdkClient,
  hexToBytes,
  isHederaNetwork,
} from "./hedera-client";
import { HEDERA_CALLDATA_LIMIT, SAFE_CALLDATA_LIMIT } from "./cpu/calldata";
import { waitForContractReceipt } from "./tx-utils";

const DEFAULT_GAS_PRICE = 1_200_000_000_000n;
const DEFAULT_MAX_GAS_HBAR = 50;
/** HAPI wrapper fee for jumbo EthereumTransaction (separate from EVM gas). */
const JUMBO_MAX_TX_FEE_HBAR = 50;

function jumboEthereumTx(ethereumData: Uint8Array): EthereumTransaction {
  return new EthereumTransaction()
    .setEthereumData(ethereumData)
    .setMaxGasAllowanceHbar(new Hbar(DEFAULT_MAX_GAS_HBAR))
    .setMaxTransactionFee(new Hbar(JUMBO_MAX_TX_FEE_HBAR));
}

/**
 * Execute contract via Hedera SDK (bypasses JSON-RPC 128KB callData cap).
 * Uses HAPI ContractExecuteTransaction with inline function parameters.
 */
export async function executeViaHederaSdk(
  signer: Signer,
  contractAddress: string,
  calldataHex: string,
  gasLimit: bigint
): Promise<ContractTransactionReceipt> {
  const client = getHederaSdkClient();
  const contractId = ContractId.fromEvmAddress(0, 0, contractAddress);
  const params = hexToBytes(calldataHex);

  const tx = await new ContractExecuteTransaction()
    .setContractId(contractId)
    .setGas(Number(gasLimit))
    .setFunctionParameters(params)
    .setMaxTransactionFee(new Hbar(20))
    .execute(client);

  const record = await tx.getRecord(client);
  const hash = evmTxHashFromHederaRecord(record);
  const provider = signer.provider;
  if (!provider) throw new Error("Signer has no provider");
  return waitForContractReceipt(provider, hash);
}

/** HIP-1086 jumbo EthereumTransaction — up to 128KB callData in one HAPI TX. */
export async function executeViaJumboEthereum(
  signer: Signer,
  to: string,
  calldataHex: string,
  gasLimit: bigint
): Promise<ContractTransactionReceipt> {
  const client = getHederaSdkClient();
  const provider = signer.provider;
  if (!provider) throw new Error("Signer has no provider");

  const rawKey = process.env.HEX_ENCODED_PRIVATE_KEY;
  if (!rawKey) throw new Error("HEX_ENCODED_PRIVATE_KEY required for jumbo Ethereum TX");

  const wallet = new Wallet(rawKey, provider);
  const network = await provider.getNetwork();
  const nonce = await wallet.getNonce();
  const gasPrice = DEFAULT_GAS_PRICE;

  const signed = await wallet.signTransaction({
    to,
    data: calldataHex,
    gasLimit,
    gasPrice,
    nonce,
    chainId: network.chainId,
    type: 0,
    value: 0n,
  });

  const ethereumData = hexToBytes(signed);
  const response = await jumboEthereumTx(ethereumData).execute(client);

  const record = await response.getRecord(client);
  const hash = evmTxHashFromHederaRecord(record, signed);
  return waitForContractReceipt(provider, hash);
}

/** Upload bytes to Hedera File Service (hex-encoded payload per HIP-410). */
export async function uploadBytesToHfs(data: Uint8Array): Promise<string> {
  const client = getHederaSdkClient();
  const hexBody = Buffer.from(data).toString("hex");
  const tx = await new FileCreateTransaction()
    .setContents(hexBody)
    .setMaxTransactionFee(new Hbar(5))
    .execute(client);
  const receipt = await tx.getReceipt(client);
  const fileId = receipt.fileId;
  if (!fileId) throw new Error("HFS FileCreate did not return fileId");
  return fileId.toString();
}

/**
 * Oversized callData via HFS + EthereumTransaction.callDataFileId.
 * Execution loads calldata from HFS; signature uses zero-length data placeholder in RLP.
 */
export async function executeViaHfsCalldata(
  signer: Signer,
  to: string,
  calldataHex: string,
  gasLimit: bigint
): Promise<ContractTransactionReceipt> {
  const client = getHederaSdkClient();
  const provider = signer.provider;
  if (!provider) throw new Error("Signer has no provider");

  const rawKey = process.env.HEX_ENCODED_PRIVATE_KEY;
  if (!rawKey) throw new Error("HEX_ENCODED_PRIVATE_KEY required for HFS calldata TX");

  const calldataBytes = hexToBytes(calldataHex);
  const fileId = await uploadBytesToHfs(calldataBytes);

  const wallet = new Wallet(rawKey, provider);
  const network = await provider.getNetwork();
  const nonce = await wallet.getNonce();
  const gasPrice = DEFAULT_GAS_PRICE;

  const signed = await wallet.signTransaction({
    to,
    data: "0x",
    gasLimit,
    gasPrice,
    nonce,
    chainId: network.chainId,
    type: 0,
    value: 0n,
  });

  const { FileId } = await import("@hashgraph/sdk");
  const response = await jumboEthereumTx(hexToBytes(signed))
    .setCallDataFileId(FileId.fromString(fileId))
    .execute(client);

  const record = await response.getRecord(client);
  const hash = evmTxHashFromHederaRecord(record, signed);
  return waitForContractReceipt(provider, hash);
}

export function calldataByteLength(hexData: string): number {
  const h = hexData.startsWith("0x") ? hexData.slice(2) : hexData;
  return h.length / 2;
}

export function useJumboEthereum(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CPU_JUMBO_ETH ?? "1") !== "0";
}

export function useHfsCalldata(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.CPU_HFS_CALLDATA === "1";
}

export function shouldUseHederaSdk(
  chainId: bigint | number | undefined,
  calldataHex: string
): boolean {
  if (!isHederaNetwork(chainId)) return false;
  if (useJumboEthereum() && calldataByteLength(calldataHex) <= HEDERA_CALLDATA_LIMIT) {
    return false;
  }
  return calldataByteLength(calldataHex) > SAFE_CALLDATA_LIMIT;
}

export function shouldUseHfsCalldata(
  chainId: bigint | number | undefined,
  calldataHex: string
): boolean {
  return (
    isHederaNetwork(chainId) &&
    useHfsCalldata() &&
    calldataByteLength(calldataHex) > HEDERA_CALLDATA_LIMIT
  );
}

/**
 * Jumbo EthereumTransaction only when RPC calldata cap is exceeded.
 * Normal packed batches (few–50KB) should use eth_sendTransaction — cheaper and no HAPI wrapper fee.
 */
export function shouldUseJumboEthereum(
  chainId: bigint | number | undefined,
  calldataHex: string
): boolean {
  const len = calldataByteLength(calldataHex);
  return (
    isHederaNetwork(chainId) &&
    useJumboEthereum() &&
    len > SAFE_CALLDATA_LIMIT &&
    len <= HEDERA_CALLDATA_LIMIT
  );
}
