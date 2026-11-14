import type { NextRequest } from "next/server";
import { z } from "zod";
import type { Hex } from "viem";
import { json, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
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
  // Submission / note records are linked to their committing tx inside the indexer (both this path
  // and the background sync), scoped to the escrow's own project and milestone.
  return json({
    status: v.problems.length ? "mismatch" : "confirmed",
    blockNumber: v.blockNumber.toString(),
    problems: v.problems,
    events: v.events.map((e) => ({ eventName: e.eventName, projectId: e.projectId.toString(), milestoneIndex: e.milestoneIndex, args: e.args, logIndex: e.logIndex })),
  });
});
