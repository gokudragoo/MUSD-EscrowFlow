import { json, route } from "@/lib/server/http";
import { issueNonce } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export const GET = route(async () => json({ nonce: await issueNonce() }));
