import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/gate";
import { PageHeader, Panel } from "@/components/ui/primitives";

const DOCS: Record<string, { title: string; intro: string; sections: [string, string][] }> = {
  terms: {
    title: "Terms of use",
    intro: "These terms govern use of the MUSD EscrowFlow testnet application.",
    sections: [
      ["Testnet only", "EscrowFlow is a demonstration running on Mezo Testnet. It is provided as is, without warranties, and must not be used with assets of real value."],
      ["Non-custodial", "You interact with the EscrowFlow smart contract directly from your own wallet. We never hold your keys or your funds and cannot reverse transactions."],
      ["Your agreements", "Project terms are agreements between the client and the freelancer. EscrowFlow provides software that enforces the payment rules you choose; it is not a party to your agreement and does not arbitrate disputes."],
      ["Acceptable use", "Do not upload unlawful content, malware, or other people's personal documents. We may remove application records that violate these terms. On-chain records cannot be removed."],
    ],
  },
  privacy: {
    title: "Privacy notice",
    intro: "What EscrowFlow stores and why.",
    sections: [
      ["Identity", "Your wallet address is your identity. We do not ask for your name, email or documents. Profile fields are optional and public."],
      ["Project data", "Agreement text, submissions, comments, evidence and attachments are stored in our database and shown only to the project's client, freelancer and arbiter. Open listings are public."],
      ["On-chain data", "Escrow parameters, hashes of agreements and submissions, and all payments are public on the Mezo blockchain and cannot be deleted."],
      ["Cookies", "We set one HttpOnly session cookie after you sign in with your wallet, and your wallet connection state. We use privacy-friendly Vercel analytics without cross-site tracking."],
    ],
  },
  risk: {
    title: "Risk disclosure",
    intro: "Please read before funding or accepting an escrow.",
    sections: [
      ["Irreversible transactions", "Blockchain transactions cannot be undone. A release to the freelancer is final."],
      ["Smart contract risk", "The EscrowFlow contract is extensively tested but not audited. Bugs in the contract, the MUSD token, or the network could cause loss of funds."],
      ["Counterparty risk", "Escrow protects the payment flow, not the quality of the work. A dishonest or unresponsive party can still cause delays or stalemates, especially without an arbiter."],
      ["Test assets", "Test MUSD and test BTC have no guaranteed monetary value and may be reset by the network operators."],
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(DOCS).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: DOCS[slug]?.title ?? "Legal" };
}

export default async function LegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = DOCS[slug];
  if (!doc) notFound();
  return (
    <PageContainer className="max-w-3xl">
      <PageHeader title={doc.title} description={doc.intro} />
      <Panel className="space-y-6 p-6 text-[15px] leading-relaxed text-mist-200">
        {doc.sections.map(([h, b]) => (
          <section key={h}>
            <h2 className="text-[17px] font-semibold text-white">{h}</h2>
            <p className="mt-1.5">{b}</p>
          </section>
        ))}
        <p className="text-[13px] text-mist-500">Last updated 26 October 2026.</p>
      </Panel>
    </PageContainer>
  );
}
