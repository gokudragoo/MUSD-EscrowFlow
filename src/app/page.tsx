import Link from "next/link";
import { ArrowRight, BadgeCheck, Ban, Clock, FileSignature, Gavel, KeyRound, Landmark, Lock, Scale, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HeroVisual } from "@/components/hero/hero-visual";
import { LiveStats } from "@/components/landing/live-stats";
import { EscrowBar } from "@/components/escrow/escrow-ui";
import { NetworkCard } from "@/components/landing/network-card";
import { parseMusd } from "@/lib/money";

const STEPS = [
  {
    title: "Agree on the terms",
    body: "The client defines milestones, amounts, deadlines, review periods and dispute rules. The freelancer accepts that exact version on-chain — its hash is stored in the contract.",
    check: "Any edit before funding resets the acceptance.",
    icon: FileSignature,
  },
  {
    title: "Lock the budget",
    body: "The client deposits the full budget in MUSD. The contract measures what actually arrived and rejects a short deposit.",
    check: "The project shows as funded only after the contract confirms it.",
    icon: Lock,
  },
  {
    title: "Deliver and review",
    body: "The freelancer submits each milestone with links and files. The client approves, asks for changes inside the review period, or opens a dispute.",
    check: "Submission time and record hash are written on-chain.",
    icon: Clock,
  },
  {
    title: "Get paid per milestone",
    body: "Approval releases that milestone's MUSD straight to the freelancer's wallet. If agreed, an unanswered review period lets the freelancer claim it.",
    check: "A milestone can be paid exactly once.",
    icon: BadgeCheck,
  },
];

const RULES = [
  { icon: KeyRound, title: "No admin key", body: "There is no owner, pause switch or upgrade path. Nobody — including us — can move escrowed MUSD outside the agreed rules." },
  { icon: Undo2, title: "No clawbacks", body: "Released payments are final. A client can never reclaim approved or paid work." },
  { icon: Ban, title: "No early withdrawals", body: "A freelancer can only receive a milestone through approval, an agreed review timeout, or a settlement." },
  { icon: Scale, title: "Disputes freeze funds", body: "A disputed milestone is locked until both parties agree a split or the arbiter they chose rules." },
  { icon: Gavel, title: "Cancellation by consent", body: "After funding, cancelling needs both parties and refunds only unpaid, undisputed milestones." },
  { icon: Landmark, title: "Verifiable ledger", body: "For every project: funded = released + refunded + held. Anyone can check it on the explorer." },
];

export default function LandingPage() {
  return (
    <div className="overflow-x-clip">
      <section className="relative">
        <div className="grid-paper pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)]" aria-hidden />
        <div className="relative mx-auto grid max-w-[1320px] items-center gap-8 px-4 pb-10 pt-10 sm:px-6 lg:min-h-[640px] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:pt-14">
          <div className="max-w-xl">
            <p className="text-[14px] font-medium text-paid-300">MUSD EscrowFlow · on Mezo</p>
            <h1 className="mt-4 text-[40px] font-semibold leading-[1.05] tracking-[-0.025em] text-white sm:text-[54px]">
              Work with confidence.
              <br />
              Pay with trust.
            </h1>
            <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-mist-300">
              Milestone escrow for freelance projects. The client locks the budget in a smart contract before work starts; each milestone pays out in MUSD when it is approved. Every deposit and payment can be checked on-chain.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/projects/new">
                <Button size="lg">
                  Create a project <ArrowRight className="size-4" aria-hidden />
                </Button>
              </Link>
              <Link href="/marketplace">
                <Button size="lg" variant="outline">
                  Browse open projects
                </Button>
              </Link>
            </div>
            <p className="mt-5 text-[13px] text-mist-500">Runs on Mezo Testnet. Test MUSD and test BTC have no monetary value.</p>
          </div>
          <div className="relative h-full min-h-[340px] lg:min-h-[560px]">
            <HeroVisual />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 sm:px-6">
        <LiveStats />
      </section>

      <section className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6" aria-labelledby="how">
        <div className="max-w-2xl">
          <h2 id="how" className="text-[28px] font-semibold tracking-[-0.015em] text-white sm:text-[34px]">
            How it works
          </h2>
          <p className="mt-3 text-[16px] leading-relaxed text-mist-300">Four steps, each enforced by the EscrowFlow contract rather than by our servers.</p>
        </div>
        <ol className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="panel relative p-6">
              <div className="flex items-center justify-between">
                <span className="amount text-[13px] font-semibold text-mist-500">Step {i + 1}</span>
                <s.icon className="size-5 text-signal-300" aria-hidden />
              </div>
              <h3 className="mt-4 text-[17px] font-semibold text-white">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-mist-300">{s.body}</p>
              <p className="mt-4 border-t border-ink-700 pt-3 text-[13px] text-paid-300">{s.check}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-y border-ink-700/80 bg-ink-950/40">
        <div className="mx-auto grid max-w-[1320px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-[28px] font-semibold tracking-[-0.015em] text-white">What escrow means here</h2>
            <p className="mt-3 max-w-xl text-[16px] leading-relaxed text-mist-300">
              Escrow means a neutral account holds the money until agreed conditions are met. Here that account is a public smart contract. Each milestone&apos;s share of the budget sits in one of four states, and the app shows them the same way everywhere.
            </p>
            <div className="mt-8 max-w-xl">
              <EscrowBar
                amounts={[parseMusd("40"), parseMusd("60"), parseMusd("60"), parseMusd("40")]}
                statuses={[4, 1, 3, 0]}
                funded
                showLegend
                size="lg"
              />
              <p className="mt-3 text-[13px] text-mist-500">Example: milestone 1 paid, 2 submitted for review, 3 disputed, 4 in progress.</p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="panel p-6">
              <h3 className="text-[17px] font-semibold text-white">For clients</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-mist-300">
                <li>Pay only for milestones you approve.</li>
                <li>Request changes against written acceptance criteria.</li>
                <li>Reclaim a milestone that was never delivered, if you agreed that rule.</li>
                <li>Keep a dated, verifiable record of every payment.</li>
              </ul>
            </div>
            <div className="panel p-6">
              <h3 className="text-[17px] font-semibold text-white">For freelancers</h3>
              <ul className="mt-3 space-y-2.5 text-[14px] leading-relaxed text-mist-300">
                <li>See the full budget locked before you start.</li>
                <li>Prove when you delivered — the timestamp is on-chain.</li>
                <li>Claim payment if a client goes silent past the review period, if agreed.</li>
                <li>Released MUSD lands in your own wallet. No platform fee.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 py-20 sm:px-6" aria-labelledby="rules">
        <h2 id="rules" className="max-w-2xl text-[28px] font-semibold tracking-[-0.015em] text-white sm:text-[34px]">
          Rules the contract enforces for everyone
        </h2>
        <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
          {RULES.map((r) => (
            <div key={r.title} className="flex gap-4">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-ink-600 bg-ink-800">
                <r.icon className="size-5 text-held-300" aria-hidden />
              </div>
              <div>
                <h3 className="text-[15.5px] font-semibold text-white">{r.title}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-mist-300">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1320px] px-4 sm:px-6">
        <NetworkCard />
      </section>
    </div>
  );
}
