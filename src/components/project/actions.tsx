"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, FileCheck2, Gavel, Handshake, PiggyBank, RotateCcw, Scale, ShieldAlert, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlays";
import { Field, Input, Notice, Textarea } from "@/components/ui/primitives";
import { Amount, TxLink } from "@/components/ui/chain";
import { useEscrowTx } from "@/hooks/useEscrowTx";
import { api } from "@/lib/client/api";
import type { ChainView, ProjectViewJson } from "@/lib/client/types";
import { compareTermsWithChain, hashTerms, savingsOf, termsToParams } from "@/lib/terms";
import { MilestoneStatus, cancellationRefundPreview, chainSavingsTerms, milestoneActions, projectActions, reviewDeadlineOf, roleOf, splitYield, type ActionState } from "@/lib/escrow-state";
import { formatMusd, toDecimalString, tryParseMusd } from "@/lib/money";
import { countdown, formatDate } from "@/lib/utils";

const nowSec = () => Math.floor(Date.now() / 1000);

const pendingKey = (projectId: string) => `ef:create-tx:${projectId}`;
const readPending = (projectId: string): `0x${string}` | null => {
  try {
    const v = localStorage.getItem(pendingKey(projectId));
    return v && /^0x[0-9a-f]{64}$/i.test(v) ? (v as `0x${string}`) : null;
  } catch {
    return null;
  }
};
const writePending = (projectId: string, hash: string | null) => {
  try {
    if (hash) localStorage.setItem(pendingKey(projectId), hash);
    else localStorage.removeItem(pendingKey(projectId));
  } catch {
    // storage unavailable: the indexer still auto-links by terms hash
  }
};

/** Polls /link until the server has verified the createProject / updateTerms receipt. */
async function linkEscrow(projectId: string, hash: string): Promise<"confirmed" | "pending" | "error"> {
  for (let i = 0; i < 8; i++) {
    try {
      const res = await api<{ status: string }>(`/api/projects/${projectId}/link`, { method: "POST", json: { txHash: hash } });
      if (res.status === "confirmed") return "confirmed";
    } catch (e) {
      toast.error("Escrow created but linking failed", { description: e instanceof Error ? e.message : String(e) });
      return "error";
    }
    await new Promise((r) => setTimeout(r, 2000 + i * 500));
  }
  return "pending";
}

/** Client: create the escrow on-chain from the saved terms, then link it server-side (verified). */
export function CreateEscrowButton({ view, onDone }: { view: ProjectViewJson; onDone?: () => void }) {
  const tx = useEscrowTx();
  const qc = useQueryClient();
  const [linking, setLinking] = useState(false);
  // Project data loads client-side, so reading localStorage in the initializer is hydration-safe.
  const [pending, setPending] = useState<`0x${string}` | null>(() => readPending(view.project.id));
  const terms = view.terms;
  if (!terms) return null;
  const missingFreelancer = /^0x0{40}$/i.test(terms.freelancer);
  const deadlinesPassed = terms.milestones.some((m) => m.deadline <= nowSec());
  const finish = async (hash: string) => {
    setLinking(true);
    const status = await linkEscrow(view.project.id, hash);
    setLinking(false);
    if (status === "confirmed") {
      writePending(view.project.id, null);
      setPending(null);
      toast.success("Escrow created and linked", { description: "Share the invite link so the freelancer can review and accept the terms." });
      onDone?.();
    } else if (status === "pending") {
      toast.message("Escrow sent; linking will finish automatically", { description: "The app links it as soon as the network confirms the transaction." });
    }
    await qc.invalidateQueries();
  };
  if (pending) {
    // A createProject tx was already sent for this draft: offer to finish linking, never a second escrow.
    return (
      <div className="space-y-2">
        <Notice tone="warning" title="An escrow creation is already on its way">
          Transaction <TxLink hash={pending} /> was sent for this agreement. Wait for it to confirm instead of creating a second escrow.
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button loading={linking} onClick={() => finish(pending)}>
            Check and link it
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              writePending(view.project.id, null);
              setPending(null);
            }}
          >
            It failed, start over
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Button
        size="lg"
        disabled={missingFreelancer || deadlinesPassed}
        loading={tx.busy || linking}
        onClick={async () => {
          const params = termsToParams(terms);
          const r = await tx.run({ label: "Create escrow", functionName: "createProject", args: [params], escrowFn: "createProject", milestoneCount: terms.milestones.length, verify: false });
          if (!r) return;
          writePending(view.project.id, r.hash);
          setPending(r.hash);
          await finish(r.hash);
        }}
      >
        <FileCheck2 className="size-4" aria-hidden /> Create escrow on-chain
      </Button>
      {missingFreelancer && <p className="text-[12.5px] text-mist-400">Select a freelancer from the applications first.</p>}
      {deadlinesPassed && <p className="text-[12.5px] text-warn-300">A milestone deadline is in the past. Edit the terms first.</p>}
    </div>
  );
}

