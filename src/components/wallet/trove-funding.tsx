"use client";

import { useState } from "react";
import { useAccount, useBalance, usePublicClient, useReadContracts } from "wagmi";
import { formatEther, parseEther, zeroAddress, type Abi, type Address } from "viem";
import { Landmark } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Notice, Skeleton } from "@/components/ui/primitives";
import { Amount } from "@/components/ui/chain";
import { KeyValue } from "@/components/escrow/escrow-ui";
import { useEscrowTx } from "@/hooks/useEscrowTx";
import { MEZO_SYSTEM_CONTRACTS } from "@/config/contracts";
import { borrowerOperationsAbi, priceFeedAbi, sortedTrovesAbi, troveManagerAbi } from "@/config/abi/mezo";
import { SUPPORTED_CHAIN_ID } from "@/config/chains";
import { formatMusd, tryParseMusd } from "@/lib/money";
import {
  COMFORT_CR,
  TROVE_ACTIVE,
  collateralFor,
  formatCr,
  maxDraw,
  minOpenDebt,
  planDraw,
  planOpen,
  type TroveParams,
  type TroveState,
} from "@/lib/trove";

const BO = MEZO_SYSTEM_CONTRACTS.BorrowerOperations as Address;
const TM = MEZO_SYSTEM_CONTRACTS.TroveManager as Address;
const ST = MEZO_SYSTEM_CONTRACTS.SortedTroves as Address;
const PF = MEZO_SYSTEM_CONTRACTS.PriceFeed as Address;

/** Rounds a wei amount up to the next whole cent so the borrowed MUSD always covers the shortfall. */
const ceilCents = (wei: bigint) => {
  const cent = 10n ** 16n;
  return ((wei + cent - 1n) / cent) * cent;
};

/**
 * Fund an escrow with MUSD borrowed against BTC through Mezo's own BorrowerOperations: draw on an
 * existing trove (withdrawMUSD) or open one (openTrove). The client signs every call in their
 * wallet; EscrowFlow never touches the trove.
 */
