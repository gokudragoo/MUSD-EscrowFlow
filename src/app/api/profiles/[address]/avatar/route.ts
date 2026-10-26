import { isAddress } from "viem";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { one } from "@/lib/server/db";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address)) return new NextResponse("Not found", { status: 404 });
  const row = await one<{ avatar_mime: string | null; avatar_data: Buffer | null }>(
    `select avatar_mime, avatar_data from escrowflow.profiles where address = $1`,
    [address.toLowerCase()],
  );
  if (!row?.avatar_data || !row.avatar_mime) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(row.avatar_data), {
    headers: {
      "content-type": row.avatar_mime,
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
    },
  });
}
