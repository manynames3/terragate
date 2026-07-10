"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createDemoTerraformReview, getRun } from "@/lib/api";
import { SHOWCASE_REPO, SHOWCASE_STORAGE_KEY, demoScenarioReviewOptions, isHomeShowcaseRun } from "@/lib/showcase";
import { Activity, CheckCircle2, GitPullRequest, LockKeyhole, ShieldCheck } from "lucide-react";
import { Button, Card } from "@/components/ui";

const ShowcaseRunDetail = dynamic(() => import("@/components/run-detail").then((mod) => mod.RunDetailClient), {
  ssr: false,
  loading: () => <ShowcaseSkeleton />
});

type LoadPhase = "checking" | "creating" | "ready" | "error";

export function HomeCockpit() {
  const [runId, setRunId] = useState<string | null>(null);
  const [phase, setPhase] = useState<LoadPhase>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolveShowcaseRun() {
      setPhase("checking");
      setError(null);
      const stored = window.localStorage.getItem(SHOWCASE_STORAGE_KEY);
      if (stored) {
        try {
          const run = await getRun(stored);
          if (!cancelled && isHomeShowcaseRun(run)) {
            setRunId(stored);
            setPhase("ready");
            return;
          }
          window.localStorage.removeItem(SHOWCASE_STORAGE_KEY);
        } catch {
          window.localStorage.removeItem(SHOWCASE_STORAGE_KEY);
        }
      }

      try {
        if (!cancelled) setPhase("creating");
        const created = await createDemoTerraformReview(SHOWCASE_REPO.sample, demoScenarioReviewOptions(SHOWCASE_REPO.sample));
        window.localStorage.setItem(SHOWCASE_STORAGE_KEY, created.run_id);
        if (!cancelled) {
          setRunId(created.run_id);
          setPhase("ready");
        }
      } catch (err) {
        if (!cancelled) {
          setPhase("error");
          setError(err instanceof Error ? err.message : "Failed to prepare the showcase run.");
        }
      }
    }

    void resolveShowcaseRun();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Terraform PR risk gate</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-normal text-white md:text-4xl">Production review cockpit</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
              Evidence-backed Terraform findings, runbook-grade remediation, compliance mapping, and approval-gated GitHub actions.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 xl:justify-end">
            <Link href="/reviews/new">
              <Button>New Terraform review</Button>
            </Link>
            <Link href="/overview">
              <Button variant="secondary">Operations overview</Button>
            </Link>
          </div>
        </div>
        <div className="mt-5 grid gap-3 border-t border-[#24324a] pt-5 md:grid-cols-4">
          <CockpitSignal icon={<ShieldCheck className="h-4 w-4" />} label="Policy engine" value="deterministic first" />
          <CockpitSignal icon={<LockKeyhole className="h-4 w-4" />} label="Sensitive data" value="redacted before review" />
          <CockpitSignal icon={<GitPullRequest className="h-4 w-4" />} label="GitHub writes" value="approval gated" />
          <CockpitSignal icon={<Activity className="h-4 w-4" />} label="API warm-up" value={phaseLabel(phase)} />
        </div>
      </Card>

      {error ? <ShowcaseError message={error} /> : runId ? <ShowcaseRunDetail runId={runId} /> : <ShowcaseSkeleton phase={phase} />}
    </div>
  );
}

function CockpitSignal({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#26364d] bg-[#07101d] p-4">
      <div className="flex items-center gap-2 text-[#43c6ac]">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em]">{label}</p>
      </div>
      <p className="mt-3 text-sm font-semibold text-white">{value}</p>
    </div>
  );
}

function ShowcaseSkeleton({ phase = "checking" }: { phase?: LoadPhase }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col justify-between gap-4 border-b border-[#24324a] p-5 md:flex-row md:items-center">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Showcase review</p>
          <h2 className="mt-1 text-lg font-semibold text-white">Hydrating seeded production run</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            The app shell is available immediately while the AWS Lambda API checks or creates the hosted sample review.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 rounded-md border border-[#31445f] bg-[#101b2d] px-3 py-2 text-sm font-semibold text-slate-200">
          <CheckCircle2 className="h-4 w-4 text-[#43c6ac]" />
          {phaseLabel(phase)}
        </div>
      </div>
      <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <div className="h-12 animate-pulse rounded-md bg-[#132238]" />
          <div className="grid gap-3 md:grid-cols-3">
            <div className="h-24 animate-pulse rounded-md bg-[#101b2d]" />
            <div className="h-24 animate-pulse rounded-md bg-[#101b2d]" />
            <div className="h-24 animate-pulse rounded-md bg-[#101b2d]" />
          </div>
          <div className="h-72 animate-pulse rounded-md bg-[#101b2d]" />
        </div>
        <div className="space-y-3">
          <div className="h-36 animate-pulse rounded-md bg-[#101b2d]" />
          <div className="h-48 animate-pulse rounded-md bg-[#101b2d]" />
        </div>
      </div>
    </Card>
  );
}

function ShowcaseError({ message }: { message: string }) {
  return (
    <Card className="p-6">
      <p className="text-sm font-semibold text-red-100">Could not load the hosted showcase review.</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{message}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/reviews/new">
          <Button>New Terraform review</Button>
        </Link>
        <Link href="/overview">
          <Button variant="secondary">Open overview</Button>
        </Link>
      </div>
    </Card>
  );
}

function phaseLabel(phase: LoadPhase) {
  if (phase === "creating") return "creating sample run";
  if (phase === "ready") return "ready";
  if (phase === "error") return "needs attention";
  return "checking cached run";
}
