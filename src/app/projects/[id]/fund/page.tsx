"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useBalance, useReadContract, useSignTypedData } from "wagmi";
import { parseSignature } from "viem";
import { ArrowLeft, CheckCircle2, Circle, Loader2, PenLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Notice, PageHeader, Panel, PanelHeader, Skeleton } from "@/components/ui/primitives";
import { Amount, TxLink } from "@/components/ui/chain";
import { EscrowBar, KeyValue } from "@/components/escrow/escrow-ui";
import { useProject } from "@/hooks/useProject";
import { useNow } from "@/hooks/useClient";
import { useEscrowTx } from "@/hooks/useEscrowTx";
import { ESCROW_ADDRESS, MUSD_ADDRESS, musdAbi } from "@/config/contracts";
import { MUSD_PERMIT_DOMAIN_NAME, MUSD_PERMIT_DOMAIN_VERSION } from "@/config/abi/musd";
import { FAUCET_URL, SUPPORTED_CHAIN_ID, mezoTestnet } from "@/config/chains";
import { ProjectStatus, projectActions } from "@/lib/escrow-state";
import { describeTxError } from "@/lib/client/errors";
import { cn } from "@/lib/utils";

export default function FundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SignInGate>
      <PageContainer className="max-w-5xl">
        <FundEscrow id={id} />
      </PageContainer>
    </SignInGate>
  );
}

