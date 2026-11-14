import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Providers } from "@/components/providers";
import { SiteFooter, SiteHeader } from "@/components/layout/shell";
import "./globals.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans", display: "swap" });
const serif = IBM_Plex_Serif({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-serif", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

const description =
  "Milestone-based freelance escrow paid in MUSD on Mezo. Agree on terms, lock the budget in a smart contract, and release payment milestone by milestone — every funding and payout verifiable on-chain.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://musd-escrowflow.vercel.app"),
  title: { default: "MUSD EscrowFlow — Work with confidence. Pay with trust.", template: "%s · MUSD EscrowFlow" },
  description,
  applicationName: "MUSD EscrowFlow",
  openGraph: {
    title: "MUSD EscrowFlow",
    description,
    type: "website",
    siteName: "MUSD EscrowFlow",
  },
  twitter: { card: "summary_large_image", title: "MUSD EscrowFlow", description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#0e1420",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookie = (await headers()).get("cookie");
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        <a href="#main" className="sr-only z-50 rounded bg-signal-500 px-3 py-2 text-ink-950 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
          Skip to content
        </a>
        <Providers cookie={cookie}>
          <SiteHeader />
          <main id="main" className="min-h-[70vh]">
            {children}
          </main>
          <SiteFooter />
        </Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
