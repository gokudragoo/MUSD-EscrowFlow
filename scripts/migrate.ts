/**
 * Runs idempotent SQL migrations in db/migrations against DATABASE_URL (Neon).
 *   npm run db:migrate          (reads .env.local if DATABASE_URL is not already set)
 * Only touches schema `escrowflow`.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

function loadEnvLocal() {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

/** Split on semicolons that end a statement (our migrations contain no functions/DO blocks). */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);
}

async function main() {
  loadEnvLocal();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url });
  const dir = path.resolve(__dirname, "..", "db", "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  try {
    for (const f of files) {
      const stmts = statements(readFileSync(path.join(dir, f), "utf8"));
      for (const s of stmts) {
        if (!/escrowflow/i.test(s)) throw new Error(`Refusing statement outside schema escrowflow in ${f}: ${s.slice(0, 80)}`);
        await pool.query(s);
      }
      console.log(`applied ${f} (${stmts.length} statements)`);
    }
    const { rows } = await pool.query(
      "select table_name from information_schema.tables where table_schema = 'escrowflow' order by table_name",
    );
    console.log(`schema escrowflow tables: ${rows.map((r) => r.table_name).join(", ")}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
