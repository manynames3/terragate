"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, FolderGit2, RefreshCcw } from "lucide-react";
import { listRepositories, listAuditEvents } from "@/lib/api";
import type { Repository, AuditLogEntry } from "@/types/api";
import { formatDate } from "@/lib/format";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingPanel,
} from "@/components/ui";

export function Repositories() {
  const [rows, setRows] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listRepositories());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Repositories unavailable");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Repositories</h1>
          <p className="mt-2 text-sm text-slate-600">
            Repository context observed in your organization’s saved reviews.
          </p>
        </div>
        <Button
          variant="secondary"
          title="Refresh repositories"
          aria-label="Refresh repositories"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </header>
      <AlertBanner title="Observed, not installed">
        These records do not verify GitHub App installation, webhook delivery,
        CI plan provenance, or branch protection.{" "}
        <Link href="/integrations" className="font-semibold underline">
          Inspect integration capabilities
        </Link>
        .
      </AlertBanner>
      {error ? (
        <AlertBanner tone="danger">{error}</AlertBanner>
      ) : loading ? (
        <LoadingPanel label="Loading repositories" />
      ) : !rows.length ? (
        <EmptyState
          title="No repository context yet"
          body="Start a review and attach repository/PR metadata. Operator-managed GitHub App installation is required for live integration."
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="border-b border-[var(--border)] bg-slate-50 text-xs text-slate-500">
              <tr>
                {[
                  "Repository",
                  "Reviews",
                  "Last review",
                  "Merge enforcement",
                ].map((h) => (
                  <th key={h} scope="col" className="p-4 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.full_name}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="p-4">
                    <Link
                      className="inline-flex items-center gap-2 font-semibold text-teal-700"
                      href={`/overview?status=all&repository=${encodeURIComponent(r.full_name)}`}
                    >
                      <FolderGit2 className="h-4 w-4" />
                      {r.full_name}
                    </Link>
                  </td>
                  <td className="p-4">{r.review_count}</td>
                  <td className="p-4 text-slate-500">
                    {formatDate(r.last_review_at)}
                  </td>
                  <td className="p-4">
                    <Badge>Not verified</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

export function AuditLog() {
  const [page, setPage] = useState<{
    items: Array<AuditLogEntry & { run_id: string }>;
    total: number;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    listAuditEvents(offset)
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
  }, [offset, refresh]);
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="mt-2 text-sm text-slate-600">
            Organization-scoped review, comment, and exception decisions. Global
            policy-file edits are not included.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => setRefresh((x) => x + 1)}
          title="Refresh audit log"
          aria-label="Refresh audit log"
        >
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </header>
      {error ? (
        <AlertBanner tone="danger">{error}</AlertBanner>
      ) : loading ? (
        <LoadingPanel label="Loading audit log" />
      ) : page?.items.length ? (
        <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-white">
          {page.items.map((e) => (
            <div key={e.id} className="p-4">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-sm font-semibold">
                  {e.action.replaceAll("_", " ")}
                </span>
                <time className="text-xs text-slate-500">
                  {formatDate(e.created_at)}
                </time>
              </div>
              <p className="mt-2 text-xs text-slate-600">
                {e.actor_email || "System"} ·{" "}
                <Link
                  href={`/runs/${e.run_id}#history`}
                  className="font-mono text-teal-700"
                >
                  {e.run_id}
                </Link>
              </p>
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-slate-500">
                  Decision evidence
                </summary>
                <pre className="mt-2 overflow-auto rounded bg-slate-50 p-3">
                  {JSON.stringify(e.metadata, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No audit events"
          body="Review and exception activity will appear here once recorded."
        />
      )}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{page?.total ?? "..."} recorded events</span>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            disabled={loading || offset === 0}
            onClick={() => setOffset((x) => Math.max(0, x - 50))}
            title="Previous page"
            aria-label="Previous page"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            disabled={loading || offset + 50 >= (page?.total ?? 0)}
            onClick={() => setOffset((x) => x + 50)}
            title="Next page"
            aria-label="Next page"
          >
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