/** Client: commit an edited terms revision with updateTerms (resets acceptance). */
export function CommitTermsButton({ view, chainId }: { view: ProjectViewJson; chainId: bigint }) {
  const tx = useEscrowTx();
  const qc = useQueryClient();
  const terms = view.terms!;
  return (
    <Button
      loading={tx.busy}
      onClick={async () => {
        const r = await tx.run({ label: "Commit new terms", functionName: "updateTerms", args: [chainId, termsToParams(terms)], escrowFn: "updateTerms", milestoneCount: terms.milestones.length, verify: false });
        if (!r) return;
        const status = await linkEscrow(view.project.id, r.hash);
        if (status === "pending") toast.message("Terms sent; the app will record them once the network confirms.");
        await qc.invalidateQueries();
      }}
    >
      Commit terms revision on-chain
    </Button>
  );
}

/** Freelancer: verify the document against the chain, then accept the exact hash + version. */
export function AcceptTermsPanel({ view, chain }: { view: ProjectViewJson; chain: ChainView }) {
  const tx = useEscrowTx();
  const [confirm, setConfirm] = useState(false);
  const doc = view.onchainTerms;
  const check = doc ? compareTermsWithChain(doc, chain.project, chain.milestones, chainSavingsTerms(chain)) : null;
  const savings = doc ? savingsOf(doc) : null;
  const localHash = doc ? hashTerms(doc) : null;
  const ok = !!check?.ok && localHash?.toLowerCase() === chain.project.termsHash.toLowerCase();
  return (
    <div className="space-y-3">
      {ok ? (
        <Notice tone="success" icon={<CheckCircle2 className="size-4" />} title="Terms verified in your browser">
          The agreement text hashes to the value stored in the contract, and every amount, deadline, review period and rule matches the on-chain escrow.
        </Notice>
      ) : (
        <Notice tone="danger" icon={<XCircle className="size-4" />} title="Do not accept: the document does not match the contract">
          {check?.mismatches.join(" · ") ?? "No agreement document matches the on-chain hash."}
        </Notice>
      )}
      <Button size="lg" disabled={!ok} loading={tx.busy} onClick={() => setConfirm(true)}>
        <Handshake className="size-4" aria-hidden /> Accept terms (version {chain.project.termsVersion})
      </Button>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Accept these terms?"
        description="Accepting records your agreement on-chain. The client can then fund the escrow. If the client edits anything before funding, your acceptance is reset automatically."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              loading={tx.busy}
              onClick={async () => {
                const r = await tx.run({
                  label: "Accept terms",
                  functionName: "acceptTerms",
                  args: [BigInt(chain.id), chain.project.termsHash, chain.project.termsVersion],
                  escrowFn: "acceptTerms",
                });
                if (r) setConfirm(false);
              }}
            >
              Sign and accept
            </Button>
          </>
        }
      >
        <dl className="space-y-1 text-[13.5px]">
          <div className="flex justify-between">
            <dt className="text-mist-400">Total</dt>
            <dd>
              <Amount wei={chain.project.totalAmount} />
            </dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mist-400">Milestones</dt>
            <dd>{chain.project.milestoneCount}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mist-400">Auto-release after review</dt>
            <dd>{chain.project.autoRelease ? "Yes" : "No"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mist-400">Client deadline reclaim</dt>
            <dd>{chain.project.deadlineReclaim ? "Yes" : "No"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mist-400">sMUSD savings while held</dt>
            <dd>{savings?.enabled ? `On · ${savings.freelancerShareBps / 100}% of yield to you` : "Off"}</dd>
          </div>
        </dl>
      </Dialog>
    </div>
  );
}

export function SimpleTxButton({
  label,
  fn,
  args,
  variant = "secondary",
  confirmTitle,
  confirmBody,
  milestoneCount,
  icon,
  size = "md",
}: {
  label: string;
  fn: Parameters<ReturnType<typeof useEscrowTx>["run"]>[0]["escrowFn"] & string;
  args: readonly unknown[];
  variant?: "primary" | "secondary" | "danger" | "outline" | "release";
  confirmTitle?: string;
  confirmBody?: React.ReactNode;
  milestoneCount?: number;
  icon?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const tx = useEscrowTx();
  const [open, setOpen] = useState(false);
  const exec = async () => {
    const r = await tx.run({ label, functionName: fn, args, escrowFn: fn, milestoneCount });
    if (r) setOpen(false);
  };
  return (
    <>
      <Button variant={variant} size={size} loading={tx.busy} onClick={() => (confirmTitle ? setOpen(true) : exec())}>
        {icon}
        {label}
      </Button>
      {confirmTitle && (
        <Dialog
          open={open}
          onOpenChange={setOpen}
          title={confirmTitle}
          description={confirmBody}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant={variant === "secondary" || variant === "outline" ? "primary" : variant} loading={tx.busy} onClick={exec}>
                {label}
              </Button>
            </>
          }
        />
      )}
    </>
  );
}

/** Mutual cancellation of a funded escrow, with an exact refund preview. */
export function CancellationPanel({ chain, who }: { chain: ChainView; who?: string }) {
  const now = nowSec();
  const pa = projectActions(chain.project, who, chain.milestones, now);
  const preview = cancellationRefundPreview(chain.milestones);
  const id = BigInt(chain.id);
  // v2 asks for the exact refund we showed, so nothing can change between review and signature.
  const acceptArgs = chain.version === 2 ? [id, preview.refund] : [id];
  const vested = chain.project.autoRelease
    ? chain.milestones.flatMap((m, i) => (m.status === MilestoneStatus.Submitted && now >= reviewDeadlineOf(m) ? [i] : []))
    : [];
  const isFreelancer = roleOf(chain.project, who) === "freelancer";
  const body = (
    <span>
      {preview.indexes.length > 0 ? (
        <>
          Milestones {preview.indexes.map((i) => i + 1).join(", ")} would be refunded to the client: <strong className="text-white">{formatMusd(preview.refund)} MUSD</strong>. Paid
          milestones stay paid; disputed milestones stay frozen until resolved.
        </>
      ) : (
        "No unpaid, undisputed milestones remain, so nothing would be refunded."
      )}
      {isFreelancer && vested.length > 0 && (
        <span className="mt-2 block text-warn-300">
          Milestone {vested.map((i) => i + 1).join(", ")} can already be claimed after the unanswered review period. Claim it first: a cancellation would refund it to the client.
        </span>
      )}
    </span>
  );
  if (!pa.proposeCancellation.available && !pa.acceptCancellation.available && !pa.revokeCancellation.available) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pa.acceptCancellation.available && (
        <SimpleTxButton label="Accept cancellation" fn="acceptCancellation" args={acceptArgs} variant="danger" milestoneCount={chain.milestones.length} confirmTitle="Accept the cancellation?" confirmBody={body} icon={<XCircle className="size-4" />} />
      )}
      {pa.revokeCancellation.available && <SimpleTxButton label="Withdraw cancellation proposal" fn="revokeCancellation" args={[id]} variant="outline" icon={<Undo2 className="size-4" />} />}
      {pa.proposeCancellation.available && !pa.revokeCancellation.available && !pa.acceptCancellation.available && (
        <SimpleTxButton
          label="Propose cancellation"
          fn="proposeCancellation"
          args={[id]}
          variant="outline"
          confirmTitle="Propose a mutual cancellation?"
          confirmBody={<span>Nothing moves until the other party accepts. If they accept: {body}</span>}
          icon={<XCircle className="size-4" />}
        />
      )}
    </div>
  );
}

