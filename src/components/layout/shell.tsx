"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Command } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import { useBlockNumber } from "wagmi";
import {
  Bell,
  BookOpen,
  Briefcase,
  CreditCard,
  FileSignature,
  LayoutDashboard,
  Menu,
  Plus,
  Scale,
  Search,
  Settings,
  Store,
  X,
  Droplets,
  Coins,
  Network,
} from "lucide-react";
import { ConnectButton, NetworkGuard, useWalletHelpers } from "@/components/wallet/wallet";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/primitives";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/client/api";
import { ESCROW_ADDRESS } from "@/config/contracts";
import { FAUCET_URL, SUPPORTED_CHAIN_ID, explorerAddress } from "@/config/chains";
import { cn } from "@/lib/utils";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/projects", label: "Projects", icon: Briefcase },
  { href: "/marketplace", label: "Marketplace", icon: Store },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/disputes", label: "Disputes", icon: Scale },
  { href: "/help", label: "Help", icon: BookOpen },
] as const;

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 text-white", className)} aria-label="MUSD EscrowFlow home">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="9" fill="#111b37" stroke="#34477a" />
        <circle cx="16" cy="16" r="8.5" fill="none" stroke="#8b83ff" strokeWidth="2.2" strokeDasharray="13 3.6" />
        <circle cx="16" cy="16" r="4" fill="#2fc6f6" />
        <path d="M20.5 16h7" stroke="#2fc6f6" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-[-0.01em]">
        EscrowFlow <span className="font-normal text-mist-400">MUSD</span>
      </span>
    </Link>
  );
}

export function TestnetBadge() {
  return (
    <Link
      href="/help#testnet"
      className="hidden items-center gap-1.5 rounded-full border border-warn-400/35 bg-warn-400/10 px-2.5 py-1 text-[12px] font-medium text-warn-300 sm:inline-flex"
      title="Mezo Testnet — test tokens have no monetary value"
    >
      <span className="size-1.5 rounded-full bg-warn-400" aria-hidden /> Testnet
    </Link>
  );
}

function NotificationBell() {
  const { isSignedIn } = useSession();
  const q = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ unread: number }>("/api/notifications"),
    enabled: isSignedIn,
    refetchInterval: 30_000,
  });
  if (!isSignedIn) return null;
  const unread = q.data?.unread ?? 0;
  return (
    <Link href="/notifications" className="relative grid size-9 place-items-center rounded-[10px] border border-ink-600 bg-ink-800 text-mist-300 hover:text-white" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
      <Bell className="size-4" />
      {unread > 0 && (
        <span className="amount absolute -right-1 -top-1 min-w-[18px] rounded-full bg-signal-500 px-1 text-center text-[10.5px] font-semibold leading-[18px] text-white">{unread > 99 ? "99+" : unread}</span>
      )}
    </Link>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menu = menuFor === pathname;
  const setMenu = (fn: (m: boolean) => boolean) => setMenuFor(fn(menu) ? pathname : null);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <header className="no-print sticky top-0 z-40 border-b border-ink-700/80 bg-ink-900/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-4 px-4 sm:px-6">
        <Logo />
        <TestnetBadge />
        <nav className="ml-4 hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(n.href + "/");
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn("rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors", active ? "bg-ink-750 text-white" : "text-mist-400 hover:text-white")}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setPalette(true)}
            className="hidden h-9 items-center gap-2 rounded-[10px] border border-ink-600 bg-ink-800 px-3 text-[13px] text-mist-400 hover:text-white md:flex"
            aria-label="Open command palette"
          >
            <Search className="size-3.5" /> Search <Kbd>Ctrl K</Kbd>
          </button>
          <Link href="/projects/new" className="hidden sm:block">
            <Button size="sm" variant="secondary">
              <Plus className="size-4" aria-hidden /> New project
            </Button>
          </Link>
          <NotificationBell />
          <ConnectButton size="sm" />
          <button className="grid size-9 place-items-center rounded-[10px] border border-ink-600 text-mist-300 lg:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            {menu ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>
      {menu && (
        <nav className="border-t border-ink-700 bg-ink-900 px-4 py-3 lg:hidden" aria-label="Mobile">
          {[...NAV, { href: "/projects/new", label: "New project", icon: Plus }, { href: "/settings", label: "Settings", icon: Settings }].map((n) => (
            <Link key={n.href} href={n.href} className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-[14px] text-mist-100 hover:bg-ink-800">
              <n.icon className="size-4 text-mist-400" aria-hidden /> {n.label}
            </Link>
          ))}
        </nav>
      )}
      <NetworkGuard />
      <CommandPalette open={palette} onOpenChange={setPalette} />
    </header>
  );
}

