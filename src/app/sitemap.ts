import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "https://musd-escrowflow.vercel.app";
  return ["", "/marketplace", "/help", "/projects/new", "/legal/terms", "/legal/privacy", "/legal/risk"].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: p === "/marketplace" ? "daily" : "weekly",
    priority: p === "" ? 1 : 0.6,
  }));
}
