"use client";

import { useEffect, useState } from "react";
import { LogIn, LogOut, UserRound } from "lucide-react";
import {
  cognitoConfigStatus,
  getStoredAuthSession,
  isCognitoAuthEnabled,
  signOut,
  startCognitoLogin,
  type AuthSession
} from "@/lib/auth";
import { cx } from "@/lib/format";
import { Button } from "@/components/ui";

export function AuthSessionButton({ compact = false }: { compact?: boolean }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [status, setStatus] = useState(cognitoConfigStatus());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setStatus(cognitoConfigStatus());
      setSession(getStoredAuthSession());
    };
    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("cloudops-auth-changed", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("cloudops-auth-changed", refresh);
    };
  }, []);

  if (!isCognitoAuthEnabled()) {
    return (
      <div className={cx("rounded-lg border border-[#26364d] bg-[#0d1728] p-3", compact && "p-2")}>
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
          <UserRound className="h-4 w-4 text-[#6ea8fe]" />
          Dev auth
        </div>
        {!compact ? <p className="mt-1 text-xs text-slate-400">Local platform-admin fallback is active.</p> : null}
      </div>
    );
  }

  if (status === "incomplete") {
    return (
      <div className={cx("rounded-lg border border-amber-300/30 bg-amber-400/10 p-3 text-xs text-amber-100", compact && "p-2")}>
        Cognito env is incomplete.
      </div>
    );
  }

  if (session) {
    return (
      <div className={cx("rounded-lg border border-[#26364d] bg-[#0d1728] p-3", compact && "p-2")}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <UserRound className="h-4 w-4 text-[#43c6ac]" />
              <span className="truncate">{session.email || session.name || "Signed in"}</span>
            </div>
            {!compact ? <p className="mt-1 text-xs text-slate-400">Cognito session active.</p> : null}
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/8 hover:text-white"
            aria-label="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cx("rounded-lg border border-[#26364d] bg-[#0d1728] p-3", compact && "p-2")}>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => {
          setError(null);
          startCognitoLogin().catch((exc: unknown) => {
            setError(exc instanceof Error ? exc.message : "Unable to start Cognito login.");
          });
        }}
      >
        <LogIn className="h-4 w-4" />
        Sign in
      </Button>
      {error ? <p className="mt-2 text-xs text-red-200">{error}</p> : null}
    </div>
  );
}
