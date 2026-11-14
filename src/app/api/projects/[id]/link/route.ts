import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAddress, type Hex } from "viem";
import { badRequest, conflict, forbidden, json, notFound, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { one, query } from "@/lib/server/db";
import { readProject } from "@/lib/server/chain";
import { getProjectRow, revisionForHash } from "@/lib/server/projects";
import { ingestEvents, verifyEscrowTx } from "@/lib/server/indexer";
import { audit } from "@/lib/server/records";
import { compareTermsWithChain } from "@/lib/terms";
import { chainSavingsTerms } from "@/lib/escrow-state";
import { txHashSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Links an off-chain agreement to its on-chain escrow after a createProject / updateTerms tx.
 * Verified server-side: receipt success, sent to EscrowFlow, ProjectCreated/TermsSet emitted by
 * this client, and the committed terms hash + parameters match a stored revision exactly.
 */
export const POST = route(async (req: NextRequest, ctx: Ctx) => {
  const { id } = await ctx.params;
  const s = await requireSession();
  const { txHash } = await parseJson(req, z.object({ txHash: txHashSchema }));
  const row = await getProjectRow(id);
  if (!row) throw notFound("Project not found");
  if (row.client_address !== s.address.toLowerCase()) throw forbidden("Only the client can link the escrow");

  const v = await verifyEscrowTx(txHash as Hex, { ingest: false });
  if (v.status === "pending") return json({ status: "pending", message: "Transaction not confirmed yet — verification delayed" }, { status: 202 });
  if (v.status === "failed") throw badRequest("The transaction reverted on-chain");
  if (v.status === "rejected") throw badRequest(v.reason);

  const created = v.events.find((e) => e.eventName === "ProjectCreated");
  const termsSet = v.events.find((e) => e.eventName === "TermsSet");
  if (!termsSet) throw badRequest("Transaction did not record terms");
  const chainId = termsSet.projectId;

  if (row.chain_project_id && BigInt(row.chain_project_id) !== chainId) throw conflict("This draft is already linked to another escrow");
  if (!row.chain_project_id && !created) throw badRequest("Expected a createProject transaction");
  if (created && getAddress(created.args.client as string) !== s.address) throw forbidden("The escrow was created by a different wallet");

  const snap = await readProject(chainId);
  if (!snap) throw badRequest("Escrow not found on-chain");
  if (snap.project.client !== s.address) throw forbidden("You are not the client of this escrow");

  const committedHash = String(termsSet.args.termsHash);
  const rev = await revisionForHash(id, committedHash);
  if (!rev) throw badRequest("The on-chain terms hash does not match any saved revision of this agreement");
  const check = compareTermsWithChain(rev.terms, snap.project, snap.milestones, chainSavingsTerms(snap));
  // If terms were edited again after this tx, the latest on-chain hash may differ — only check the committed one.
  if (snap.project.termsHash.toLowerCase() === committedHash.toLowerCase() && !check.ok) {
    throw badRequest(`On-chain parameters differ from the agreement: ${check.mismatches.join("; ")}`);
  }

  const taken = await one<{ id: string }>(`select id from escrowflow.projects where chain_project_id = $1 and id <> $2`, [chainId.toString(), id]);
  if (taken) throw conflict("That escrow is already linked to another agreement");

  await query(
    `update escrowflow.projects set chain_project_id = $2, create_tx_hash = coalesce(create_tx_hash, $3),
       freelancer_address = $4, listing_status = case when listing_status = 'open' then 'closed' else listing_status end, updated_at = now()
     where id = $1`,
    [id, chainId.toString(), created ? txHash.toLowerCase() : null, snap.project.freelancer.toLowerCase()],
  );
  await audit(id, s.address, created ? "escrow_linked" : "terms_committed", {
    title: created ? "Agreement linked to on-chain escrow" : `Terms version ${termsSet.args.version} committed on-chain`,
    summary: `Escrow #${chainId} · terms hash ${committedHash.slice(0, 10)}… verified against revision ${rev.revision}`,
  });
  await ingestEvents(v.events);
  return json({ status: "confirmed", chainProjectId: chainId.toString(), revision: rev.revision, termsVersion: Number(termsSet.args.version) });
});
