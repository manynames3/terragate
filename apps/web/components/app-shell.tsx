"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CheckCircle2, ClipboardCheck, FileText, Gauge, Menu, Settings, ShieldCheck, X, FolderGit2, CircleAlert, History, Plug } from "lucide-react";
import { AuthSessionButton } from "@/components/auth-session-button";
import { TerraGateBrand } from "@/components/terragate-brand";
import { cx } from "@/lib/format";
import { getRuntimeCapabilities } from "@/lib/api";
import type { RuntimeCapabilities } from "@/types/api";

const nav = [
  { href: "/overview", label: "Reviews", icon: Gauge },
  { href: "/repositories", label: "Repositories", icon: FolderGit2 },
  { href: "/policies", label: "Policies", icon: ShieldCheck },
  { href: "/exceptions", label: "Exceptions", icon: CircleAlert },
  { href: "/audit-log", label: "Audit log", icon: History },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/settings", label: "Settings", icon: Settings }
];
const contextNav = [
  { href: "/approvals", label: "Comment approvals", icon: CheckCircle2 },
  { href: "/runbooks", label: "Runbooks", icon: FileText },
  { href: "/reports", label: "Reports", icon: ClipboardCheck }
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [capabilityError, setCapabilityError] = useState(false);
  useEffect(() => { getRuntimeCapabilities().then(setCapabilities).catch(() => setCapabilityError(true)); }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const menuButton = menuButtonRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
      if (event.key === "Tab") trapNavigationFocus(event, mobileNavRef.current);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
      menuButton?.focus();
    };
  }, [mobileNavOpen]);

  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[70] -translate-y-20 rounded-md bg-[#43c6ac] px-4 py-2 text-sm font-semibold text-[#07111f] transition focus:translate-y-0"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-[#24324a] bg-[#07101d]/98 backdrop-blur lg:flex">
        <Link href="/overview" className="mx-4 mt-5 flex min-h-10 items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#43c6ac]">
          <TerraGateBrand />
        </Link>
        <div className="mt-8 flex min-h-0 flex-1 flex-col">
          <p className="px-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace</p>
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-[#24324a] p-4">
          <AuthSessionButton compact />
        </div>
      </aside>

      <header className="sticky top-0 z-30 border-b border-[#24324a] bg-[#081120]/96 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between">
          <Link href="/overview" className="flex items-center gap-2 font-semibold text-white">
            <TerraGateBrand compact />
          </Link>
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#31445f] bg-[#101b2d] text-slate-100 transition hover:bg-[#1b2b45]"
            aria-label="Open navigation"
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button type="button" className="absolute inset-0 bg-black/65" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
          <aside
            ref={mobileNavRef}
            id="mobile-navigation"
            aria-label="Primary navigation"
            className="absolute inset-y-0 left-0 flex w-[min(88vw,340px)] flex-col border-r border-[#24324a] bg-[#07101d] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[#24324a] px-4 py-4">
              <TerraGateBrand compact />
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-slate-300 hover:bg-white/8 hover:text-white"
                aria-label="Close navigation"
                autoFocus
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavLinks pathname={pathname} mobile />
            <div className="mt-auto border-t border-[#24324a] p-4">
              <AuthSessionButton />
            </div>
          </aside>
        </div>
      ) : null}

      <main id="main-content" tabIndex={-1} className="min-w-0 outline-none lg:pl-64">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3 text-xs text-slate-500" role="status">
            <span>{capabilityError ? "Environment capabilities unavailable" : capabilities ? capabilities.public_demo ? "Public demo · shared sample workspace" : capabilities.auth_provider === "dev" ? "Development workspace · not customer authentication" : "Private organization workspace" : "Checking environment..."}</span>
            <span>{capabilities ? capabilities.github_writes === "mocked" ? "GitHub writes mocked" : capabilities.github_writes === "live" ? "Live GitHub credentials configured" : "GitHub writes unavailable" : "Capabilities not yet verified"}</span>
          </div>{children}
        </div>
      </main>
    </div>
  );
}

function trapNavigationFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = Array.from(container.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"));
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function NavLinks({ pathname, mobile = false }: { pathname: string; mobile?: boolean }) {
  return (
    <nav aria-label="Primary" className={cx("space-y-1.5 overflow-y-auto px-3 py-4", !mobile && "mt-2")}>
      {[...nav, ...contextNav].map((item, index) => {
        const Icon = item.icon;
        const active = pathname === item.href || (item.href === "/overview" && (pathname === "/" || pathname.startsWith("/runs/") || pathname.startsWith("/reviews/")));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#43c6ac]",
              index === nav.length && "mt-8 border-t border-[#24324a] pt-5",
              active ? "bg-[#16243a] text-white" : "text-slate-400 hover:bg-white/6 hover:text-slate-100"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
