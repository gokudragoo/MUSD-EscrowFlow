import { z } from "zod";
import { json, parseJson, route } from "@/lib/server/http";
import { setSessionCookie, verifySiwe } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

const schema = z.object({
  message: z.string().min(50).max(4000),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export const POST = route(async (req) => {
  const body = await parseJson(req, schema);
  const address = await verifySiwe(req, body.message, body.signature as `0x${string}`);
  await setSessionCookie(address);
  return json({ address });
});