function FundEscrow({ id }: { id: string }) {
  const router = useRouter();
  const { address, chainId } = useAccount();
  const { view, chain, isLoading } = useProject(id);
  const approveTx = useEscrowTx();
  const fundTx = useEscrowTx();
  const { signTypedDataAsync } = useSignTypedData();
  const [signing, setSigning] = useState(false);
  const now = useNow(10_000);
  const btc = useBalance({ address, chainId: SUPPORTED_CHAIN_ID, query: { enabled: !!address } });
  const balance = useReadContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: SUPPORTED_CHAIN_ID, query: { enabled: !!address, refetchInterval: 8000 } });
  const allowance = useReadContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "allowance", args: address ? [address, ESCROW_ADDRESS] : undefined, chainId: SUPPORTED_CHAIN_ID, query: { enabled: !!address, refetchInterval: 8000 } });
  const nonce = useReadContract({ address: MUSD_ADDRESS, abi: musdAbi, functionName: "nonces", args: address ? [address] : undefined, chainId: SUPPORTED_CHAIN_ID, query: { enabled: !!address } });

  if (isLoading) return <Skeleton className="h-96" />;
  if (!view || !chain) return <Notice tone="warning" title="This project has no on-chain escrow yet">Create the escrow from the project page first.</Notice>;

  const total = chain.project.totalAmount;
  const pa = projectActions(chain.project, address, chain.milestones, now);
  const funded = chain.project.status >= ProjectStatus.Active;
  const enoughBalance = balance.data !== undefined && balance.data >= total;
  const approved = allowance.data !== undefined && allowance.data >= total;
  const id_ = BigInt(chain.id);

  const afterFund = async (ok: boolean) => {
    if (ok) {
      toast.success("Escrow funded", { description: "Verified on-chain. The freelancer has been notified." });
      router.push(`/projects/${id}`);
    }
  };

  const fundWithPermit = async () => {
    if (!address || nonce.data === undefined) return;
    setSigning(true);
    try {
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
      const signature = await signTypedDataAsync({
        domain: { name: MUSD_PERMIT_DOMAIN_NAME, version: MUSD_PERMIT_DOMAIN_VERSION, chainId: SUPPORTED_CHAIN_ID, verifyingContract: MUSD_ADDRESS },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: { owner: address, spender: ESCROW_ADDRESS, value: total, nonce: nonce.data, deadline },
      });
      setSigning(false);
      const { v, r, s, yParity } = parseSignature(signature);
      const vv = v !== undefined ? Number(v) : yParity + 27;
      const res = await fundTx.run({ label: "Fund escrow", functionName: "fundWithPermit", args: [id_, deadline, vv, r, s], escrowFn: "fundWithPermit", milestoneCount: chain.milestones.length });
      await afterFund(!!res);
    } catch (e) {
      setSigning(false);
      toast.error("Permit not signed", { description: describeTxError(e) });
    }
  };

  return (
    <div>
      <Link href={`/projects/${id}`} className="mb-4 inline-flex items-center gap-1.5 text-[13.5px] text-mist-300 hover:text-white">
        <ArrowLeft className="size-4" /> {view.project.title}
      </Link>
      <PageHeader title="Fund escrow" description="Deposit the exact agreed budget into the EscrowFlow contract. The project shows as funded only after the contract confirms it received the full amount." />
      {funded && (
        <Notice tone="success" icon={<CheckCircle2 className="size-4" />} title="This escrow is already funded" className="mb-6">
          <Link href={`/projects/${id}`} className="text-signal-300 hover:underline">Return to the project</Link>
        </Notice>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel>
          <PanelHeader title="Deposit" />
          <div className="space-y-5 p-5">
            <div>
              <div className="text-[12.5px] text-mist-400">Total to deposit</div>
              <div className="amount mt-1 text-[34px] font-semibold tracking-[-0.02em] text-white">
                <Amount wei={total} />
              </div>
            </div>
            <EscrowBar amounts={chain.milestones.map((m) => m.amount)} statuses={null} funded={false} />
            {!pa.fund.available && !funded && <Notice tone="warning" title="Funding is not available">{pa.fund.reason}</Notice>}
            {!enoughBalance && balance.data !== undefined && !funded && (
              <Notice tone="danger" title="Insufficient MUSD">
                Your wallet holds <Amount wei={balance.data} />. You need <Amount wei={total} /> to fund this escrow.
              </Notice>
            )}

            <div className="space-y-3">
              <div className="rounded-[12px] border border-signal-400/40 bg-signal-500/[0.06] p-4">
                <div className="flex items-center gap-2 text-[14px] font-semibold text-white">
                  <PenLine className="size-4 text-signal-300" aria-hidden /> One transaction (recommended)
                </div>
                <p className="mt-1 text-[13px] text-mist-300">Sign an EIP-2612 permit for exactly this amount, then send a single funding transaction. No standing allowance is left behind.</p>
                <Button className="mt-3" size="lg" disabled={!pa.fund.available || !enoughBalance || funded} loading={signing || fundTx.busy} onClick={fundWithPermit}>
                  Sign permit and fund
                </Button>
              </div>
              <div className="rounded-[12px] border border-ink-600 p-4">
                <div className="text-[14px] font-semibold text-white">Two transactions</div>
                <p className="mt-1 text-[13px] text-mist-300">Approve the exact amount, then fund. Use this if your wallet does not support typed-data signatures.</p>
                <ol className="mt-3 space-y-2">
                  <Step done={approved} active={!approved} label={<>Approve <Amount wei={total} /> for the escrow contract</>}>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={approved || !pa.fund.available || !enoughBalance}
                      loading={approveTx.busy}
                      onClick={async () => {
                        await approveTx.run({ label: "Approve MUSD", target: "musd", functionName: "approve", args: [ESCROW_ADDRESS, total] });
                        await allowance.refetch();
                      }}
                    >
                      {approved ? "Approved" : "Approve"}
                    </Button>
                  </Step>
                  <Step done={funded} active={approved && !funded} label="Fund the escrow">
                    <Button
                      size="sm"
                      disabled={!approved || !pa.fund.available || funded}
                      loading={fundTx.busy}
                      onClick={async () => {
                        const r = await fundTx.run({ label: "Fund escrow", functionName: "fund", args: [id_], escrowFn: "fund", milestoneCount: chain.milestones.length });
                        await afterFund(!!r);
                      }}
                    >
                      Fund
                    </Button>
                  </Step>
                </ol>
              </div>
            </div>
            <TxStatus phase={fundTx.state.phase} hash={fundTx.state.hash} error={fundTx.state.error} />
          </div>
        </Panel>
        <aside className="space-y-6">
          <Panel>
            <PanelHeader title="Your wallet" />
            <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
              <KeyValue label="MUSD balance">{balance.data !== undefined ? <Amount wei={balance.data} /> : "—"}</KeyValue>
              <KeyValue label="Allowance to escrow">{allowance.data !== undefined ? <Amount wei={allowance.data} /> : "—"}</KeyValue>
              <KeyValue label="BTC for gas">{btc.data ? `${Number(btc.data.formatted).toFixed(6)} BTC` : "—"}</KeyValue>
            </dl>
            {btc.data && btc.data.value === 0n && (
              <div className="px-5 pb-4 text-[12.5px] text-warn-300">
                You need testnet BTC for gas. <a className="underline" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">Open the faucet</a>.
              </div>
            )}
          </Panel>
          <Panel>
            <PanelHeader title="Network" />
            <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
              <KeyValue label="Network">{mezoTestnet.name}</KeyValue>
              <KeyValue label="Chain id">{SUPPORTED_CHAIN_ID}</KeyValue>
              <KeyValue label="Wallet network">
                <span className={chainId === SUPPORTED_CHAIN_ID ? "text-paid-300" : "text-warn-300"}>{chainId === SUPPORTED_CHAIN_ID ? "Connected" : `Wrong network (${chainId ?? "—"})`}</span>
              </KeyValue>
              <KeyValue label="Escrow">#{chain.id}</KeyValue>
            </dl>
          </Panel>
          <Notice icon={<ShieldCheck className="size-4" />} title="What the contract checks">
            Only the client can fund, only after the freelancer accepted the current terms, and only if every deadline is still in the future. It measures its own balance before and after the transfer and rejects any shortfall.
          </Notice>
        </aside>
      </div>
    </div>
  );
}

function Step({ done, active, label, children }: { done: boolean; active: boolean; label: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3">
      {done ? <CheckCircle2 className="size-5 text-paid-300" aria-hidden /> : <Circle className={cn("size-5", active ? "text-signal-300" : "text-mist-500")} aria-hidden />}
      <span className="flex-1 text-[13.5px] text-mist-100">{label}</span>
      {children}
    </li>
  );
}

function TxStatus({ phase, hash, error }: { phase: string; hash?: string; error?: string }) {
  if (phase === "idle") return null;
  const text: Record<string, string> = {
    preparing: "Preparing and simulating the transaction…",
    signing: "Waiting for your wallet confirmation…",
    pending: "Submitted — waiting for the block to confirm…",
    verifying: "Confirmed on-chain — verifying the result…",
    confirmed: "Confirmed and verified.",
    failed: error ?? "Failed.",
  };
  return (
    <div role="status" aria-live="polite" className={cn("flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-2 text-[13px]", phase === "failed" ? "border-danger-400/40 text-danger-300" : phase === "confirmed" ? "border-paid-400/40 text-paid-300" : "border-ink-600 text-mist-300")}>
      {phase !== "failed" && phase !== "confirmed" && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {text[phase]}
      {hash && <TxLink hash={hash} />}
    </div>
  );
}