export function TroveFunding({ shortfall, onFunded }: { shortfall: bigint; onFunded?: () => void }) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: SUPPORTED_CHAIN_ID });
  const tx = useEscrowTx();
  const btc = useBalance({ address, chainId: SUPPORTED_CHAIN_ID, query: { enabled: !!address } });
  const reads = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: PF, abi: priceFeedAbi, functionName: "fetchPrice", chainId: SUPPORTED_CHAIN_ID },
      { address: BO, abi: borrowerOperationsAbi, functionName: "borrowingRate", chainId: SUPPORTED_CHAIN_ID },
      { address: BO, abi: borrowerOperationsAbi, functionName: "minNetDebt", chainId: SUPPORTED_CHAIN_ID },
      { address: BO, abi: borrowerOperationsAbi, functionName: "MUSD_GAS_COMPENSATION", chainId: SUPPORTED_CHAIN_ID },
      { address: BO, abi: borrowerOperationsAbi, functionName: "MCR", chainId: SUPPORTED_CHAIN_ID },
      { address: TM, abi: troveManagerAbi, functionName: "getTroveStatus", args: [address ?? zeroAddress], chainId: SUPPORTED_CHAIN_ID },
      { address: TM, abi: troveManagerAbi, functionName: "getTroveColl", args: [address ?? zeroAddress], chainId: SUPPORTED_CHAIN_ID },
      { address: TM, abi: troveManagerAbi, functionName: "getTroveDebt", args: [address ?? zeroAddress], chainId: SUPPORTED_CHAIN_ID },
      { address: TM, abi: troveManagerAbi, functionName: "getTrovePrincipal", args: [address ?? zeroAddress], chainId: SUPPORTED_CHAIN_ID },
      { address: TM, abi: troveManagerAbi, functionName: "getTroveMaxBorrowingCapacity", args: [address ?? zeroAddress], chainId: SUPPORTED_CHAIN_ID },
    ],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
  const [amountText, setAmountText] = useState("");
  const [collText, setCollText] = useState("");

  if (!address) return null;
  if (reads.isLoading) return <Skeleton className="h-40" />;
  if (reads.isError || !reads.data) {
    return <Notice tone="warning" title="Could not read Mezo's trove contracts">Reload to try again, or borrow MUSD at testnet.mezo.org.</Notice>;
  }
  const [price, borrowingRate, minNetDebt, gasCompensation, mcr, status, coll, debt, principal, maxCapacity] = reads.data as unknown as [
    bigint, bigint, bigint, bigint, bigint, number, bigint, bigint, bigint, bigint,
  ];
  const p: TroveParams = { price, borrowingRate, minNetDebt, gasCompensation, mcr };
  const t: TroveState = { status: Number(status), coll, debt, principal, maxCapacity };
  const active = t.status === TROVE_ACTIVE;
  const need = ceilCents(shortfall);

  /** Sorted-list hints for the trove's new position: an eth_call does the list walk for free. */
  const hints = async (nicr: bigint): Promise<[Address, Address]> => {
    if (!publicClient) return [zeroAddress, zeroAddress];
    try {
      const [prev, next] = await publicClient.readContract({ address: ST, abi: sortedTrovesAbi, functionName: "findInsertPosition", args: [nicr, zeroAddress, zeroAddress] });
      return [prev, next];
    } catch {
      return [zeroAddress, zeroAddress];
    }
  };

  if (active) {
    const available = maxDraw(t, p);
    const amount = tryParseMusd(amountText) ?? need;
    const plan = planDraw(t, p, amount);
    return (
      <div className="space-y-4">
        <p className="text-[13.5px] leading-relaxed text-mist-300">
          You have an open trove on Mezo. Borrow the missing MUSD against your BTC collateral, then fund the escrow with it.
        </p>
        <dl className="divide-y divide-ink-700 rounded-[10px] border border-ink-700 px-4 text-[13.5px]">
          <KeyValue label="Collateral">{Number(formatEther(t.coll)).toFixed(6)} BTC</KeyValue>
          <KeyValue label="Debt now">
            <Amount wei={t.debt} />
          </KeyValue>
          <KeyValue label="Collateral ratio now">{formatCr((t.coll * p.price) / (t.debt || 1n))}</KeyValue>
          <KeyValue label="You can borrow up to">
            <Amount wei={available} />
          </KeyValue>
        </dl>
        <Field label="Borrow (MUSD)" htmlFor="draw" hint={`Your escrow is short by ${formatMusd(shortfall)} MUSD.`}>
          <Input id="draw" inputMode="decimal" className="amount" placeholder={formatMusd(need)} value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </Field>
        <dl className="space-y-1 text-[13px]">
          <div className="flex justify-between gap-3">
            <dt className="text-mist-400">Borrowing fee ({Number((p.borrowingRate * 10_000n) / 10n ** 18n) / 100}%)</dt>
            <dd className="amount text-mist-100">{formatMusd(plan.fee, { maxDecimals: 4 })} MUSD</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-mist-400">Collateral ratio after</dt>
            <dd className={plan.newCr < COMFORT_CR ? "text-danger-300" : "text-mist-100"}>{formatCr(plan.newCr)}</dd>
          </div>
        </dl>
        {!plan.capacityOk && <Notice tone="danger" title="Above this trove's borrowing capacity">Mezo caps each trove&apos;s debt at the amount that put it at 110% when it was opened. Borrow less or add collateral at testnet.mezo.org.</Notice>}
        {plan.capacityOk && !plan.crOk && <Notice tone="danger" title="Collateral ratio would fall below 110%">Borrow less, or add BTC collateral first.</Notice>}
        {plan.ok && plan.newCr < COMFORT_CR && <Notice tone="warning" title="Thin safety margin">Below 150% a drop in the BTC price can get the trove liquidated. Consider borrowing less.</Notice>}
        <Button
          disabled={!plan.ok}
          loading={tx.busy}
          onClick={async () => {
            const [upper, lower] = await hints(plan.nicr);
            const r = await tx.run({
              label: `Borrow ${formatMusd(amount)} MUSD`,
              contract: { address: BO, abi: borrowerOperationsAbi as Abi },
              functionName: "withdrawMUSD",
              args: [amount, upper, lower],
              floor: 1_200_000n,
              successMessage: `Borrowed ${formatMusd(amount)} MUSD from your trove`,
            });
            if (r) {
              await reads.refetch();
              onFunded?.();
            }
          }}
        >
          <Landmark className="size-4" aria-hidden /> Borrow from my trove
        </Button>
      </div>
    );
  }

  // No active trove: open one. Mezo requires a minimum debt, so it may borrow more than the shortfall.
  const minDebt = minOpenDebt(p);
  const debtAmount = (() => {
    const typed = tryParseMusd(amountText);
    if (typed !== null) return typed;
    return need > minDebt ? need : ceilCents(minDebt);
  })();
  const suggested = collateralFor(p, debtAmount);
  const collWei = (() => {
    try {
      return collText.trim() ? parseEther(collText.trim()) : suggested;
    } catch {
      return 0n;
    }
  })();
  const plan = planOpen(p, debtAmount, collWei);
  const btcAfter = (btc.data?.value ?? 0n) - collWei;
  return (
    <div className="space-y-4">
      <p className="text-[13.5px] leading-relaxed text-mist-300">
        Open a trove on Mezo: lock testnet BTC as collateral and borrow MUSD against it. Mezo&apos;s minimum loan is {formatMusd(p.minNetDebt, { maxDecimals: 0 })} MUSD,
        so you may borrow more than this escrow needs; the rest stays in your wallet.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Borrow (MUSD)" htmlFor="debt">
          <Input id="debt" inputMode="decimal" className="amount" placeholder={formatMusd(debtAmount)} value={amountText} onChange={(e) => setAmountText(e.target.value)} />
        </Field>
        <Field label="Collateral (BTC)" htmlFor="coll" hint={`Suggested ${formatEther(suggested)} BTC for a 200% ratio`}>
          <Input id="coll" inputMode="decimal" className="amount" placeholder={formatEther(suggested)} value={collText} onChange={(e) => setCollText(e.target.value)} />
        </Field>
      </div>
      <dl className="space-y-1 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-mist-400">Fee + gas compensation (repaid on close)</dt>
          <dd className="amount text-mist-100">
            {formatMusd(plan.fee, { maxDecimals: 2 })} + {formatMusd(p.gasCompensation, { maxDecimals: 0 })} MUSD
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mist-400">Collateral ratio</dt>
          <dd className={plan.cr < COMFORT_CR ? "text-danger-300" : "text-mist-100"}>{formatCr(plan.cr)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-mist-400">BTC left in your wallet</dt>
          <dd className={btcAfter <= 0n ? "text-danger-300" : "text-mist-100"}>{Number(formatEther(btcAfter > 0n ? btcAfter : 0n)).toFixed(6)} BTC</dd>
        </div>
      </dl>
      {!plan.minDebtOk && <Notice tone="warning" title={`Mezo's minimum loan is ${formatMusd(p.minNetDebt, { maxDecimals: 0 })} MUSD`}>Increase the amount to borrow.</Notice>}
      {plan.minDebtOk && !plan.crOk && <Notice tone="danger" title="Not enough collateral">The ratio must be at least 110%. Add more BTC.</Notice>}
      {btcAfter <= 0n && <Notice tone="danger" title="Not enough testnet BTC">Keep some BTC for gas. Get more from the Mezo faucet.</Notice>}
      <Button
        disabled={!plan.ok || btcAfter <= 0n}
        loading={tx.busy}
        onClick={async () => {
          const [upper, lower] = await hints(plan.nicr);
          const r = await tx.run({
            label: "Open trove",
            contract: { address: BO, abi: borrowerOperationsAbi as Abi },
            functionName: "openTrove",
            args: [debtAmount, upper, lower],
            value: collWei,
            floor: 1_500_000n,
            successMessage: `Trove opened: ${formatMusd(debtAmount)} MUSD borrowed`,
          });
          if (r) {
            await reads.refetch();
            onFunded?.();
          }
        }}
      >
        <Landmark className="size-4" aria-hidden /> Open trove and borrow
      </Button>
    </div>
  );
}
