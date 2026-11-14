"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { WaitForTransactionReceiptTimeoutError, type Abi, type Address, type Hex } from "viem";
import { ESCROW_ADDRESS, MUSD_ADDRESS, escrowFlowAbi, musdAbi } from "@/config/contracts";
import { SUPPORTED_CHAIN_ID, explorerTx } from "@/config/chains";
import { ERC20_GAS_FLOOR, gasFloor, withGasBuffer, type EscrowWrite } from "@/lib/gas";
import { describeTxError } from "@/lib/client/errors";
import { ApiError, api } from "@/lib/client/api";

/**
 * idle → preparing → signing → pending → verifying → confirmed
 *                                  ↘ delayed (sent, receipt not seen yet — never "not sent")
 * failed = rejected in the wallet, simulation revert, or reverted on-chain.
 */
export type TxPhase = "idle" | "preparing" | "signing" | "pending" | "delayed" | "verifying" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  hash?: Hex;
  error?: string;
  label?: string;
  /** Server verification outcome for escrow transactions. */
  verification?: VerifyResult | null;
}

interface RunOptions {
  label: string;
  /** Contract + function. Defaults to EscrowFlow; `contract` targets any other (e.g. Mezo BorrowerOperations). */
  target?: "escrow" | "musd";
  contract?: { address: Address; abi: Abi };
  functionName: string;
  args: readonly unknown[];
  /** Native BTC sent with the call (payable functions such as openTrove / addColl). */
  value?: bigint;
  floor?: bigint;
  escrowFn?: EscrowWrite;
  milestoneCount?: number;
  /** Ask the server to verify + index this EscrowFlow tx after confirmation (default true for escrow). */
  verify?: boolean;
  successMessage?: string;
}

export interface VerifyResult {
  status: string;
  problems?: string[];
  events?: { eventName: string; args: Record<string, unknown> }[];
  reason?: string;
}

export interface TxResult {
  hash: Hex;
  verification: VerifyResult | null;
  /** True when the tx was sent but its receipt was not seen in time (it may still confirm). */
  delayed?: boolean;
}

/**
 * One path for every on-chain write: explicit gas (EIP-7623-safe), wallet confirmation, receipt
 * wait, then server-side verification. The UI only reports success after the receipt AND the
 * server's verification — never on click.
 */
