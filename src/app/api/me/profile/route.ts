import { json, parseJson, route } from "@/lib/server/http";
import { requireSession } from "@/lib/server/auth";
import { query } from "@/lib/server/db";
import { getProfile } from "@/lib/server/profiles";
import { profileInputSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const s = await requireSession();
  return json({ address: s.address, profile: await getProfile(s.address) });
});

export const PUT = route(async (req) => {
  const s = await requireSession();
  const p = await parseJson(req, profileInputSchema);
  await query(
    `insert into escrowflow.profiles (address, display_name, role, headline, bio, skills, portfolio_links, social_links, available, notification_prefs, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     on conflict (address) do update set display_name = excluded.display_name, role = excluded.role, headline = excluded.headline,
       bio = excluded.bio, skills = excluded.skills, portfolio_links = excluded.portfolio_links, social_links = excluded.social_links,
       available = excluded.available, notification_prefs = excluded.notification_prefs, updated_at = now()`,
    [
      s.address.toLowerCase(),
      p.displayName,
      p.role,
      p.headline,
      p.bio,
      p.skills,
      JSON.stringify(p.portfolioLinks),
      JSON.stringify(p.socialLinks),
      p.available,
      JSON.stringify(p.notificationPrefs),
    ],
  );
  return json({ profile: await getProfile(s.address) });
});
