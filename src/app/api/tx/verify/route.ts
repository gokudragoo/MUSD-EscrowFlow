import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Hex } from "viem";
import { json, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { verifyEscrowTx } from "@/lib/server/indexer";
import { txHashSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

/**
 * Verifies an EscrowFlow transaction server-side (receipt, contract, events, exact MUSD transfers),
 * stores its events, and links submission / note records to the tx that committed their hash.
 */
export const POST = route(async (req: NextRequest) => {
  await requireSession();
  const { txHash } = await parseJson(req, z.object({ txHash: txHashSchema }));
  const v = await verifyEscrowTx(txHash as Hex);
  if (v.status === "pending") return json({ status: "pending", message: "Not confirmed yet — verification delayed, retry shortly" }, { status: 202 });
  if (v.status === "failed") return json({ status: "failed", blockNumber: v.blockNumber.toString() }, { status: 200 });
  if (v.status === "rejected") return json({ status: "rejected", reason: v.reason }, { status: 400 });
  for (const e of v.events) {
    if (e.eventName === "MilestoneSubmitted") {
      await query(`update escrowflow.submissions set tx_hash = $1 where lower(submission_hash) = lower($2) and tx_hash is null`, [
        txHash.toLowerCase(),
        String(e.args.submissionHash),
      ]);
    }
    if (e.eventName === "ChangesRequested" || e.eventName === "DisputeOpened") {
      await query(`update escrowflow.comments set tx_hash = $1 where lower(note_hash) = lower($2) and tx_hash is null`, [
        txHash.toLowerCase(),
        String(e.args.reasonHash),
      ]);
    }
  }
  return json({
    status: v.problems.length ? "mismatch" : "confirmed",
    blockNumber: v.blockNumber.toString(),
    problems: v.problems,
    events: v.events.map((e) => ({ eventName: e.eventName, projectId: e.projectId.toString(), milestoneIndex: e.milestoneIndex, args: e.args, logIndex: e.logIndex })),
  });
});
