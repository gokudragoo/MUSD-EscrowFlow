import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const serverEnv = {
  databaseUrl: () => required("DATABASE_URL"),
  sessionSecret: () => {
    const s = required("SESSION_SECRET");
    if (s.length < 32) throw new Error("SESSION_SECRET is too short");
    return new TextEncoder().encode(s);
  },
  cronSecret: () => process.env.CRON_SECRET ?? "",
  rpcUrl: () => process.env.MEZO_RPC_URL ?? "https://rpc.test.mezo.org",
  isProduction: () => process.env.NODE_ENV === "production",
};
