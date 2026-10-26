"use client";

import { useState } from "react";
import { useMounted } from "@/hooks/useClient";
import Link from "next/link";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useAccount, useBalance, useConnect, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, LogOut, PlusCircle, ShieldCheck, Wallet, ExternalLink, UserRound, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Amount } from "@/components/ui/chain";
import { useSession } from "@/hooks/useSession";
import { MUSD_ADDRESS, musdAbi } from "@/config/contracts";
import { FAUCET_URL, SUPPORTED_CHAIN_ID, addChainParams, explorerAddress, mezoTestnet } from "@/config/chains";
import { describeTxError } from "@/lib/client/errors";
import { formatMusd } from "@/lib/money";
import { cn, shortAddress } from "@/lib/utils";

type Eip1193 = { request: (args: { method: string; params?: unknown }) => Promise<unknown> };

async function providerOf(connector: { getProvider: () => Promise<unknown> } | undefined): Promise<Eip1193 | null> {
  if (connector) {
    const p = (await connector.getProvider()) as Eip1193 | undefined;
    if (p?.request) return p;
  }
  const w = typeof window !== "undefined" ? (window as unknown as { ethereum?: Eip1193 }).ethereum : undefined;
  return w ?? null;
}

export function useWalletHelpers() {
  const { connector } = useAccount();
  const addNetwork = async () => {
    try {
      const p = await providerOf(connector);
      if (!p) throw new Error("No browser wallet found");
      await p.request({ method: "wallet_addEthereumChain", params: [addChainParams] });
      toast.success("Mezo Testnet is available in your wallet");
    } catch (e) {
      toast.error("Could not add the network", { description: describeTxError(e) });
    }
  };
  const addMusd = async () => {
    try {
      const p = await providerOf(connector);
      if (!p) throw new Error("No browser wallet found");
      await p.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: MUSD_ADDRESS, symbol: "MUSD", decimals: 18 } },
      });
      toast.success("MUSD added to your wallet");
    } catch (e) {
      toast.error("Could not add MUSD", { description: describeTxError(e) });
    }
  };
  return { addNetwork, addMusd };
}

export function ConnectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { connectors, connectAsync, isPending, variables } = useConnect();
  const [error, setError] = useState<string | null>(null);
  // EIP-6963 wallets announce themselves with a name + icon; hide the generic shim when real ones exist.
  const announced = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  const list = announced.length > 0 ? announced : connectors;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setError(null);
        onOpenChange(o);
      }}
      title="Connect a wallet"
      description="EscrowFlow is non-custodial. Your wallet signs every action; we never see your keys or seed phrase."
    >
      <div className="space-y-2">
        {list.map((c) => {
          const pending = isPending && variables?.connector && "id" in variables.connector && variables.connector.id === c.id;
          return (
            <button
              key={c.uid}
              type="button"
              disabled={isPending}
              onClick={async () => {
                setError(null);
                try {
                  await connectAsync({ connector: c, chainId: SUPPORTED_CHAIN_ID });
                  onOpenChange(false);
                } catch (e) {
                  setError(describeTxError(e));
                }
              }}
              className="flex w-full items-center gap-3 rounded-[12px] border border-ink-600 bg-ink-800 px-4 py-3 text-left transition-colors hover:border-signal-400 hover:bg-ink-750 disabled:opacity-60"
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" className="size-7 rounded-md" />
              ) : (
                <span className="grid size-7 place-items-center rounded-md bg-ink-700">
                  <Wallet className="size-4 text-mist-300" />
                </span>
              )}
              <span className="flex-1 text-[14px] font-medium text-white">{c.id === "injected" ? "Browser wallet" : c.name}</span>
              {pending && <span className="text-[12px] text-mist-400">Check your wallet…</span>}
            </button>
          );
        })}
        {list.length === 0 && (
          <p className="text-[14px] text-mist-300">
            No browser wallet detected. Install MetaMask, Rabby or another EVM wallet, then reload this page.
          </p>
        )}
        {error && (
          <p className="rounded-lg border border-danger-400/30 bg-danger-400/10 px-3 py-2 text-[13px] text-danger-300" role="alert">
            {error}
          </p>
        )}
        <p className="pt-2 text-[12.5px] leading-relaxed text-mist-500">
          You need testnet BTC for gas.{" "}
          <a className="text-signal-300 hover:underline" href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            Get some from the Mezo faucet
          </a>
          .
        </p>
      </div>
    </Dialog>
  );
}