function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const { isSignedIn } = useSession();
  const { addMusd, addNetwork } = useWalletHelpers();
  const projects = useQuery({
    queryKey: ["my-projects"],
    queryFn: () => api<{ projects: { id: string; title: string; chainStatusLabel: string }[] }>("/api/projects"),
    enabled: open && isSignedIn,
  });
  const go = (href: string) => {
    onOpenChange(false);
    if (href.startsWith("http")) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-ink-950/70 px-4 pt-[12vh] backdrop-blur-[3px]" onClick={() => onOpenChange(false)}>
      <Command
        label="Command palette"
        className="panel-raised mx-auto w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onOpenChange(false);
        }}
      >
        <div className="flex items-center gap-2 border-b border-ink-700 px-4">
          <Search className="size-4 text-mist-400" aria-hidden />
          <Command.Input autoFocus placeholder="Jump to a page, project or action…" className="h-12 w-full bg-transparent text-[14px] text-white placeholder:text-mist-500 focus:outline-none" />
        </div>
        <Command.List className="max-h-[50vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-[13.5px] text-mist-400">No matches.</Command.Empty>
          <Command.Group heading="Go to" className="text-[11.5px] text-mist-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            {[...NAV, { href: "/notifications", label: "Notifications", icon: Bell }, { href: "/settings", label: "Profile and settings", icon: Settings }].map((n) => (
              <PaletteItem key={n.href} onSelect={() => go(n.href)} icon={<n.icon className="size-4" />}>
                {n.label}
              </PaletteItem>
            ))}
          </Command.Group>
          <Command.Group heading="Actions" className="text-[11.5px] text-mist-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
            <PaletteItem onSelect={() => go("/projects/new")} icon={<Plus className="size-4" />}>Create a project</PaletteItem>
            <PaletteItem onSelect={() => go("/marketplace?tab=freelancers")} icon={<Search className="size-4" />}>Find a freelancer</PaletteItem>
            <PaletteItem onSelect={() => { onOpenChange(false); addNetwork(); }} icon={<Network className="size-4" />}>Add Mezo Testnet to wallet</PaletteItem>
            <PaletteItem onSelect={() => { onOpenChange(false); addMusd(); }} icon={<Coins className="size-4" />}>Add MUSD to wallet</PaletteItem>
            <PaletteItem onSelect={() => go(FAUCET_URL)} icon={<Droplets className="size-4" />}>Get testnet BTC (faucet)</PaletteItem>
            <PaletteItem onSelect={() => go(explorerAddress(ESCROW_ADDRESS))} icon={<FileSignature className="size-4" />}>View the EscrowFlow contract</PaletteItem>
          </Command.Group>
          {projects.data && projects.data.projects.length > 0 && (
            <Command.Group heading="Your projects" className="text-[11.5px] text-mist-500 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5">
              {projects.data.projects.slice(0, 12).map((p) => (
                <PaletteItem key={p.id} onSelect={() => go(`/projects/${p.id}`)} icon={<Briefcase className="size-4" />}>
                  {p.title} <span className="ml-auto text-[12px] text-mist-500">{p.chainStatusLabel}</span>
                </PaletteItem>
              ))}
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function PaletteItem({ children, onSelect, icon }: { children: React.ReactNode; onSelect: () => void; icon: React.ReactNode }) {
  return (
    <Command.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] text-mist-100 data-[selected=true]:bg-ink-700 data-[selected=true]:text-white">
      <span className="text-mist-400">{icon}</span>
      {children}
    </Command.Item>
  );
}

export function SiteFooter() {
  const { data: block } = useBlockNumber({ chainId: SUPPORTED_CHAIN_ID, watch: true, query: { refetchInterval: 12_000 } });
  return (
    <footer className="no-print mt-16 border-t border-ink-700/80">
      <div className="mx-auto grid max-w-[1320px] gap-8 px-4 py-10 text-[13px] text-mist-400 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm leading-relaxed">
            Milestone escrow for freelance work, settled in MUSD on Mezo. Testnet build: test tokens have no monetary value.
          </p>
          <p className="flex items-center gap-2">
            <span className={cn("size-2 rounded-full", block ? "bg-paid-400" : "bg-mist-500")} aria-hidden />
            {block ? <span className="amount">Mezo Testnet · block {block.toLocaleString("en-US")}</span> : "Connecting to Mezo Testnet…"}
          </p>
        </div>
        <FooterCol title="Product" links={[["Dashboard", "/dashboard"], ["Marketplace", "/marketplace"], ["Create a project", "/projects/new"], ["Payments", "/payments"]]} />
        <FooterCol title="Learn" links={[["How escrow works", "/help"], ["Fees", "/help#fees"], ["Contract limitations", "/help#limitations"], ["FAQ", "/help#faq"]]} />
        <FooterCol title="Legal" links={[["Terms of use", "/legal/terms"], ["Privacy", "/legal/privacy"], ["Risk disclosure", "/legal/risk"], ["Escrow contract", explorerAddress(ESCROW_ADDRESS)]]} />
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <div className="mb-3 font-medium text-mist-100">{title}</div>
      <ul className="space-y-2">
        {links.map(([l, h]) => (
          <li key={h}>
            {h.startsWith("http") ? (
              <a href={h} target="_blank" rel="noopener noreferrer" className="hover:text-white">
                {l}
              </a>
            ) : (
              <Link href={h} className="hover:text-white">
                {l}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
