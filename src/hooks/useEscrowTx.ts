"use client";

import { useCallback, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { Abi, Hex } from "viem";
import { ESCROW_ADDRESS, MUSD_ADDRESS, escrowFlowAbi, musdAbi } from "@/config/contracts";
import { SUPPORTED_CHAIN_ID, explorerTx } from "@/config/chains";
import { ERC20_GAS_FLOOR, gasFloor, withGasBuffer, type EscrowWrite } from "@/lib/gas";
import { describeTxError } from "@/lib/client/errors";
import { api } from "@/lib/client/api";

export type TxPhase = "idle" | "preparing" | "signing" | "pending" | "verifying" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  hash?: Hex;
  error?: string;
  label?: string;
}

interface RunOptions {
  label: string;
  /** Contract + function. Defaults to EscrowFlow. */
  target?: "escrow" | "musd";
  functionName: string;
  args: readonly unknown[];
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
    async (o: RunOptions): Promise<{ hash: Hex; verification: VerifyResult | null } | null> => {
      if (!address || !publicClient) {
        toast.error("Connect your wallet first");
        return null;
      }
      const target = o.target ?? "escrow";
      const contract = target === "escrow" ? { address: ESCROW_ADDRESS, abi: escrowFlowAbi as Abi } : { address: MUSD_ADDRESS, abi: musdAbi as Abi };
      const toastId = toast.loading(`${o.label}: preparing…`);
      try {
        setState({ phase: "preparing", label: o.label });
        if (chainId !== SUPPORTED_CHAIN_ID) await switchChainAsync({ chainId: SUPPORTED_CHAIN_ID });
        // Simulate first so a revert is explained before the wallet opens.
        await publicClient.simulateContract({ ...contract, functionName: o.functionName, args: o.args, account: address } as never);
        let estimate: bigint | null = null;
        try {
          estimate = await publicClient.estimateContractGas({ ...contract, functionName: o.functionName, args: o.args, account: address } as never);
        } catch {
          estimate = null;
        }
        const floor = o.floor ?? (o.escrowFn ? gasFloor(o.escrowFn, o.milestoneCount ?? 0) : ERC20_GAS_FLOOR);
        const gas = withGasBuffer(estimate, floor);
        setState({ phase: "signing", label: o.label });
        toast.loading(`${o.label}: confirm in your wallet`, { id: toastId });
        const hash = await writeContractAsync({
          ...contract,
          functionName: o.functionName,
          args: o.args,
          gas,
          chainId: SUPPORTED_CHAIN_ID,
        } as never);
        setState({ phase: "pending", hash, label: o.label });
        toast.loading(`${o.label}: waiting for confirmation…`, {
          id: toastId,
          action: { label: "Explorer", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 2_000, timeout: 180_000 });
        if (receipt.status !== "success") {
          setState({ phase: "failed", hash, error: "The transaction reverted on-chain.", label: o.label });
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
            } catch {
              // retry below
            }
            await new Promise((r) => setTimeout(r, 1500 + i * 1000));
          }
        }
        setState({ phase: "confirmed", hash, label: o.label });
        toast.success(o.successMessage ?? `${o.label}: confirmed`, {
          id: toastId,
          description: verification?.status === "confirmed" || target === "musd" ? "Confirmed on Mezo testnet." : "Confirmed on-chain; app verification is delayed and will catch up.",
          action: { label: "View tx", onClick: () => window.open(explorerTx(hash), "_blank", "noopener") },
        });
        await qc.invalidateQueries();
        return { hash, verification };
      } catch (e) {
        const msg = describeTxError(e);
        setState({ phase: "failed", error: msg, label: o.label });
        toast.error(`${o.label} not sent`, { id: toastId, description: msg });
        return null;
      }
    },
    [address, chainId, publicClient, qc, switchChainAsync, writeContractAsync],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);
  return { run, state, reset, busy: state.phase !== "idle" && state.phase !== "confirmed" && state.phase !== "failed" };
}
