"use client";

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage, useSwitchChain } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { describeTxError } from "@/lib/client/errors";
import { SUPPORTED_CHAIN_ID } from "@/config/chains";

export function useSession() {
  const qc = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const { signMessageAsync, isPending: signing } = useSignMessage();
  const { switchChainAsync } = useSwitchChain();
  const q = useQuery({
    queryKey: ["session"],
    queryFn: () => api<{ address: string | null }>("/api/auth/session"),
    staleTime: 60_000,
  });
  const sessionAddress = q.data?.address ?? null;
  const matches = !!address && !!sessionAddress && address.toLowerCase() === sessionAddress.toLowerCase();

  const signIn = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first");
    try {
      if (chainId !== SUPPORTED_CHAIN_ID) await switchChainAsync({ chainId: SUPPORTED_CHAIN_ID });
      const { nonce } = await api<{ nonce: string }>("/api/auth/nonce");
      const message = createSiweMessage({
        address,
        chainId: SUPPORTED_CHAIN_ID,
        domain: window.location.host,
        nonce,
        uri: window.location.origin,
        version: "1",
        statement: "Sign in to MUSD EscrowFlow. This signature proves you control this wallet. It is not a transaction and costs no gas.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60 * 1000),
      });
      const signature = await signMessageAsync({ message });
      await api("/api/auth/verify", { method: "POST", json: { message, signature } });
      await qc.invalidateQueries();
      toast.success("Signed in", { description: "Your wallet is verified for this session." });
      return true;
    } catch (e) {
      toast.error("Sign-in failed", { description: describeTxError(e) });
      return false;
    }
  }, [address, chainId, qc, signMessageAsync, switchChainAsync]);

  const signOut = useCallback(async () => {
    await api("/api/auth/logout", { method: "POST" });
    await qc.invalidateQueries();
    qc.removeQueries({ queryKey: ["dashboard"] });
  }, [qc]);

  return {
    sessionAddress,
    isSignedIn: matches,
    /** Signed in, but with a different wallet than the one now connected. */
    mismatch: !!sessionAddress && isConnected && !matches,
    loading: q.isLoading,
    signing,
    signIn,
    signOut,
  };
}
