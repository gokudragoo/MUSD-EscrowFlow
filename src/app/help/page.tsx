import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/gate";
import { PageHeader, Panel } from "@/components/ui/primitives";
import { ESCROW_ADDRESS, HAS_LEGACY_ESCROW, LEGACY_ESCROW_ADDRESS, MEZO_SYSTEM_CONTRACTS, MUSD_ADDRESS, SMUSD_ADDRESS } from "@/config/contracts";
import { FAUCET_URL, explorerAddress } from "@/config/chains";

export const metadata: Metadata = { title: "Help and about" };

const FAQ: [string, React.ReactNode][] = [
  ["Who can move the money in an escrow?", "Only the contract rules: the client approving a milestone, the freelancer claiming after an agreed review timeout, the client reclaiming an undelivered milestone if agreed, a split both parties accept, an arbiter ruling if one was named, or a mutual cancellation. There is no administrator key."],
  ["What if the client never reviews my work?", "If the terms include auto-release, you can claim the milestone once its review period has passed with no approval, change request or dispute. The app never releases funds by itself — you send the claim transaction."],
  ["What if the freelancer never delivers?", "If the terms include deadline reclaim, the client can reclaim a milestone after its deadline plus the grace period, as long as there is no live submission. Otherwise, propose a mutual cancellation or open a dispute."],
  ["Can terms change after funding?", "No. The contract locks the milestones, amounts, deadlines and rules when the escrow is funded. Before funding, the client can edit them, which resets the freelancer's acceptance."],
  ["How do disputes get resolved?", "A dispute freezes that milestone. Either party proposes how much the freelancer receives; the other accepts it on-chain. If an arbiter was named in the terms, the arbiter can rule on the split. EscrowFlow does not judge who is right. While a milestone is disputed its clocks are paused: if the dispute is withdrawn, the review window, deadline and grace period resume where they stopped."],
  ["What is the sMUSD savings option?", "If both parties agree in the terms, the escrow keeps the held budget in Mezo's MUSD savings vault (MUSDSavingsRate, sMUSD) instead of letting it sit idle. Deposits and withdrawals are 1:1, so every payout and refund still receives exactly its amount. Any yield the vault pays is split between client and freelancer by the share written in the terms, and either party can pay it out at any time. On testnet the rate can be zero."],
  ["Can I fund an escrow with borrowed MUSD?", "Yes. If your wallet holds less MUSD than the budget, the funding page offers to borrow the difference against BTC through Mezo's BorrowerOperations: draw on your existing trove, or open one. It shows the borrowing fee and your collateral ratio after the loan before you sign. EscrowFlow never controls the trove; you repay it on mezo.org."],
  ["Is my work public?", "No. Descriptions, links and files are stored privately and shown only to the client, the freelancer and the arbiter. Only a hash of each submission is written on-chain as a timestamped fingerprint."],
  ["What does 'verified' mean in the app?", "Money states are read from the contract and every funding or payment is checked against the transaction receipt and the MUSD Transfer log. Labels marked 'Application record' are entries in our database, such as comments or uploaded files."],
  ["Where do I get test MUSD?", <>You need testnet BTC for gas from the <a href={FAUCET_URL} className="text-signal-300 hover:underline" target="_blank" rel="noopener noreferrer">Mezo faucet</a>. Test MUSD is minted by opening a trove on testnet.mezo.org with BTC collateral.</>],
];