export function ConnectButton({ className, size = "md" }: { className?: string; size?: "sm" | "md" }) {
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const { address, isConnected, chainId } = useAccount();
  const { disconnect } = useDisconnect();
  const { isSignedIn, signIn, signOut, signing, mismatch } = useSession();
  const { addMusd, addNetwork } = useWalletHelpers();
  const btc = useBalance({ address, chainId: SUPPORTED_CHAIN_ID, query: { enabled: !!address } });
  const musd = useReadContract({
    address: MUSD_ADDRESS,
    abi: musdAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: SUPPORTED_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  if (!mounted || !isConnected || !address) {
    return (
      <>
        <Button size={size} className={className} onClick={() => setOpen(true)}>
          <Wallet className="size-4" aria-hidden /> Connect wallet
        </Button>
        <ConnectDialog open={open} onOpenChange={setOpen} />
      </>
    );
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {!isSignedIn && (
        <Button size="sm" variant={mismatch ? "danger" : "primary"} loading={signing} onClick={() => signIn()}>
          <ShieldCheck className="size-4" aria-hidden /> {mismatch ? "Sign in with this wallet" : "Sign in"}
        </Button>
      )}
      <Dropdown.Root>
        <Dropdown.Trigger asChild>
          <button className="flex h-9 items-center gap-2 rounded-[10px] border border-ink-600 bg-ink-800 px-3 text-[13px] text-mist-100 hover:border-ink-500">
            <span className={cn("size-2 rounded-full", chainId === SUPPORTED_CHAIN_ID ? "bg-paid-400" : "bg-warn-400")} aria-hidden />
            <span className="font-mono">{shortAddress(address)}</span>
            <ChevronDown className="size-3.5 text-mist-400" aria-hidden />
          </button>
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content align="end" sideOffset={8} className="panel-raised z-50 w-72 p-1.5">
            <div className="px-3 py-2.5">
              <div className="font-mono text-[12.5px] text-mist-300">{shortAddress(address, 6)}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[13px]">
                <div>
                  <div className="text-[11.5px] text-mist-500">MUSD</div>
                  <div className="amount font-medium text-white">{musd.data !== undefined ? formatMusd(musd.data) : "—"}</div>
                </div>
                <div>
                  <div className="text-[11.5px] text-mist-500">BTC (gas)</div>
                  <div className="amount font-medium text-white">{btc.data ? Number(btc.data.formatted).toFixed(6) : "—"}</div>
                </div>
              </div>
              <div className="mt-2 text-[12px] text-mist-400">{isSignedIn ? "Signed in for this session" : "Not signed in — sign in to save drafts and submissions"}</div>
            </div>
            <Dropdown.Separator className="my-1 h-px bg-ink-700" />
            <MenuItem href="/settings" icon={<UserRound className="size-4" />}>Profile and settings</MenuItem>
            <MenuItem onSelect={addMusd} icon={<Coins className="size-4" />}>Add MUSD to wallet</MenuItem>
            <MenuItem onSelect={addNetwork} icon={<PlusCircle className="size-4" />}>Add Mezo Testnet to wallet</MenuItem>
            <MenuItem href={explorerAddress(address)} external icon={<ExternalLink className="size-4" />}>View on explorer</MenuItem>
            <Dropdown.Separator className="my-1 h-px bg-ink-700" />
            <MenuItem
              onSelect={async () => {
                if (isSignedIn) await signOut();
                disconnect();
              }}
              icon={<LogOut className="size-4" />}
            >
              Disconnect
            </MenuItem>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      <span className="sr-only">{musd.data !== undefined ? `MUSD balance ${formatMusd(musd.data)}` : ""}</span>
    </div>
  );
}

function MenuItem({ children, icon, onSelect, href, external }: { children: React.ReactNode; icon: React.ReactNode; onSelect?: () => void; href?: string; external?: boolean }) {
  const cls = "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] text-mist-100 outline-none data-[highlighted]:bg-ink-700";
  if (href) {
    return (
      <Dropdown.Item asChild className={cls}>
        {external ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {icon}
            {children}
          </a>
        ) : (
          <Link href={href}>
            {icon}
            {children}
          </Link>
        )}
      </Dropdown.Item>
    );
  }
  return (
    <Dropdown.Item className={cls} onSelect={onSelect}>
      {icon}
      {children}
    </Dropdown.Item>
  );
}

/** Persistent banner when the wallet is on the wrong network. */
export function NetworkGuard() {
  const { isConnected, chainId } = useAccount();
  const { switchChainAsync, isPending } = useSwitchChain();
  const { addNetwork } = useWalletHelpers();
  const mounted = useMounted();
  if (!mounted || !isConnected || chainId === SUPPORTED_CHAIN_ID) return null;
  return (
    <div className="border-b border-warn-400/30 bg-warn-400/[0.08]">
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-3 px-4 py-2.5 text-[13.5px] sm:px-6">
        <AlertTriangle className="size-4 text-warn-300" aria-hidden />
        <span className="text-mist-100">Your wallet is on another network. EscrowFlow runs on {mezoTestnet.name} (chain {SUPPORTED_CHAIN_ID}).</span>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            loading={isPending}
            onClick={async () => {
              try {
                await switchChainAsync({ chainId: SUPPORTED_CHAIN_ID });
              } catch {
                await addNetwork();
              }
            }}
          >
            Switch to Mezo Testnet
          </Button>
        </div>
      </div>
    </div>
  );
}

export function useMusdBalance() {
  const { address } = useAccount();
  return useReadContract({
    address: MUSD_ADDRESS,
    abi: musdAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: SUPPORTED_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });
}

export function BalanceLine() {
  const b = useMusdBalance();
  if (b.data === undefined) return null;
  return <Amount wei={b.data} />;
}
