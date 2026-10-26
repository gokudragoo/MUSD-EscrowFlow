import "server-only";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { getAddress, type Address, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { serverEnv } from "./env";
import { one, query } from "./db";
import { badRequest, requestOrigin, unauthorized } from "./http";
import { serverClient } from "./chain";
import { SUPPORTED_CHAIN_ID } from "@/config/chains";

export const SESSION_COOKIE = "ef_session";
const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const NONCE_TTL_MINUTES = 10;

export interface Session {
  address: Address;
}

export async function issueNonce(): Promise<string> {
  const nonce = generateSiweNonce();
  await query(
    `insert into escrowflow.siwe_nonces (nonce, expires_at) values ($1, now() + interval '${NONCE_TTL_MINUTES} minutes')`,
    [nonce],
  );
  // Opportunistic cleanup of stale nonces.
  await query(`delete from escrowflow.siwe_nonces where expires_at < now() - interval '1 day'`);
  return nonce;
}

/**
 * Verifies an EIP-4361 message + signature: our domain/origin, Mezo testnet chain id, fresh
 * timestamps, and a single-use server nonce (consumed atomically). Returns the signer.
 */
export async function verifySiwe(req: NextRequest, message: string, signature: Hex): Promise<Address> {
  let parsed: ReturnType<typeof parseSiweMessage>;
  try {
    parsed = parseSiweMessage(message);
  } catch {
    throw badRequest("Malformed sign-in message");
  }
  const { host, origin } = requestOrigin(req);
  if (!parsed.address || !parsed.nonce) throw badRequest("Sign-in message is missing fields");
  if (parsed.domain !== host) throw badRequest("Sign-in message was created for a different site");
  if (!parsed.uri || new URL(parsed.uri).origin !== origin) throw badRequest("Sign-in message URI does not match this site");
  if (parsed.chainId !== SUPPORTED_CHAIN_ID) throw badRequest("Sign-in message must target Mezo Testnet (31611)");
  const now = new Date();
  if (!parsed.issuedAt || Math.abs(now.getTime() - parsed.issuedAt.getTime()) > NONCE_TTL_MINUTES * 60_000) {
    throw badRequest("Sign-in message is too old; request a new one");
  }
  if (!validateSiweMessage({ message: parsed, domain: host, time: now })) {
    throw badRequest("Sign-in message is expired or not yet valid");
  }

  const valid = await serverClient.verifySiweMessage({ message, signature, domain: host, time: now }).catch(() => false);
  if (!valid) throw unauthorized("Signature does not match the sign-in message");

  const consumed = await one<{ nonce: string }>(
    `update escrowflow.siwe_nonces set used_at = now()
       where nonce = $1 and used_at is null and expires_at > now()
       returning nonce`,
    [parsed.nonce],
  );
  if (!consumed) throw unauthorized("This sign-in request was already used or has expired");

  const address = getAddress(parsed.address);
  await query(
    `insert into escrowflow.users (address, last_login_at) values ($1, now())
       on conflict (address) do update set last_login_at = now()`,
    [address.toLowerCase()],
  );
  return address;
}

export async function createSessionToken(address: Address): Promise<string> {
  return new SignJWT({ addr: address })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(address.toLowerCase())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .setIssuer("musd-escrowflow")
    .sign(serverEnv.sessionSecret());
}

export async function setSessionCookie(address: Address) {
  const token = await createSessionToken(address);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: serverEnv.isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { httpOnly: true, secure: serverEnv.isProduction(), sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, serverEnv.sessionSecret(), { issuer: "musd-escrowflow", algorithms: ["HS256"] });
    if (typeof payload.addr !== "string") return null;
    return { address: getAddress(payload.addr) };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw unauthorized();
  return s;
}
