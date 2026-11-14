import { parseMusd } from "@/lib/money";
import { EscrowBar } from "@/components/escrow/escrow-ui";

const ROWS = [
  { n: 1, title: "UI design", amount: "40.00", state: "Paid", status: 4 },
  { n: 2, title: "Frontend build", amount: "60.00", state: "In review", status: 1 },
  { n: 3, title: "Backend integration", amount: "60.00", state: "Held", status: 0 },
  { n: 4, title: "Final delivery", amount: "40.00", state: "Held", status: 0 },
] as const;

/**
 * The hero is the product itself: an escrow statement, set like the agreement document, showing how
 * one budget sits in the contract milestone by milestone. Static and illustrative (labelled so).
 */
export function HeroVisual() {
  return (
    <figure className="relative mx-auto w-full max-w-[540px]" aria-label="Example escrow statement">
      <div className="rounded-[14px] border border-ink-600 bg-ink-850 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.9)]">
        <div className="flex items-start justify-between gap-4 border-b border-ink-700 px-6 pb-4 pt-5">
          <div>
            <div className="text-[12px] text-mist-400">Escrow statement</div>
            <div className="display mt-1 text-[20px] leading-snug text-white">Marketing website</div>
            <div className="mt-1 font-mono text-[11.5px] text-mist-500">client 0x85bF…3EfE · freelancer 0x4309…034f</div>
          </div>
          <span className="shrink-0 rounded-full border border-ink-600 px-2.5 py-0.5 text-[11.5px] text-mist-400">Example</span>
        </div>

        <div className="px-6 pt-5">
          <EscrowBar amounts={ROWS.map((r) => parseMusd(r.amount))} statuses={ROWS.map((r) => r.status)} funded size="md" />
        </div>

        <table className="mt-4 w-full text-[13.5px]">
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.n} className="border-t border-ink-700/70 first:border-t-0">
                <td className="w-14 py-2.5 pl-6 pr-2 text-mist-500">M{r.n}</td>
                <td className="py-2.5 text-mist-100">{r.title}</td>
                <td className="amount py-2.5 pr-4 text-right text-mist-100">{r.amount}</td>
                <td className="w-[104px] py-2.5 pr-6 text-right">
                  <span
                    className={
                      r.state === "Paid"
                        ? "rounded-full bg-signal-500 px-2 py-0.5 text-[11.5px] font-medium text-ink-950"
                        : r.state === "In review"
                          ? "rounded-full border border-mist-400/50 px-2 py-0.5 text-[11.5px] text-mist-100"
                          : "text-[12px] text-mist-400"
                    }
                  >
                    {r.state}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-2 grid grid-cols-3 border-t border-ink-700 text-[12px]">
          <div className="px-6 py-3.5">
            <dt className="text-mist-400">Funded</dt>
            <dd className="amount mt-0.5 text-[15px] font-semibold text-white">200.00</dd>
          </div>
          <div className="border-l border-ink-700 px-5 py-3.5">
            <dt className="text-mist-400">Released</dt>
            <dd className="amount mt-0.5 text-[15px] font-semibold text-signal-300">40.00</dd>
          </div>
          <div className="border-l border-ink-700 px-5 py-3.5">
            <dt className="text-mist-400">Held, in sMUSD</dt>
            <dd className="amount mt-0.5 text-[15px] font-semibold text-white">160.00</dd>
          </div>
        </dl>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded-b-[14px] border-t border-ink-700 bg-ink-900/60 px-6 py-3 text-[11.5px] text-mist-500">
          <span>
            Terms hash <span className="font-mono text-mist-300">0x9f3a…c21e</span>, accepted v1
          </span>
          <span>funded = released + refunded + held</span>
        </div>
      </div>
      <figcaption className="sr-only">
        An example escrow of 200 MUSD over four milestones: milestone 1 paid (40), milestone 2 in review (60), milestones 3 and 4 held (100), with held funds
        earning the sMUSD savings rate.
      </figcaption>
    </figure>
  );
}
