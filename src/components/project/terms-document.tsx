import type { TermsDocument } from "@/lib/terms";
import { formatMusd } from "@/lib/money";
import { formatDate, formatDuration } from "@/lib/utils";
import { MUSD_ADDRESS } from "@/config/contracts";

/** The agreement rendered as a document (serif), used on-screen and for the printable copy. */
export function TermsDocumentView({ terms, termsHash, version }: { terms: TermsDocument; termsHash?: string; version?: number }) {
  const zero = /^0x0{40}$/i;
  return (
    <article className="prose-terms mx-auto max-w-[72ch] text-[15px] text-mist-100">
      <header className="border-b border-ink-600 pb-5">
        <div className="font-sans text-[12.5px] text-mist-400">
          Milestone escrow agreement{version ? ` · version ${version}` : ""} · settled in MUSD on Mezo Testnet (chain {terms.chainId})
        </div>
        <h2 className="mt-2 text-[26px] font-semibold leading-tight text-white">{terms.title}</h2>
        {terms.summary && <p className="mt-2 text-mist-300">{terms.summary}</p>}
      </header>

      <section className="mt-6 space-y-1.5 font-sans text-[13.5px]">
        <Row k="Client" v={<span className="font-mono text-[12.5px]">{terms.client}</span>} />
        <Row k="Freelancer" v={<span className="font-mono text-[12.5px]">{zero.test(terms.freelancer) ? "To be selected" : terms.freelancer}</span>} />
        <Row k="Arbiter" v={terms.rules.arbiter ? <span className="font-mono text-[12.5px]">{terms.rules.arbiter}</span> : "None"} />
        <Row k="Total budget" v={<span className="amount">{formatMusd(BigInt(terms.totalAmount))} MUSD</span>} />
        <Row k="Token" v={<span className="font-mono text-[12.5px]">MUSD {terms.token.address ?? MUSD_ADDRESS}</span>} />
        <Row k="Category" v={terms.category} />
        {terms.startDate && <Row k="Start date" v={formatDate(terms.startDate)} />}
      </section>

      <section className="mt-7">
        <h3 className="text-[18px] font-semibold text-white">1. Scope</h3>
        <p className="mt-2 whitespace-pre-line">{terms.description}</p>
        {terms.references.length > 0 && (
          <ul className="mt-2 list-disc pl-5 font-sans text-[13.5px]">
            {terms.references.map((r) => (
              <li key={r}>
                <a href={r} target="_blank" rel="noopener noreferrer nofollow" className="text-signal-300 hover:underline">
                  {r}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-7">
        <h3 className="text-[18px] font-semibold text-white">2. Milestones and payments</h3>
        <ol className="mt-3 space-y-5">
          {terms.milestones.map((m, i) => (
            <li key={i} className="rounded-[10px] border border-ink-600 p-4 print-plain">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[16px] font-semibold text-white">
                  {i + 1}. {m.title}
                </div>
                <div className="amount font-sans text-[15px] font-semibold text-white">{formatMusd(BigInt(m.amount))} MUSD</div>
              </div>
              <div className="mt-1 font-sans text-[12.5px] text-mist-400">
                Deadline {formatDate(m.deadline, true)} · client review period {formatDuration(m.reviewPeriodSeconds)}
              </div>
              {m.description && <p className="mt-2 whitespace-pre-line">{m.description}</p>}
              {m.deliverables.length > 0 && (
                <>
                  <div className="mt-3 font-sans text-[12.5px] font-medium text-mist-300">Deliverables</div>
                  <ul className="mt-1 list-disc pl-5">
                    {m.deliverables.map((d, j) => (
                      <li key={j}>{d}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-3 font-sans text-[12.5px] font-medium text-mist-300">Acceptance criteria</div>
              <ul className="mt-1 list-disc pl-5">
                {m.acceptanceCriteria.map((d, j) => (
                  <li key={j}>{d}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-7">
        <h3 className="text-[18px] font-semibold text-white">3. Rules enforced by the escrow contract</h3>
        <ul className="mt-2 list-disc space-y-1.5 pl-5">
          <li>The client deposits the full budget before work starts. The contract rejects any deposit that arrives short.</li>
          <li>Each milestone is paid only when the client approves it{terms.rules.autoRelease ? ", or when the review period ends without approval, change request or dispute (auto-release)" : ""}. A milestone can be paid only once.</li>
          {terms.rules.deadlineReclaim ? (
            <li>
              If a milestone was never delivered by its deadline plus {formatDuration(terms.rules.reclaimGracePeriodSeconds)}, or was sent back for changes and not resubmitted within{" "}
              {formatDuration(terms.rules.reclaimGracePeriodSeconds)} of the change request, the client may reclaim that milestone. Work awaiting review, disputed or paid
              cannot be reclaimed. Time spent in a withdrawn dispute does not count against the freelancer.
            </li>
          ) : (
            <li>Deadline reclaim is not part of this agreement.</li>
          )}
          {terms.rules.savings?.enabled && (
            <li>
              While funds are held, the escrow keeps them in Mezo&apos;s sMUSD savings vault (MUSDSavingsRate) at 1:1 and withdraws exactly what each payout or refund needs. The
              savings yield is split {terms.rules.savings.freelancerShareBps / 100}% to the freelancer and {(10_000 - terms.rules.savings.freelancerShareBps) / 100}% to the client.
            </li>
          )}
          <li>{terms.rules.arbiter ? "Disputed milestones are frozen until the parties agree a split or the named arbiter rules on it." : "Disputed milestones are frozen until both parties agree a split on-chain."}</li>
          <li>Released payments are never reversed. There is no platform fee and no administrator who can move escrowed funds.</li>
        </ul>
      </section>

      <section className="mt-7">
        <h3 className="text-[18px] font-semibold text-white">4. Cancellation</h3>
        <p className="mt-2 whitespace-pre-line">{terms.rules.cancellationTerms || "As enforced by the contract."}</p>
      </section>
      <section className="mt-7">
        <h3 className="text-[18px] font-semibold text-white">5. Disputes</h3>
        <p className="mt-2 whitespace-pre-line">{terms.rules.disputeTerms || "As enforced by the contract."}</p>
      </section>

      {termsHash && (
        <footer className="mt-8 border-t border-ink-600 pt-4 font-sans text-[12px] text-mist-400">
          Document hash (keccak256 of the canonical JSON): <span className="break-all font-mono text-mist-200">{termsHash}</span>
        </footer>
      )}
    </article>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2 border-b border-ink-700/60 py-1.5">
      <span className="text-mist-400">{k}</span>
      <span className="text-right text-mist-100">{v}</span>
    </div>
  );
}
