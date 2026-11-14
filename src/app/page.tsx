import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroVisual } from "@/components/hero/hero-visual";
import { LiveStats } from "@/components/landing/live-stats";
import { EscrowBar } from "@/components/escrow/escrow-ui";
import { NetworkCard } from "@/components/landing/network-card";
import { parseMusd } from "@/lib/money";
import { MEZO_SYSTEM_CONTRACTS, MUSD_ADDRESS } from "@/config/contracts";
import { explorerAddress } from "@/config/chains";

const STEPS = [
  {
    title: "Agree on the terms",
    body: "The client sets milestones, amounts, deadlines, review periods and dispute rules. The freelancer accepts that exact version on-chain; its hash is stored in the contract.",
    check: "Any edit before funding resets the acceptance.",
  },
  {
    title: "Lock the budget",
    body: "The client deposits the full budget in MUSD, or borrows it against BTC through a Mezo trove first. The contract measures what arrived and rejects a short deposit.",
    check: "Shown as funded only after the contract confirms it.",
  },
  {
    title: "Deliver and review",
    body: "The freelancer submits each milestone with links and files. The client approves, asks for changes inside the review period, or opens a dispute.",
    check: "Submission time and record hash are written on-chain.",
  },
  {
    title: "Get paid per milestone",
    body: "Approval sends that milestone's MUSD straight to the freelancer. If the client goes silent past the agreed review period, the freelancer can claim it.",
    check: "A milestone can be paid exactly once.",
  },
];

const MEZO = [
  {
    name: "MUSD",
    address: MUSD_ADDRESS,
    title: "Settled in Mezo's Bitcoin-backed dollar",
    body: "Budgets are deposited and paid out in MUSD. Funding takes one transaction with an EIP-2612 permit, and every payout is checked against the exact MUSD transfer log.",
  },
  {
    name: "MUSDSavingsRate (sMUSD)",
    address: MEZO_SYSTEM_CONTRACTS.MUSDSavingsRate,
    title: "Held funds earn the savings rate",
    body: "When both parties agree, the escrow parks the held budget in Mezo's sMUSD vault at 1:1 and withdraws exactly what each payout needs. The yield is split as agreed.",
  },
  {
    name: "BorrowerOperations · TroveManager",
    address: MEZO_SYSTEM_CONTRACTS.BorrowerOperations,
    title: "Fund an escrow by borrowing against BTC",
    body: "A client short on MUSD can draw on their trove, or open one, from the funding page. The app previews the fee and collateral ratio before the wallet signs.",
  },
];