export default function HelpPage() {
  return (
    <PageContainer className="max-w-4xl">
      <PageHeader title="Help and about" description="How EscrowFlow works, what it costs, what the contract can and cannot do, and the risks you take on." />
      <div className="space-y-6 text-[15px] leading-relaxed text-mist-200">
        <Panel className="p-6" id="how">
          <h2 className="display text-[22px] text-white">How escrow works here</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>The client writes the agreement: milestones, amounts, deadlines, review periods, cancellation and dispute rules.</li>
            <li>The client creates the escrow on-chain. The contract stores the parameters and a hash of the agreement text.</li>
            <li>The freelancer reviews the terms — the app recomputes the hash in their browser — and accepts that exact version.</li>
            <li>The client deposits the full budget in MUSD. The contract checks it received exactly that amount.</li>
            <li>For each milestone the freelancer submits work, and the client approves (paying that milestone), requests changes, or disputes.</li>
            <li>When every milestone is paid, refunded or settled, the escrow closes. Its ledger always satisfies funded = released + refunded + held.</li>
          </ol>
        </Panel>
        <Panel className="p-6" id="fees">
          <h2 className="text-[19px] font-semibold text-white">Fees</h2>
          <p className="mt-2">
            EscrowFlow charges no platform fee. The full milestone amount goes to the freelancer. You pay only Mezo network gas in testnet BTC, a fraction of a cent on
            testnet. Borrowing MUSD from a trove carries Mezo&apos;s own one-off borrowing fee, shown before you sign.
          </p>
        </Panel>
        <Panel className="p-6" id="mezo">
          <h2 className="text-[19px] font-semibold text-white">Mezo contracts the app uses</h2>
          <ul className="mt-3 space-y-2 text-[14px]">
            {[
              ["MUSD", MUSD_ADDRESS, "settlement token; one-transaction funding with an EIP-2612 permit"],
              ["MUSDSavingsRate (sMUSD)", SMUSD_ADDRESS, "where escrows that opted in keep held MUSD, 1:1"],
              ["BorrowerOperations", MEZO_SYSTEM_CONTRACTS.BorrowerOperations, "openTrove / withdrawMUSD when funding with borrowed MUSD"],
              ["TroveManager · SortedTroves · PriceFeed", MEZO_SYSTEM_CONTRACTS.TroveManager, "trove state, insert hints and the BTC price for the borrowing preview"],
            ].map(([name, addr, what]) => (
              <li key={name} className="flex flex-wrap gap-x-2">
                <a href={explorerAddress(addr)} className="font-mono text-signal-300 hover:underline" target="_blank" rel="noopener noreferrer">
                  {name}
                </a>
                <span className="text-mist-300">{what}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="p-6" id="limitations">
          <h2 className="text-[19px] font-semibold text-white">Smart contract limitations</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>The contract cannot judge the quality of work. Approval is the client&apos;s decision; disputes need agreement or an arbiter.</li>
            <li>Without an arbiter, a dispute where one party stops responding keeps that milestone frozen indefinitely.</li>
            <li>Without deadline reclaim, an undelivered milestone needs mutual cancellation to be refunded.</li>
            <li>Without auto-release, a client who stops responding cannot be forced to pay; the freelancer can open a dispute.</li>
            <li>Terms are fixed once funded. Amendments require cancelling and creating a new escrow.</li>
            <li>The contract accepts only MUSD ({MUSD_ADDRESS.slice(0, 10)}…). It holds at most 20 milestones per project.</li>
            <li>
              The sMUSD vault is operated by the Mezo protocol and is upgradeable by Mezo. If it ever stopped processing withdrawals, payouts from escrows that opted
              into savings would wait for it. Escrows without savings never touch the vault.
            </li>
            <li>Reminders run once a day (Vercel Hobby plan). Review timers are enforced by block timestamps, not by our servers.</li>
          </ul>
          <p className="mt-3 text-[14px] text-mist-400">
            EscrowFlow v2: <a href={explorerAddress(ESCROW_ADDRESS)} className="break-all font-mono text-signal-300 hover:underline" target="_blank" rel="noopener noreferrer">{ESCROW_ADDRESS}</a>
            {HAS_LEGACY_ESCROW && (
              <>
                <br />
                v1 (legacy, all escrows settled):{" "}
                <a href={explorerAddress(LEGACY_ESCROW_ADDRESS)} className="break-all font-mono text-signal-300 hover:underline" target="_blank" rel="noopener noreferrer">{LEGACY_ESCROW_ADDRESS}</a>
              </>
            )}
            <br />
            Both are source-verified on the Mezo explorer.
          </p>
        </Panel>
        <Panel className="p-6" id="testnet">
          <h2 className="text-[19px] font-semibold text-white">Risks and responsibilities</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>This is a testnet product. Test tokens have no guaranteed monetary value.</li>
            <li>Blockchain transactions are irreversible. Check addresses and amounts before you sign.</li>
            <li>Escrow does not eliminate the risk of a dishonest counterparty, poor work, or a stalemate.</li>
            <li>The contract has 204 automated tests and an internal security review whose findings were fixed in v2, but it has not been audited by a third party.</li>
            <li>You are responsible for your wallet and keys. EscrowFlow never asks for a seed phrase or private key.</li>
          </ul>
        </Panel>
        <Panel className="p-6" id="faq">
          <h2 className="text-[19px] font-semibold text-white">Frequently asked questions</h2>
          <dl className="mt-3 divide-y divide-ink-700">
            {FAQ.map(([q, a]) => (
              <div key={q} className="py-4">
                <dt className="font-semibold text-white">{q}</dt>
                <dd className="mt-1 text-mist-300">{a}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <p className="text-[13.5px] text-mist-400">
          Also see the <Link href="/legal/terms" className="text-signal-300 hover:underline">terms of use</Link>, <Link href="/legal/privacy" className="text-signal-300 hover:underline">privacy notice</Link> and <Link href="/legal/risk" className="text-signal-300 hover:underline">risk disclosure</Link>.
        </p>
      </div>
    </PageContainer>
  );
}
