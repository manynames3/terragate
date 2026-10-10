"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ShieldCheck } from "lucide-react";
import { getPlan } from "@/lib/api";
import type { PlanPage } from "@/types/api";
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  LoadingPanel,
} from "@/components/ui";

export function PlanEvidence({
  runId,
  resource,
}: {
  runId: string;
  resource?: string;
}) {
  const [page, setPage] = useState<PlanPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setOffset(0);
  }, [runId, resource]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPage(null);
    getPlan(runId, offset, resource)
      .then((p) => {
        if (active) setPage(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runId, offset, resource, retry]);
  return (
    <section className="@container min-w-0 space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4" />
        <span>
          Saved redacted plan. Null values are not proof of absence; unknown
          values are shown separately.
        </span>
      </div>
      {error ? (
        <AlertBanner tone="warning" title="Plan evidence unavailable">
          {error}{" "}
          <button
            onClick={() => setRetry((x) => x + 1)}
            className="ml-1 font-semibold underline"
          >
            Retry
          </button>
        </AlertBanner>
      ) : loading ? (
        <LoadingPanel label="Loading redacted plan" />
      ) : page?.items.length ? (
        <>
          {page.items.map((item) => (
            <article
              key={item.address}
              className="overflow-hidden rounded-md border border-[var(--border)] bg-white"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] p-4">
                <h3 className="min-w-0 break-all font-mono text-xs font-semibold">
                  {item.address}
                </h3>
                <Badge>{item.change.actions.join(" → ")}</Badge>
              </div>
              <div className="grid min-w-0 gap-px bg-[var(--border)] @lg:grid-cols-2">
                {(["before", "after"] as const).map((side) => (
                  <div key={side} className="min-w-0 bg-white p-4">
                    <p className="mb-3 text-xs font-semibold capitalize text-slate-500">
                      {side}
                    </p>
                    <pre className="max-h-80 overflow-auto rounded bg-slate-50 p-3 text-xs leading-5 text-slate-700">
                      {JSON.stringify(item.change[side], null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
              <details className="border-t border-[var(--border)] p-4 text-xs">
                <summary className="cursor-pointer font-medium text-slate-600">
                  Unknown after apply
                </summary>
                <pre className="mt-3 overflow-auto rounded bg-slate-50 p-3">
                  {JSON.stringify(item.change.after_unknown ?? {}, null, 2)}
                </pre>
              </details>
            </article>
          ))}
          <p className="break-all font-mono text-[11px] text-slate-500">
            Artifact SHA-256: {page.sha256}
          </p>
          {!resource ? (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                {offset + 1}-{Math.min(offset + 25, page.total)} of {page.total}{" "}
                resource changes
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  disabled={offset === 0}
                  onClick={() => setOffset((x) => Math.max(0, x - 25))}
                  title="Previous resources"
                  aria-label="Previous resources"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="secondary"
                  disabled={offset + 25 >= page.total}
                  onClick={() => setOffset((x) => x + 25)}
                  title="Next resources"
                  aria-label="Next resources"
                >
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          title="No resource changes"
          body={
            resource
              ? "This resource has no saved plan change. No diff can be inferred."
              : "The saved plan contains no resource changes."
          }
        />
      )}
    </section>
  );
}
