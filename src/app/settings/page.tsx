"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { PageContainer, SignInGate } from "@/components/layout/gate";
import { Button } from "@/components/ui/button";
import { Field, Input, PageHeader, Panel, PanelHeader, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { AddressChip } from "@/components/ui/chain";
import { Avatar } from "@/components/ui/avatar";
import { KeyValue } from "@/components/escrow/escrow-ui";
import { useWalletHelpers, useMusdBalance } from "@/components/wallet/wallet";
import { useSession } from "@/hooks/useSession";
import { api } from "@/lib/client/api";
import type { Profile } from "@/lib/client/types";
import { ESCROW_ADDRESS, MUSD_ADDRESS } from "@/config/contracts";
import { SUPPORTED_CHAIN_ID, mezoTestnet } from "@/config/chains";
import { formatMusd } from "@/lib/money";

const PREFS = [
  ["deadlines", "Deadline reminders"],
  ["reviews", "Review requests and change requests"],
  ["payments", "Funding, payments and refunds"],
  ["disputes", "Disputes and settlements"],
  ["marketplace", "Applications and invitations"],
] as const;

type LinkRow = { label: string; url: string };

export default function SettingsPage() {
  return (
    <SignInGate title="Sign in to edit your profile">
      <PageContainer className="max-w-5xl">
        <PageHeader title="Profile and settings" description="Your wallet address is your identity for every on-chain action. Profile details are optional and public on your profile page." />
        <Settings />
      </PageContainer>
    </SignInGate>
  );
}

function Settings() {
  const q = useQuery({ queryKey: ["me"], queryFn: () => api<{ address: string; profile: Profile | null }>("/api/me/profile") });
  if (q.isLoading) return <Skeleton className="h-96" />;
  return <SettingsForm key={q.data?.profile?.updatedAt ?? "new"} profile={q.data?.profile ?? null} />;
}

function LinkRows({ title, rows, onChange }: { title: string; rows: LinkRow[]; onChange: (rows: LinkRow[]) => void }) {
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-medium text-mist-100">{title}</div>
      {rows.map((l, i) => (
        <div key={i} className="flex gap-2">
          <Input aria-label={`${title} label ${i + 1}`} placeholder="Label" value={l.label} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="max-w-[160px]" />
          <Input aria-label={`${title} URL ${i + 1}`} placeholder="https://" value={l.url} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} className="font-mono text-[13px]" />
          <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => onChange([...rows, { label: "", url: "" }])}>
        <Plus className="size-4" /> Add link
      </Button>
    </div>
  );
}

function SettingsForm({ profile }: { profile: Profile | null }) {
  const qc = useQueryClient();
  const { address, chainId } = useAccount();
  const { signOut } = useSession();
  const { addNetwork, addMusd } = useWalletHelpers();
  const musd = useMusdBalance();
  const [f, setF] = useState(() => ({
    displayName: profile?.displayName ?? "",
    role: profile?.role ?? ("freelancer" as Profile["role"]),
    headline: profile?.headline ?? "",
    bio: profile?.bio ?? "",
    skills: profile?.skills.join(", ") ?? "",
    available: profile?.available ?? true,
    portfolio: profile?.portfolioLinks.length ? profile.portfolioLinks : [{ label: "", url: "" }],
    social: profile?.socialLinks.length ? profile.socialLinks : [{ label: "", url: "" }],
    prefs: (profile?.notificationPrefs ?? {}) as Record<string, boolean>,
  }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/me/profile", {
        method: "PUT",
        json: {
          displayName: f.displayName,
          role: f.role,
          headline: f.headline,
          bio: f.bio,
          skills: f.skills.split(",").map((s) => s.trim()).filter(Boolean),
          portfolioLinks: f.portfolio.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim() || "Link", url: l.url.trim() })),
          socialLinks: f.social.filter((l) => l.url.trim()).map((l) => ({ label: l.label.trim() || "Link", url: l.url.trim() })),
          available: f.available,
          notificationPrefs: f.prefs,
        },
      });
      toast.success("Profile saved");
      await qc.invalidateQueries({ queryKey: ["me"] });
    } catch (e) {
      toast.error("Could not save", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/me/avatar", { method: "POST", body: fd });
    if (!res.ok) toast.error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed");
    else {
      toast.success("Profile image updated");
      await qc.invalidateQueries({ queryKey: ["me"] });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <Panel>
          <PanelHeader title="Public profile" description="Shown in the marketplace and on your profile page. Do not include personal documents." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="flex items-center gap-4 sm:col-span-2">
              <Avatar url={profile?.avatarUrl ?? null} name={f.displayName || "?"} size={56} />
              <label className="text-[13px] text-mist-300">
                <span className="mb-1 block font-medium text-mist-100">Profile image</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!profile} onChange={(e) => uploadAvatar(e.target.files?.[0])} className="text-[13px] file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-mist-100" />
                <span className="mt-1 block text-[12px] text-mist-500">{profile ? "PNG, JPEG or WebP up to 512 KB" : "Save your profile first"}</span>
              </label>
            </div>
            <Field label="Display name" htmlFor="dn">
              <Input id="dn" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
            </Field>
            <Field label="I use EscrowFlow as" htmlFor="role">
              <Select id="role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Profile["role"] })}>
                <option value="freelancer">Freelancer</option>
                <option value="client">Client</option>
                <option value="both">Both</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Professional role" htmlFor="hl" optional>
                <Input id="hl" value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder="Frontend developer · React and design systems" />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Short biography" htmlFor="bio" optional>
                <Textarea id="bio" rows={4} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} />
              </Field>
            </div>
            <div className="sm:col-span-2">
              <Field label="Skills" htmlFor="sk" optional hint="Comma separated">
                <Input id="sk" value={f.skills} onChange={(e) => setF({ ...f, skills: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-[13.5px] text-mist-100 sm:col-span-2">
              <input type="checkbox" checked={f.available} onChange={(e) => setF({ ...f, available: e.target.checked })} className="size-4 accent-[#3d7bff]" /> Available for new work
            </label>
            <div className="sm:col-span-2">
              <LinkRows title="Portfolio links" rows={f.portfolio} onChange={(portfolio) => setF({ ...f, portfolio })} />
            </div>
            <div className="sm:col-span-2">
              <LinkRows title="Social links" rows={f.social} onChange={(social) => setF({ ...f, social })} />
            </div>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Notification preferences" description="In-app notifications. Email and browser push are not enabled in this testnet build." />
          <div className="space-y-2 p-5">
            {PREFS.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[13.5px] text-mist-100">
                <input type="checkbox" className="size-4 accent-[#3d7bff]" checked={f.prefs[k] !== false} onChange={(e) => setF({ ...f, prefs: { ...f.prefs, [k]: e.target.checked } })} /> {label}
              </label>
            ))}
          </div>
        </Panel>
        <Button size="lg" loading={saving} onClick={save} disabled={f.displayName.trim().length < 2}>
          Save profile
        </Button>
      </div>
      <aside className="space-y-6">
        <Panel>
          <PanelHeader title="Wallet" />
          <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
            <KeyValue label="Address"><AddressChip address={address} /></KeyValue>
            <KeyValue label="MUSD">{musd.data !== undefined ? formatMusd(musd.data) : "—"}</KeyValue>
            <KeyValue label="Session">Signed in</KeyValue>
          </dl>
          <div className="flex flex-wrap gap-2 px-5 pb-5">
            <Button size="sm" variant="secondary" onClick={addMusd}>Add MUSD to wallet</Button>
            <Button size="sm" variant="ghost" onClick={() => signOut()}>Sign out</Button>
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="Network configuration" />
          <dl className="divide-y divide-ink-700 px-5 text-[13.5px]">
            <KeyValue label="Network">{mezoTestnet.name}</KeyValue>
            <KeyValue label="Chain id">{SUPPORTED_CHAIN_ID}</KeyValue>
            <KeyValue label="Wallet on">{chainId === SUPPORTED_CHAIN_ID ? <span className="text-paid-300">Mezo Testnet</span> : <span className="text-warn-300">Chain {chainId ?? "—"}</span>}</KeyValue>
            <KeyValue label="MUSD"><AddressChip address={MUSD_ADDRESS} /></KeyValue>
            <KeyValue label="EscrowFlow"><AddressChip address={ESCROW_ADDRESS} /></KeyValue>
          </dl>
          <div className="px-5 pb-5">
            <Button size="sm" variant="secondary" onClick={addNetwork}>Add Mezo Testnet to wallet</Button>
          </div>
        </Panel>
      </aside>
    </div>
  );
}
