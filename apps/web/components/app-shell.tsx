"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Activity, CheckCircle2, ClipboardCheck, FileJson, FileText, Gauge, Settings, ShieldCheck } from "lucide-react";
import { cx } from "@/lib/format";

const nav = [
  { href: "/", label: "Dashboard", icon: Gauge },
  { href: "/reviews/new", label: "New Review", icon: FileJson },
  { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
  { href: "/runbooks", label: "Runbooks", icon: FileText },
  { href: "/compliance", label: "Compliance", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-[#24324a] bg-[#081120]/92 px-5 py-6 backdrop-blur lg:block">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-[#2d415c] bg-[#101d31]">
            <ShieldCheck className="h-5 w-5 text-[#43c6ac]" />
          </span>
          <span>
            <span className="block text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">TerraGate</span>
            <span className="block text-lg font-semibold text-white">Terraform Risk Gate</span>
          </span>
        </Link>
        <nav className="mt-10 space-y-2">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cx(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition",
                  active ? "bg-[#16243a] text-white" : "text-slate-400 hover:bg-white/6 hover:text-slate-100"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="absolute bottom-6 left-5 right-5 space-y-3">
          <div className="rounded-lg border border-[#26364d] bg-[#0d1728] p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Activity className="h-4 w-4 text-[#6ea8fe]" />
              Deterministic first
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">Policy checks produce evidence before AI explains, ranks, or drafts a comment.</p>
          </div>
        </div>
      </aside>
      <header className="border-b border-[#24324a] bg-[#081120]/90 px-4 py-4 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <Link href="/" className="font-semibold text-white">TerraGate</Link>
          <div className="flex items-center gap-2">
            <Link href="/reviews/new" className="rounded-md bg-[#43c6ac] px-3 py-2 text-sm font-semibold text-[#07111f]">New Review</Link>
          </div>
        </div>
      </header>
      <main className="lg:pl-72">
        <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </main>
    </div>
  );
}
