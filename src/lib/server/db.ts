import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { serverEnv } from "./env";

let _sql: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP driver (works in Vercel functions). Use tagged templates: await sql`select ...`. */
export function sql() {
  if (!_sql) _sql = neon(serverEnv.databaseUrl());
  return _sql;
}

/** Parameterised query helper for dynamic SQL. */
export async function query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await sql().query(text, params);
  return rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/** Runs several statements atomically (Neon HTTP transaction). */
export async function transaction(statements: { text: string; params?: unknown[] }[]) {
  const s = sql();
  return s.transaction(statements.map((st) => s.query(st.text, st.params ?? [])));
}