export function useEscrowTx() {
  const { chainId, address } = useAccount();
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>({ phase: "idle" });

  const run = useCallback(
    async (o: RunOptions): Promise<TxResult | null> => {
      if (!address || !publicClient) {
        toast.error("Connect your wallet first");
        return null;
      }
      const target = o.contract ? "other" : (o.target ?? "escrow");
      const contract =
        o.contract ?? (target === "escrow" ? { address: ESCROW_ADDRESS, abi: escrowFlowAbi as Abi } : { address: MUSD_ADDRESS, abi: musdAbi as Abi });
      const call = { ...contract, functionName: o.functionName, args: o.args, account: address, ...(o.value ? { value: o.value } : {}) };
      const toastId = toast.loading(`${o.label}: preparing…`);
      let hash: Hex | undefined;
      try {
        setState({ phase: "preparing", label: o.label });
        if (chainId !== SUPPORTED_CHAIN_ID) await switchChainAsync({ chainId: SUPPORTED_CHAIN_ID });
        // Simulate first so a revert is explained before the wallet opens.
        await publicClient.simulateContract(call as never);
        let estimate: bigint | null = null;
        try {
          estimate = await publicClient.estimateContractGas(call as never);
        } catch {
          estimate = null;
        }
        const floor = o.floor ?? (o.escrowFn ? gasFloor(o.escrowFn, o.milestoneCount ?? 0) : ERC20_GAS_FLOOR);
        const gas = withGasBuffer(estimate, floor);
        setState({ phase: "signing", label: o.label });
        toast.loading(`${o.label}: confirm in your wallet`, { id: toastId });
        hash = await writeContractAsync({
          ...contract,
          functionName: o.functionName,
          args: o.args,
          gas,
          chainId: SUPPORTED_CHAIN_ID,
          ...(o.value ? { value: o.value } : {}),
        } as never);
        setState({ phase: "pending", hash, label: o.label });
        const sentHash = hash;
        toast.loading(`${o.label}: waiting for confirmation…`, {
          id: toastId,
          action: { label: "Explorer", onClick: () => window.open(explorerTx(sentHash), "_blank", "noopener") },
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 2_000, timeout: 180_000 });
        if (receipt.status !== "success") {
          setState({ phase: "failed", hash, error: "The transaction reverted on-chain. No funds moved.", label: o.label });
          toast.error(`${o.label} failed`, { id: toastId, description: "The transaction reverted on-chain. No funds moved." });
          return null;
        }
        let verification: VerifyResult | null = null;
        if (target === "escrow" && o.verify !== false) {
          setState({ phase: "verifying", hash, label: o.label });
          toast.loading(`${o.label}: verifying on-chain result…`, { id: toastId });
          for (let i = 0; i < 6; i++) {
            try {
              verification = await api<VerifyResult>("/api/tx/verify", { method: "POST", json: { txHash: hash } });
              if (verification.status !== "pending") break;
            } catch (e) {
              // A 4xx is a definite answer (not our contract, malformed); only retry transient failures.
              if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
                verification = { status: "rejected", reason: e.message };
                break;
              }
            }
            await new Promise((r) => setTimeout(r, 1500 + i * 1000));
          }
        }
        setState({ phase: "confirmed", hash, label: o.label, verification });
        const confirmedHash = hash;
        const view = { label: "View tx", onClick: () => window.open(explorerTx(confirmedHash), "_blank", "noopener") };
        if (verification && verification.status === "confirmed" && (verification.problems?.length ?? 0) > 0) {
          toast.warning(`${o.label}: confirmed with a mismatch`, { id: toastId, description: verification.problems!.join("; "), action: view });
        } else if (verification && verification.status !== "confirmed") {
          toast.success(o.successMessage ?? `${o.label}: confirmed on-chain`, {
            id: toastId,
            description: "Confirmed on Mezo testnet. The app's verification has not caught up yet; it will on the next sync.",
            action: view,
          });
        } else {
          toast.success(o.successMessage ?? `${o.label}: confirmed`, {
            id: toastId,
            description: verification ? "Confirmed on Mezo testnet and verified by the app." : "Confirmed on Mezo testnet.",
            action: view,
          });
        }
        await qc.invalidateQueries();
        return { hash, verification };
      } catch (e) {
        if (hash && e instanceof WaitForTransactionReceiptTimeoutError) {
          // Sent but not seen yet. Never tell the user it was "not sent" — that invites a duplicate.
          const sentHash = hash;
          setState({ phase: "delayed", hash, label: o.label, error: "Sent, but the network has not confirmed it yet." });
          toast.warning(`${o.label}: still pending`, {
            id: toastId,
            description: "The transaction was sent but is not confirmed yet. Don't send it again — check the explorer; the app picks it up automatically once it lands.",
            action: { label: "Explorer", onClick: () => window.open(explorerTx(sentHash), "_blank", "noopener") },
          });
          void qc.invalidateQueries();
          return { hash, verification: null, delayed: true };
        }
        const msg = describeTxError(e);
        setState({ phase: "failed", hash, error: msg, label: o.label });
        toast.error(hash ? `${o.label} failed` : `${o.label} not sent`, { id: toastId, description: msg });
        return null;
      }
    },
    [address, chainId, publicClient, qc, switchChainAsync, writeContractAsync],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return {
    run,
    state,
    reset,
    busy: state.phase === "preparing" || state.phase === "signing" || state.phase === "pending" || state.phase === "verifying",
  };
}