const RULES = [
  { title: "No admin key", body: "No owner, pause switch or upgrade path. Nobody, including us, can move escrowed MUSD outside the agreed rules." },
  { title: "No clawbacks", body: "Released payments are final. A client can never reclaim approved or paid work." },
  { title: "No early withdrawals", body: "A freelancer receives a milestone only through approval, an agreed review timeout, or a settlement." },
  { title: "Disputes freeze funds", body: "A disputed milestone is locked until both parties agree a split or their chosen arbiter rules. Its clocks pause while it is disputed." },
  { title: "Cancellation by consent", body: "After funding, cancelling needs both parties, refunds only unpaid and undisputed milestones, and must match the refund the accepting party saw." },
  { title: "A ledger anyone can check", body: "For every project: funded = released + refunded + held. Both contracts are source-verified on the Mezo explorer." },
];

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <section className="mx-auto grid max-w-[1320px] items-center gap-12 px-4 pb-14 pt-12 sm:px-6 lg:min-h-[620px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-16">
        <div className="max-w-xl">
          <h1 className="display text-[44px] leading-[1.04] text-white sm:text-[60px]">
            Work with confidence.
            <br />
            Pay with trust.
          </h1>
          <p className="mt-6 max-w-[34rem] text-[17px] leading-relaxed text-mist-300">
            Milestone escrow for freelance work, paid in MUSD on Mezo. The client locks the budget in a smart contract before work starts, and each milestone pays out
            when it is approved. While it waits, the budget can earn the MUSD savings rate.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/projects/new">
              <Button size="lg">Create a project</Button>
            </Link>
            <Link href="/marketplace">
              <Button size="lg" variant="outline">
                Browse open projects
              </Button>
            </Link>
          </div>
          <p className="mt-5 text-[13px] text-mist-500">Runs on Mezo Testnet. Test MUSD and test BTC have no monetary value.</p>
        </div>
        <HeroVisual />
      </section>

      <section className="mx-auto max-w-[1320px] px-4 sm:px-6">
        <LiveStats />
      </section>

      <section className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6" aria-labelledby="how">
        <h2 id="how" className="display max-w-2xl text-[30px] text-white sm:text-[36px]">
          How it works
        </h2>
        <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-mist-300">Four steps, each enforced by the EscrowFlow contract rather than by our servers.</p>
        <ol className="mt-10 grid gap-x-8 gap-y-10 border-t border-ink-700 pt-8 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <div className="amount text-[13px] font-semibold text-signal-300">{i + 1}</div>
              <h3 className="mt-2 text-[17px] font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mist-300">{s.body}</p>
              <p className="mt-3 text-[13px] text-mist-400">{s.check}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-ink-700 bg-ink-950/50" aria-labelledby="mezo">
        <div className="mx-auto max-w-[1320px] px-4 py-16 sm:px-6">
          <h2 id="mezo" className="display max-w-2xl text-[30px] text-white sm:text-[36px]">
            Built on Mezo, not just deployed there
          </h2>
          <p className="mt-3 max-w-2xl text-[16px] leading-relaxed text-mist-300">
            EscrowFlow calls Mezo&apos;s own MUSD contracts. Every one of them is a verified contract you can open on the explorer.
          </p>
          <div className="mt-10 grid gap-px overflow-hidden rounded-[12px] border border-ink-700 bg-ink-700 lg:grid-cols-3">
            {MEZO.map((m) => (
              <div key={m.name} className="flex flex-col bg-ink-900 p-6">
                <a
                  href={explorerAddress(m.address)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 self-start font-mono text-[12px] text-mist-400 hover:text-signal-300"
                >
                  {m.name} <ArrowUpRight className="size-3" aria-hidden />
                </a>
                <h3 className="mt-3 text-[17px] font-semibold text-white">{m.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-mist-300">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1320px] gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2" aria-labelledby="escrow">
        <div>
          <h2 id="escrow" className="display text-[30px] text-white">
            What escrow means here
          </h2>
          <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-mist-300">
            A neutral account holds the money until agreed conditions are met. Here that account is a public smart contract. Each milestone&apos;s share of the budget is
            in one of a few states, shown the same way everywhere in the app.
          </p>
          <div className="mt-8 max-w-xl">
            <EscrowBar amounts={[parseMusd("40"), parseMusd("60"), parseMusd("60"), parseMusd("40")]} statuses={[4, 1, 3, 0]} funded showLegend size="lg" />
            <p className="mt-3 text-[13px] text-mist-500">Example: milestone 1 paid, 2 awaiting review, 3 disputed, 4 in progress.</p>
          </div>
        </div>
        <div className="grid gap-10 sm:grid-cols-2">
          <div>
            <h3 className="text-[17px] font-semibold text-white">For clients</h3>
            <ul className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-mist-300">
              <li>Pay only for milestones you approve.</li>
              <li>Request changes against written acceptance criteria.</li>
              <li>Reclaim a milestone that was never delivered, if you agreed that rule.</li>
              <li>Fund from your Mezo trove when your MUSD balance is short.</li>
            </ul>
          </div>
          <div>
            <h3 className="text-[17px] font-semibold text-white">For freelancers</h3>
            <ul className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-mist-300">
              <li>See the full budget locked before you start.</li>
              <li>Prove when you delivered: the timestamp is on-chain.</li>
              <li>Claim payment if a client goes silent past the review period, if agreed.</li>
              <li>Share the savings yield on funds held for your work. No platform fee.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 pb-20 sm:px-6" aria-labelledby="rules">
        <h2 id="rules" className="display max-w-3xl text-[30px] text-white sm:text-[36px]">
          Rules the contract enforces for everyone
        </h2>
        <dl className="mt-10 grid gap-x-10 gap-y-8 border-t border-ink-700 pt-8 md:grid-cols-2 lg:grid-cols-3">
          {RULES.map((r) => (
            <div key={r.title}>
              <dt className="text-[15.5px] font-semibold text-white">{r.title}</dt>
              <dd className="mt-1.5 text-[14px] leading-relaxed text-mist-300">{r.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 sm:px-6">
        <NetworkCard />
      </section>
    </div>
  );
}
