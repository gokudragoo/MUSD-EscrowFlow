"use client";

import { AlertTriangle, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddressChip } from "@/components/ui/chain";
import { useWalletHelpers } from "@/components/wallet/wallet";
import { ESCROW_ADDRESS, MUSD_ADDRESS } from "@/config/contracts";
import { EXPLORER_URL, FAUCET_URL, SUPPORTED_CHAIN_ID, mezoTestnet } from "@/config/chains";

export function NetworkCard() {
  const { addNetwork, addMusd } = useWalletHelpers();
  return (
    <div className="panel-raised grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <h2 className="text-[24px] font-semibold tracking-[-0.01em] text-white">Supported network</h2>
        <p className="mt-2 max-w-lg text-[15px] leading-relaxed text-mist-300">
          EscrowFlow runs on Mezo Testnet, a Bitcoin-backed EVM chain. Gas is paid in testnet BTC; payments are in MUSD, Mezo&apos;s Bitcoin-backed dollar.
        </p>
        <dl className="mt-5 space-y-2 text-[13.5px]">
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-mist-400">Network</dt><dd className="text-mist-100">{mezoTestnet.name} · chain id {SUPPORTED_CHAIN_ID}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-mist-400">RPC</dt><dd className="font-mono text-[12.5px] text-mist-100">{mezoTestnet.rpcUrls.default.http[0]}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-mist-400">Explorer</dt><dd><a className="text-signal-300 hover:underline" href={EXPLORER_URL} target="_blank" rel="noopener noreferrer">{EXPLORER_URL.replace("https://", "")}</a></dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-mist-400">MUSD token</dt><dd><AddressChip address={MUSD_ADDRESS} /></dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt className="text-mist-400">EscrowFlow contract</dt><dd><AddressChip address={ESCROW_ADDRESS} /></dd></div>
        </dl>
        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={addNetwork}>Add Mezo Testnet to wallet</Button>
          <Button variant="secondary" onClick={addMusd}>Add MUSD to wallet</Button>
          <a href={FAUCET_URL} target="_blank" rel="noopener noreferrer">
            <Button variant="outline"><Droplets className="size-4" aria-hidden /> Get testnet BTC</Button>
          </a>
        </div>
      </div>
      <div className="rounded-[12px] border border-warn-400/30 bg-warn-400/[0.06] p-5 text-[14px] leading-relaxed text-mist-300">
        <div className="flex items-center gap-2 font-semibold text-white">
          <AlertTriangle className="size-4 text-warn-300" aria-hidden /> Testnet disclaimer
        </div>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>This is a test deployment. Test MUSD and test BTC have no guaranteed monetary value.</li>
          <li>Blockchain transactions are irreversible. Check every amount and address before you sign.</li>
          <li>Escrow reduces payment risk but does not remove the risk of a dishonest counterparty or of low-quality work.</li>
          <li>The contract has extensive automated tests but no third-party audit. Do not use it with real funds.</li>
        </ul>
      </div>
    </div>
  );
}
