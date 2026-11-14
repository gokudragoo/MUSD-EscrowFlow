/**
 * Script-side transaction helpers for Mezo testnet.
 * - Secrets are read at runtime from files OUTSIDE the repo and never printed.
 * - Every tx is signed locally with an explicit gas limit and an explicit `pending` nonce,
 *   then broadcast raw, so "already known" retries still know the tx hash.
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  type Abi,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  encodeFunctionData,
  BaseError,
  ContractFunctionRevertedError,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "../../src/config/chains";
import { isRetryableTxError, withGasBuffer } from "../../src/lib/gas";

export const DEFAULT_DEPLOYER_ENV_FILE = "C:\\Users\\nikku\\Desktop\\.env.txt";
/** Throwaway testnet wallets (client / freelancer / stranger), kept outside the repo in a stable folder. */
export const DEFAULT_TEST_WALLETS_FILE = "C:\\Users\\nikku\\.escrowflow\\test-wallets.json";

function normalizeKey(raw: string): Hex {
  const k = raw.trim().replace(/^['"]|['"]$/g, "");
  const hex = (k.startsWith("0x") ? k : `0x${k}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) throw new Error("Key file does not contain a valid 32-byte hex key");
  return hex;
}

/** Reads PRIVATE_KEY=... from the owner's env file at runtime. Never logs it. */
export function loadDeployerAccount(): Account {
  const file = process.env.DEPLOYER_ENV_FILE ?? DEFAULT_DEPLOYER_ENV_FILE;
  const text = readFileSync(file, "utf8");
  const line = text.split(/\r?\n/).find((l) => /^\s*PRIVATE_KEY\s*=/.test(l));
  if (!line) throw new Error(`PRIVATE_KEY not found in ${file}`);
  return privateKeyToAccount(normalizeKey(line.split("=").slice(1).join("=")));
}

export interface TestWallet {
  role: string;
  address: Address;
  account: Account;
}

/** Loads this app's throwaway testnet wallets (escrowflow.client / freelancer / stranger). */
export function loadTestWallets(app = "escrowflow"): Record<string, TestWallet> {
  const file = process.env.TEST_WALLETS_FILE ?? DEFAULT_TEST_WALLETS_FILE;
  const json = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    { role: string; address: string; privateKey: string }[]
  >;
  const list = json[app];
  if (!list) throw new Error(`No wallets for ${app}`);
  const out: Record<string, TestWallet> = {};
  for (const w of list) {
    const account = privateKeyToAccount(normalizeKey(w.privateKey));
    if (account.address.toLowerCase() !== w.address.toLowerCase()) throw new Error(`Key/address mismatch for ${w.role}`);
    out[w.role] = { role: w.role, address: account.address, account };
  }
  return out;
}

export const publicClient = createPublicClient({
  chain: mezoTestnet,
  transport: http(process.env.MEZO_RPC_URL ?? mezoTestnet.rpcUrls.default.http[0], { retryCount: 3, timeout: 30_000 }),
}) as PublicClient;

export function walletFor(account: Account) {
  return createWalletClient({
    account,
    chain: mezoTestnet,
    transport: http(process.env.MEZO_RPC_URL ?? mezoTestnet.rpcUrls.default.http[0], { retryCount: 2, timeout: 30_000 }),
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function revertName(err: unknown): string | undefined {
  if (err instanceof BaseError) {
    const reverted = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      return reverted.data?.errorName ?? reverted.reason ?? reverted.shortMessage;
    }
    return err.shortMessage;
  }
  return err instanceof Error ? err.message : String(err);
}

export interface SendOptions {
  account: Account;
  to?: Address;
  data: Hex;
  gasFloor: bigint;
  label: string;
  /** Broadcast without estimating (used to record an intentionally reverting tx on-chain). */
  skipEstimate?: boolean;
  /** Native BTC to send (gas top-ups, payable calls such as openTrove). */
  value?: bigint;
}

/** Sign + broadcast with explicit gas/nonce, retrying transient and nonce errors (max 5). */
export async function sendRaw(opts: SendOptions): Promise<{ hash: Hex; receipt: TransactionReceipt }> {
  const wallet = walletFor(opts.account);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      let estimate: bigint | null = null;
      if (!opts.skipEstimate) try {
        estimate = await publicClient.estimateGas({ account: opts.account, to: opts.to, data: opts.data, value: opts.value });
      } catch (e) {
        // Estimation failure on a deploy/contract call: surface reverts, otherwise fall back to floor.
        const msg = e instanceof Error ? e.message : String(e);
        if (/revert/i.test(msg)) throw e;
      }
      const gas = withGasBuffer(estimate, opts.gasFloor);
      const [nonce, gasPrice] = await Promise.all([
        publicClient.getTransactionCount({ address: opts.account.address, blockTag: "pending" }),
        publicClient.getGasPrice(),
      ]);
      const request = await wallet.prepareTransactionRequest({
        account: opts.account,
        chain: mezoTestnet,
        to: opts.to,
        data: opts.data,
        value: opts.value,
        gas,
        nonce,
        gasPrice: gasPrice * 2n,
        type: "legacy",
      });
      const serialized = await wallet.signTransaction(request as never);
      const hash = keccak256(serialized);
      try {
        await publicClient.sendRawTransaction({ serializedTransaction: serialized });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/already known/i.test(msg)) throw e;
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000, pollingInterval: 2_000 });
      return { hash, receipt };
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!isRetryableTxError(msg) || attempt === 5) break;
      const wait = 1500 * attempt;
      console.warn(`  [${opts.label}] transient error (attempt ${attempt}): ${msg.split("\n")[0]} — retrying in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export async function writeContract(args: {
  account: Account;
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  gasFloor: bigint;
  label?: string;
}) {
  // Simulate first so reverts surface with their custom error name.
  await publicClient.simulateContract({
    account: args.account,
    address: args.address,
    abi: args.abi,
    functionName: args.functionName,
    args: args.args,
  } as never);
  const data = encodeFunctionData({ abi: args.abi, functionName: args.functionName, args: args.args } as never);
  return sendRaw({
    account: args.account,
    to: args.address,
    data,
    gasFloor: args.gasFloor,
    label: args.label ?? args.functionName,
  });
}