function Why({ state }: { state: ActionState }) {
  if (state.available || !state.reason) return null;
  return (
    <p className="text-[12.5px] text-mist-500">
      {state.reason}
      {state.availableAt ? ` (in ${countdown(state.availableAt)}, ${formatDate(state.availableAt, true)})` : ""}
    </p>
  );
}

/**
 * Every milestone-level on-chain action, gated by the same rules the contract enforces.
 * Notes (change requests, dispute reasons) are stored first; their hash is committed in the tx.
 */
export function MilestoneActionBar({ view, chain, index, who, compact }: { view: ProjectViewJson; chain: ChainView; index: number; who?: string; compact?: boolean }) {
  const m = chain.milestones[index];
  const a = milestoneActions(chain.project, m, who, nowSec());
  const id = BigInt(chain.id);
  const tx = useEscrowTx();
  const qc = useQueryClient();
  const [dlg, setDlg] = useState<null | "approve" | "changes" | "dispute" | "propose" | "arbiter">(null);
  const [note, setNote] = useState("");
  const [savedNote, setSavedNote] = useState<{ kind: string; body: string; hash: `0x${string}` } | null>(null);
  const [split, setSplit] = useState("");
  const base = `/projects/${view.project.id}/milestones/${index}`;
  const title = view.terms?.milestones[index]?.title ?? `Milestone ${index + 1}`;

  const withNote = async (kind: "change_request" | "dispute", fn: "requestChanges" | "openDispute") => {
    if (note.trim().length < 3) {
      toast.error("Write a short explanation first");
      return;
    }
    try {
      let hash = savedNote && savedNote.kind === kind && savedNote.body === note ? savedNote.hash : null;
      if (!hash) {
        const res = await api<{ noteHash: `0x${string}` }>(`/api/projects/${view.project.id}/notes`, { method: "POST", json: { kind, milestoneIndex: index, body: note, links: [] } });
        hash = res.noteHash;
        setSavedNote({ kind, body: note, hash });
      }
      const r = await tx.run({ label: fn === "requestChanges" ? "Request changes" : "Open dispute", functionName: fn, args: [id, BigInt(index), hash], escrowFn: fn });
      if (r) {
        setDlg(null);
        setNote("");
        setSavedNote(null);
        await qc.invalidateQueries();
      }
    } catch (e) {
      toast.error("Could not save the note", { description: e instanceof Error ? e.message : String(e) });
    }
  };

  const splitWei = tryParseMusd(split);
  const splitValid = splitWei !== null && splitWei <= m.amount;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {a.submit.available && (
          <Link href={`${base}/submit`}>
            <Button size={compact ? "sm" : "md"}>{m.revision > 0 ? "Submit revision" : "Submit work"}</Button>
          </Link>
        )}
        {a.approve.available && (
          <Button size={compact ? "sm" : "md"} variant="release" onClick={() => setDlg("approve")}>
            <CheckCircle2 className="size-4" aria-hidden /> Approve and release
          </Button>
        )}
        {a.requestChanges.available && (
          <Button size={compact ? "sm" : "md"} variant="outline" onClick={() => setDlg("changes")}>
            <RotateCcw className="size-4" aria-hidden /> Request changes
          </Button>
        )}
        {a.claimTimeout.available && (
          <SimpleTxButton
            size={compact ? "sm" : "md"}
            label="Claim payment"
            fn="claimAfterReviewTimeout"
            args={[id, BigInt(index)]}
            variant="release"
            confirmTitle="Claim this milestone?"
            confirmBody="The agreed review period has passed with no approval, change request or dispute. The contract will release this milestone to your wallet."
          />
        )}
        {a.reclaim.available && (
          <SimpleTxButton
            size={compact ? "sm" : "md"}
            label="Reclaim milestone"
            fn="reclaimExpiredMilestone"
            args={[id, BigInt(index)]}
            variant="danger"
            confirmTitle="Reclaim this milestone's funds?"
            confirmBody="The deadline and grace period passed without a live submission. The contract will return this milestone's MUSD to your wallet. This cannot be undone."
          />
        )}
        {a.acceptSettlement.available && (
          <SimpleTxButton
            size={compact ? "sm" : "md"}
            label={`Accept split: ${formatMusd(m.proposedFreelancerAmount)} to freelancer`}
            fn="acceptSettlement"
            args={[id, BigInt(index), m.proposedFreelancerAmount]}
            variant="primary"
            confirmTitle="Accept this settlement?"
            confirmBody={`${formatMusd(m.proposedFreelancerAmount)} MUSD goes to the freelancer and ${formatMusd(m.amount - m.proposedFreelancerAmount)} MUSD returns to the client. Both transfers happen in this transaction.`}
            icon={<Handshake className="size-4" />}
          />
        )}
        {a.proposeSettlement.available && (
          <Button size={compact ? "sm" : "md"} variant="outline" onClick={() => setDlg("propose")}>
            <Scale className="size-4" aria-hidden /> {m.settlementProposer !== "0x0000000000000000000000000000000000000000" ? "Counter-propose split" : "Propose a split"}
          </Button>
        )}
        {a.arbiterResolve.available && (
          <Button size={compact ? "sm" : "md"} onClick={() => setDlg("arbiter")}>
            <Gavel className="size-4" aria-hidden /> Rule on dispute
          </Button>
        )}
        {a.withdrawDispute.available && (
          <SimpleTxButton size={compact ? "sm" : "md"} label="Withdraw dispute" fn="withdrawDispute" args={[id, BigInt(index)]} variant="outline" confirmTitle="Withdraw your dispute?" confirmBody="The milestone returns to its previous state. Its review window, deadline and grace period resume where they paused when the dispute opened." />
        )}
        {a.openDispute.available && !compact && (
          <Button variant="danger" onClick={() => setDlg("dispute")}>
            <ShieldAlert className="size-4" aria-hidden /> Open dispute
          </Button>
        )}
      </div>
      {!compact && (who === chain.project.freelancer ? <Why state={a.claimTimeout} /> : <Why state={a.reclaim} />)}

      <Dialog
        open={dlg === "approve"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={`Approve M${index + 1} and release payment?`}
        description="This sends a transaction that transfers the milestone amount from escrow to the freelancer. Released payments cannot be reversed."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button
              variant="release"
              loading={tx.busy}
              onClick={async () => {
                const r = await tx.run({ label: `Release M${index + 1}`, functionName: "approveAndRelease", args: [id, BigInt(index)], escrowFn: "approveAndRelease", successMessage: `Payment released: ${formatMusd(m.amount)} MUSD` });
                if (r) setDlg(null);
              }}
            >
              Release <Amount wei={m.amount} />
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-mist-300">
          <strong className="text-white">{title}</strong>, paid to {chain.project.freelancer.slice(0, 10)}…
        </p>
        {tx.busy && <p className="mt-2 text-[13px] text-signal-300">Approved. Payment pending until the network confirms the release.</p>}
      </Dialog>

      <Dialog
        open={dlg === "changes" || dlg === "dispute"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg === "changes" ? `Request changes on M${index + 1}` : `Open a dispute on M${index + 1}`}
        description={
          dlg === "changes"
            ? "Explain which acceptance criteria are not met yet. Your note is stored privately; its hash is recorded on-chain with the request."
            : "A dispute freezes this milestone's funds until you agree a split with the other party" + (chain.project.arbiter !== "0x0000000000000000000000000000000000000000" ? " or the arbiter rules." : ".")
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button variant={dlg === "dispute" ? "danger" : "primary"} loading={tx.busy} onClick={() => withNote(dlg === "changes" ? "change_request" : "dispute", dlg === "changes" ? "requestChanges" : "openDispute")}>
              {dlg === "changes" ? "Send change request" : "Open dispute"}
            </Button>
          </>
        }
      >
        <Field label={dlg === "changes" ? "What needs to change" : "Reason for the dispute"} htmlFor="note">
          <Textarea id="note" rows={5} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {view.terms?.milestones[index]?.acceptanceCriteria?.length ? (
          <div className="mt-3 text-[12.5px] text-mist-400">
            Acceptance criteria: {view.terms.milestones[index].acceptanceCriteria.join(" · ")}
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={dlg === "propose" || dlg === "arbiter"}
        onOpenChange={(o) => !o && setDlg(null)}
        title={dlg === "arbiter" ? "Rule on this dispute" : "Propose a split"}
        description={`Milestone amount: ${formatMusd(m.amount)} MUSD. Enter how much goes to the freelancer; the rest returns to the client.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDlg(null)}>
              Cancel
            </Button>
            <Button
              disabled={!splitValid}
              loading={tx.busy}
              onClick={async () => {
                const fn = dlg === "arbiter" ? "arbiterResolve" : "proposeSettlement";
                const r = await tx.run({ label: dlg === "arbiter" ? "Arbiter ruling" : "Propose split", functionName: fn, args: [id, BigInt(index), splitWei!], escrowFn: fn });
                if (r) setDlg(null);
              }}
            >
              {dlg === "arbiter" ? "Submit ruling" : "Send proposal"}
            </Button>
          </>
        }
      >
        <Field label="To the freelancer (MUSD)" htmlFor="split" error={split && !splitValid ? "Must be between 0 and the milestone amount" : null}>
          <Input id="split" inputMode="decimal" value={split} onChange={(e) => setSplit(e.target.value)} placeholder={toDecimalString(m.amount / 2n)} className="amount" />
        </Field>
        <div className="mt-2 flex gap-2">
          {[0, 50, 100].map((pct) => (
            <Button key={pct} size="sm" variant="secondary" onClick={() => setSplit(toDecimalString((m.amount * BigInt(pct)) / 100n))}>
              {pct}%
            </Button>
          ))}
        </div>
        {splitValid && (
          <p className="mt-3 text-[13px] text-mist-300">
            Freelancer receives <strong className="text-white">{formatMusd(splitWei!)}</strong> MUSD · client receives{" "}
            <strong className="text-white">{formatMusd(m.amount - splitWei!)}</strong> MUSD
          </p>
        )}
      </Dialog>
    </div>
  );
}

/**
 * v2 escrows that opted in park the held budget in Mezo's sMUSD savings vault (MUSDSavingsRate).
 * Principal is withdrawn 1:1 for every payout; the yield it earned is split by the agreed share.
 */
export function SavingsPanel({ chain, who }: { chain: ChainView; who?: string }) {
  const y = chain.yield;
  if (chain.version !== 2 || !y?.enabled) return null;
  const role = roleOf(chain.project, who);
  const canDistribute = (role === "client" || role === "freelancer") && y.accrued > 0n;
  const split = splitYield(y.accrued, y.freelancerBps);
  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-ink-700 bg-ink-700 sm:grid-cols-3">
        <div className="bg-ink-850 px-4 py-3">
          <dt className="text-[12px] text-mist-400">In sMUSD now</dt>
          <dd className="mt-1 text-[17px] font-semibold text-white">
            <Amount wei={y.principal} />
          </dd>
        </div>
        <div className="bg-ink-850 px-4 py-3">
          <dt className="text-[12px] text-mist-400">Yield earned, unpaid</dt>
          <dd className="mt-1 text-[17px] font-semibold text-signal-300">
            <Amount wei={y.accrued} decimals={6} />
          </dd>
        </div>
        <div className="col-span-2 bg-ink-850 px-4 py-3 sm:col-span-1">
          <dt className="text-[12px] text-mist-400">Yield paid out</dt>
          <dd className="mt-1 text-[17px] font-semibold text-white">
            <Amount wei={y.paid} decimals={6} />
          </dd>
        </div>
      </dl>
      <p className="text-[12.5px] leading-relaxed text-mist-400">
        Agreed split: {y.freelancerBps / 100}% of the yield to the freelancer, {(10_000 - y.freelancerBps) / 100}% to the client. The rate comes from Mezo&apos;s
        MUSDSavingsRate vault and can be zero on testnet; the principal is always withdrawn 1:1 for payouts and refunds.
      </p>
      {canDistribute && (
        <SimpleTxButton
          label="Pay out yield"
          fn="distributeYield"
          args={[BigInt(chain.id)]}
          variant="secondary"
          icon={<PiggyBank className="size-4" />}
          confirmTitle="Pay out the savings yield?"
          confirmBody={`About ${formatMusd(split.freelancer, { maxDecimals: 6 })} MUSD to the freelancer and ${formatMusd(split.client, { maxDecimals: 6 })} MUSD to the client (exact amounts are measured when the transaction runs).`}
        />
      )}
    </div>
  );
}
