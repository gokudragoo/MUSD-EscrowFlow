import { json } from "@/lib/server/http";
import { sql } from "@/lib/server/db";
import { serverClient } from "@/lib/server/chain";
import { ESCROW_ADDRESS, isEscrowDeployed } from "@/config/contracts";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const [db, rpc] = await Promise.allSettled([
    sql()`select 1 as ok`,
    Promise.all([serverClient.getChainId(), serverClient.getBlockNumber()]),
  ]);
  const rpcOk = rpc.status === "fulfilled";
  const body = {
    db: db.status === "fulfilled" ? "ok" : "error",
    rpc: rpcOk ? "ok" : "error",
    chainId: rpcOk ? rpc.value[0] : null,
    blockNumber: rpcOk ? rpc.value[1].toString() : null,
    escrowContract: isEscrowDeployed() ? ESCROW_ADDRESS : null,
    time: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
  const healthy = body.db === "ok" && body.rpc === "ok";
  return json(body, { status: healthy ? 200 : 503 });
}
