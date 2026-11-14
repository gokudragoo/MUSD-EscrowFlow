"use client";

import { useState, type ReactNode } from "react";
import { useMounted } from "@/hooks/useClient";
import { useAccount } from "wagmi";
import { ShieldCheck, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Panel } from "@/components/ui/primitives";
import { ConnectDialog } from "@/components/wallet/wallet";
import { useSession } from "@/hooks/useSession";

/** Pages with private data require a connected wallet + SIWE session (explicit signature, no gas). */
export function SignInGate({ children, title = "Sign in to continue", reason }: { children: ReactNode; title?: string; reason?: string }) {
  const mounted = useMounted();
  const [open, setOpen] = useState(false);
  const { isConnected } = useAccount();
  const { isSignedIn, signIn, signing, loading, mismatch } = useSession();
  if (!mounted || loading) return <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6" aria-busy="true" />;
  if (isSignedIn) return <>{children}</>;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <Panel>
        <EmptyState
          icon={isConnected ? <ShieldCheck className="size-5" /> : <Wallet className="size-5" />}
          title={isConnected ? (mismatch ? "Sign in with the connected wallet" : title) : "Connect your wallet"}
          description={
            isConnected
              ? (reason ?? "Sign a one-time message to prove you control this wallet. It is not a transaction and costs no gas.")
              : "EscrowFlow uses your wallet address as your identity. Connect a browser wallet on Mezo Testnet to continue."
          }
          action={
            isConnected ? (
              <Button onClick={() => signIn()} loading={signing}>
                <ShieldCheck className="size-4" aria-hidden /> Sign in with wallet
              </Button>
            ) : (
              <Button onClick={() => setOpen(true)}>
                <Wallet className="size-4" aria-hidden /> Connect wallet
              </Button>
            )
          }
        />
      </Panel>
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

export function PageContainer({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-[1320px] px-4 py-8 sm:px-6 sm:py-10 ${className}`}>{children}</div>;
}

/** Connect (if needed) then sign in, in place — for walls and forms that need a session. */
export function SignInInline({ label = "Sign in with wallet", variant = "primary" }: { label?: string; variant?: "primary" | "outline" | "secondary" }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const { isConnected } = useAccount();
  const { signIn, signing } = useSession();
  if (!mounted) return null;
  return (
    <>
      {isConnected ? (
        <Button variant={variant} onClick={() => signIn()} loading={signing}>
          <ShieldCheck className="size-4" aria-hidden /> {label}
        </Button>
      ) : (
        <Button variant={variant} onClick={() => setOpen(true)}>
          <Wallet className="size-4" aria-hidden /> Connect wallet
        </Button>
      )}
      <ConnectDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
