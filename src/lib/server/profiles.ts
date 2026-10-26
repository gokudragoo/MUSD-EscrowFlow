import "server-only";
import { getAddress, type Address } from "viem";
import { one, query } from "./db";
import { projectIdsFor, readProjects } from "./chain";
import { ProjectStatus } from "@/lib/escrow-state";

export interface ProfileRow {
  address: string;
  display_name: string;
  role: "client" | "freelancer" | "both";
  headline: string;
  bio: string;
  skills: string[];
  portfolio_links: { label: string; url: string }[];
  social_links: { label: string; url: string }[];
  available: boolean;
  has_avatar: boolean;
  notification_prefs: Record<string, boolean>;
  updated_at: string;
}

const COLS = `address, display_name, role, headline, bio, skills, portfolio_links, social_links, available,
  (avatar_data is not null) as has_avatar, notification_prefs, updated_at`;

export function toProfile(r: ProfileRow) {
  return {
    address: getAddress(r.address),
    displayName: r.display_name,
    role: r.role,
    headline: r.headline,
    bio: r.bio,
    skills: r.skills,
    portfolioLinks: r.portfolio_links,
    socialLinks: r.social_links,
    available: r.available,
    avatarUrl: r.has_avatar ? `/api/profiles/${getAddress(r.address)}/avatar?v=${new Date(r.updated_at).getTime()}` : null,
    updatedAt: r.updated_at,
  };
}

export async function getProfile(address: string) {
  const r = await one<ProfileRow>(`select ${COLS} from escrowflow.profiles where address = $1`, [address.toLowerCase()]);
  return r ? { ...toProfile(r), notificationPrefs: r.notification_prefs } : null;
}

export async function listProfiles(opts: { q?: string; role?: string; skill?: string; limit?: number }) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (opts.role === "freelancer") where.push(`role in ('freelancer','both')`);
  if (opts.role === "client") where.push(`role in ('client','both')`);
  if (opts.q) {
    params.push(`%${opts.q.toLowerCase()}%`);
    where.push(`(lower(display_name) like $${params.length} or lower(headline) like $${params.length} or lower(bio) like $${params.length}
      or exists (select 1 from unnest(skills) s where lower(s) like $${params.length}))`);
  }
  if (opts.skill) {
    params.push(opts.skill.toLowerCase());
    where.push(`exists (select 1 from unnest(skills) s where lower(s) = $${params.length})`);
  }
  params.push(Math.min(opts.limit ?? 60, 100));
  const rows = await query<ProfileRow>(
    `select ${COLS} from escrowflow.profiles ${where.length ? `where ${where.join(" and ")}` : ""}
      order by updated_at desc limit $${params.length}`,
    params,
  );
  return rows.map(toProfile);
}

/**
 * Verified work history, derived ONLY from the EscrowFlow contract (state + events) — never from
 * user input. Counts completed projects and MUSD actually paid to this wallet as freelancer.
 */
export async function onchainHistory(address: Address) {
  const ids = await projectIdsFor(address);
  const all = [...new Set([...ids.asClient, ...ids.asFreelancer].map((x) => x.toString()))].map((x) => BigInt(x));
  const snaps = await readProjects(all);
  const lower = address.toLowerCase();
  const asFreelancer = snaps.filter((s) => s.project.freelancer.toLowerCase() === lower);
  const asClient = snaps.filter((s) => s.project.client.toLowerCase() === lower);
  const payments = await query<{ tx_hash: string; block_time: string | null; chain_project_id: string; milestone_index: number; args: Record<string, string> }>(
    `select tx_hash, block_time, chain_project_id::text as chain_project_id, milestone_index, args
       from escrowflow.chain_events
      where event_name = 'MilestoneReleased' and lower(args->>'freelancer') = $1
      order by block_number desc limit 25`,
    [lower],
  );
  return {
    freelancer: {
      projects: asFreelancer.filter((s) => s.project.status >= ProjectStatus.Active).length,
      completed: asFreelancer.filter((s) => s.project.status === ProjectStatus.Completed).length,
      milestonesPaid: asFreelancer.reduce((n, s) => n + s.milestones.filter((m) => m.releasedAmount > 0n).length, 0),
      receivedWei: asFreelancer.reduce((a, s) => a + s.project.releasedAmount, 0n).toString(),
    },
    client: {
      projectsFunded: asClient.filter((s) => s.project.fundedAmount > 0n).length,
      completed: asClient.filter((s) => s.project.status === ProjectStatus.Completed).length,
      releasedWei: asClient.reduce((a, s) => a + s.project.releasedAmount, 0n).toString(),
    },
    payments: payments.map((p) => ({
      txHash: p.tx_hash,
      at: p.block_time,
      chainProjectId: p.chain_project_id,
      milestoneIndex: p.milestone_index,
      amountWei: p.args.amount,
    })),
  };
}
