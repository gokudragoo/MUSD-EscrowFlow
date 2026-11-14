"use client";

import { use } from "react";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import { PageContainer } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Notice, Panel, Skeleton } from "@/components/ui/primitives";
import { TermsDocumentView } from "@/components/project/terms-document";
import { useProject } from "@/hooks/useProject";
import { compareTermsWithChain } from "@/lib/terms";
import { chainSavingsTerms } from "@/lib/escrow-state";
import { ESCROW_ADDRESS } from "@/config/contracts";
import { explorerAddress } from "@/config/chains";

export default function AgreementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, chain, isLoading } = useProject(id);
  const terms = chain && view?.onchainTerms ? view.onchainTerms : view?.terms;
  const check = chain && view?.onchainTerms ? compareTermsWithChain(view.onchainTerms, chain.project, chain.milestones, chainSavingsTerms(chain)) : null;
  return (
    <PageContainer className="max-w-4xl">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/projects/${id}`} className="inline-flex items-center gap-1.5 text-[13.5px] text-mist-300 hover:text-white">
          <ArrowLeft className="size-4" /> Back to project
        </Link>
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer className="size-4" /> Print or save as PDF
        </Button>
      </div>
      {isLoading && <Skeleton className="h-[600px]" />}
      {!isLoading && !terms && <Notice tone="warning" title="The agreement is visible to participants only" />}
      {terms && (
        <Panel className="print-plain p-6 sm:p-10">
          <TermsDocumentView terms={terms} termsHash={chain?.project.termsHash ?? view?.termsHash} version={chain?.project.termsVersion} />
          <div className="mt-6 border-t border-ink-600 pt-4 font-sans text-[12px] text-mist-400">
            {chain ? (
              <>
                Recorded in EscrowFlow escrow #{chain.id} at{" "}
                <a href={explorerAddress(ESCROW_ADDRESS)} className="font-mono text-signal-300">{ESCROW_ADDRESS}</a> on Mezo Testnet ·{" "}
                {chain.project.acceptedVersion === chain.project.termsVersion ? `accepted by the freelancer (v${chain.project.acceptedVersion})` : "not yet accepted by the freelancer"} ·{" "}
                {check?.ok ? "document matches the on-chain parameters" : "verification pending"}
              </>
            ) : (
              "Draft — not yet recorded on-chain."
            )}
          </div>
        </Panel>
      )}
    </PageContainer>
  );
}
