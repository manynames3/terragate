"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  GitPullRequest,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { listReviews, listRepositories } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Repository, ReviewPage } from "@/types/api";
import {
  AlertBanner,
  Badge,
  Button,
  EmptyState,
  LoadingPanel,
  SeverityBadge,
} from "@/components/ui";

export function ReviewWorkspace() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [repositoryError, setRepositoryError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [draft, setDraft] = useState(params.get("q") || "");
  const query = params.toString();
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const status = params.get("status") ?? "attention";

  function filter(key: string, value: string) {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "offset") next.delete("offset");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }
  useEffect(() => {
    setDraft(params.get("q") || "");
  }, [params]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const filters = Object.fromEntries(new URLSearchParams(query));
    filters.status ??= "attention";
    listReviews(filters, controller.signal)
      .then(setPage)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, refresh]);
  useEffect(() => {
    let active = true;
    setRepositoryError(false);
    listRepositories()
      .then((rows) => {
        if (active) setRepositories(rows);
      })
      .catch(() => {
        if (active) setRepositoryError(true);
      });
    return () => {
      active = false;
    };
  }, [refresh]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <p className="mb-2 text-xs font-medium text-slate-500">
            Workspace / Reviews
          </p>
          <h1 className="text-2xl font-semibold text-slate-950">
            Reviews requiring attention
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Infrastructure changes, evidence, and decisions.
          </p>
        </div>
        <Link
          href="/reviews/new"
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800"
        >
          <Plus className="h-4 w-4" />
          New review
        </Link>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <form
          className="w-full min-w-0 sm:w-auto sm:min-w-64 sm:flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            filter("q", draft.trim());
          }}
        >
          <label
            htmlFor="review-search"
            className="mb-1.5 block text-xs font-medium text-slate-600"
          >
            Search
          </label>
          <div className="flex h-10 rounded-md border border-[var(--border)] bg-white focus-within:ring-2 focus-within:ring-teal-700">
            <Search className="ml-3 mt-3 h-4 w-4 shrink-0 text-slate-500" />
            <input
              id="review-search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Repository, PR, finding, or resource"
              className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
            />
            <button
              type="submit"
              aria-label="Search reviews"
              title="Search reviews"
              className="px-3 text-slate-500 hover:text-teal-700"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>
        <Filter
          label="Status"
          value={status}
          onChange={(value) => filter("status", value)}
          options={[
            ["attention", "Requires attention"],
            ["all", "All reviews"],
            ["queued", "Queued"],
            ["running", "Running"],
            ["approval_pending", "Comment pending"],
            ["approved", "Comment approved"],
            ["rejected", "Comment rejected"],
            ["failed", "Failed"],
            ["mock_comment_ready", "Mock comment complete"],
            ["comment_posted", "Comment posted"],
          ]}
        />
        <Filter
          label="Repository"
          value={params.get("repository") || ""}
          onChange={(v) => filter("repository", v)}
          options={[
            ["", "All repositories"],
            ...repositories.map((r) => [r.full_name, r.full_name]),
          ]}
        />
        <Filter
          label="Environment"
          value={params.get("environment") || ""}
          onChange={(v) => filter("environment", v)}
          options={[
            ["", "All environments"],
            ["dev", "Development"],
            ["staging", "Staging"],
            ["prod", "Production"],
          ]}
        />
        <Filter
          label="Severity"
          value={params.get("severity") || ""}
          onChange={(v) => filter("severity", v)}
          options={[
            ["", "All severities"],
            ...["critical", "high", "medium", "low", "info"].map((s) => [s, s]),
          ]}
        />
        <Button
          variant="secondary"
          size="icon"
          aria-label="Refresh reviews"
          title="Refresh reviews"
          disabled={loading}
          onClick={() => setRefresh((r) => r + 1)}
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {repositoryError ? (
        <AlertBanner tone="warning" title="Repository options unavailable">
          You can still search reviews. Refresh to reload repository filters.
        </AlertBanner>
      ) : null}
      {error ? (
        <AlertBanner tone="danger" title="Reviews unavailable">
          {error} No new results have been loaded.{" "}
          <button
            className="ml-2 font-semibold underline"
            onClick={() => setRefresh((r) => r + 1)}
          >
            Retry
          </button>
        </AlertBanner>
      ) : null}
      {loading && !page ? (
        <LoadingPanel label="Loading reviews" />
      ) : page ? (
        <section
          className="overflow-hidden rounded-lg border border-[var(--border)] bg-white"
          aria-busy={loading}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4">
            <h2 className="text-sm font-semibold text-slate-900">
              Review queue{" "}
              <span className="ml-2 font-normal text-slate-500">
                {page.total} matching reviews
              </span>
            </h2>
            <span className="text-xs text-slate-500">
              {loading
                ? "Refreshing..."
                : error
                  ? "Showing previous results"
                  : "Latest saved state"}
            </span>
          </div>
          {page.items.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No matching reviews"
                body="Change the filters or upload a Terraform plan to start a review."
              />
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  onClick={() => router.replace(`${pathname}?status=all`)}
                >
                  Show all reviews
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="border-b border-[var(--border)] bg-slate-50 text-xs text-slate-500">
                    <tr>
                      {[
                        "Repository / pull request",
                        "Environment",
                        "Risk",
                        "Policy decision",
                        "Comment",
                        "Updated",
                      ].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className="px-5 py-3 font-medium"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((run) => (
                      <tr
                        key={run.id}
                        role="link"
                        tabIndex={0}
                        aria-label={`Open review ${run.id}`}
                        onClick={() => router.push(`/runs/${run.id}`)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            router.push(`/runs/${run.id}`);
                          }
                        }}
                        className="cursor-pointer border-b border-[var(--border)] transition last:border-0 hover:bg-slate-50 focus-visible:bg-teal-50"
                      >
                        <td className="max-w-80 px-5 py-4">
                          <div className="flex gap-3">
                            <GitPullRequest className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <div className="min-w-0">
                              <Link
                                onClick={(e) => e.stopPropagation()}
                                href={`/runs/${run.id}`}
                                className="font-semibold text-slate-900 hover:text-teal-700"
                              >
                                {run.repo_owner && run.repo_name
                                  ? `${run.repo_owner}/${run.repo_name}${run.pull_number ? ` #${run.pull_number}` : ""}`
                                  : run.terraform_execution.sample
                                    ? `${run.terraform_execution.sample.replaceAll("-", " ")} sample`
                                    : run.terraform_execution.source_filename ||
                                      "Uploaded Terraform plan"}
                              </Link>
                              <p className="mt-1 truncate font-mono text-[11px] text-slate-500">
                                {run.reviewed_head_sha
                                  ? run.reviewed_head_sha.slice(0, 8) + " · "
                                  : ""}
                                {run.id}
                              </p>
                              <p className="mt-1 truncate text-xs text-slate-500">
                                {run.summary}
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge>{run.environment}</Badge>
                        </td>
                        <td className="px-5 py-4">
                          <SeverityBadge
                            severity={
                              run.risk_score === null
                                ? run.assessment_state
                                : run.risk_level
                            }
                          />
                        </td>
                        <td className="px-5 py-4">
                          <PolicyBadge decision={run.policy_decision} />
                          <p className="mt-1 text-xs text-slate-500">
                            {run.assessment_state === "assessed"
                              ? `${run.blocking_findings} blocking · ${run.accepted_findings} accepted`
                              : run.status.replaceAll("_", " ")}
                          </p>
                        </td>
                        <td className="px-5 py-4 text-xs text-slate-600">
                          {run.approval_status}
                        </td>
                        <td className="whitespace-nowrap px-5 py-4 text-xs text-slate-500">
                          {formatDate(run.completed_at || run.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="divide-y divide-[var(--border)] md:hidden">
                {page.items.map((run) => (
                  <Link
                    key={run.id}
                    href={`/runs/${run.id}`}
                    className="block p-4 hover:bg-slate-50"
                  >
                    <div className="flex justify-between gap-3">
                      <span className="min-w-0 break-words text-sm font-semibold">
                        {run.repo_owner && run.repo_name
                          ? `${run.repo_owner}/${run.repo_name} #${run.pull_number || ""}`
                          : run.terraform_execution.source_filename ||
                            "Terraform plan review"}
                      </span>
                      <PolicyBadge decision={run.policy_decision} />
                    </div>
                    <p className="mt-2 break-all font-mono text-xs text-slate-500">
                      {run.id}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Badge>{run.environment}</Badge>
                      <SeverityBadge severity={run.risk_level} />
                      <span className="text-xs text-slate-500">
                        {formatDate(run.completed_at || run.created_at)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
          <footer className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3 text-xs text-slate-500">
            <span>
              {page.total
                ? `${offset + 1}-${Math.min(offset + page.items.length, page.total)} of ${page.total}`
                : "0 results"}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                disabled={loading || offset === 0}
                onClick={() =>
                  filter("offset", String(Math.max(0, offset - 25)))
                }
                aria-label="Previous page"
                title="Previous page"
                className="min-h-8 px-2"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                disabled={loading || offset + 25 >= page.total}
                onClick={() => filter("offset", String(offset + 25))}
                aria-label="Next page"
                title="Next page"
                className="min-h-8 px-2"
              >
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </footer>
        </section>
      ) : null}
      <div className="flex items-start gap-2 text-xs text-slate-500">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        <p>
          Attention includes unfinished reviews and high-risk or uncertain
          findings, including accepted risk. Policy decisions do not authorize
          deployment. Comment approvals only authorize the saved PR comment.
          GitHub merge enforcement is not verified.
        </p>
      </div>
    </div>
  );
}

function Filter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
}) {
  return (
    <label className="min-w-32 flex-1 sm:flex-none">
      <span className="mb-1.5 block text-xs font-medium text-slate-600">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full max-w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-slate-700 sm:max-w-52"
      >
        {options.map(([v, t]) => (
          <option key={v} value={v}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}
export function PolicyBadge({ decision }: { decision: string }) {
  return (
    <Badge
      tone={
        decision === "blocked"
          ? "danger"
          : decision === "passed"
            ? "success"
            : decision === "accepted_risk"
              ? "warn"
              : "neutral"
      }
    >
      {decision === "not_assessed"
        ? "Not assessed"
        : decision.replaceAll("_", " ")}
    </Badge>
  );
}
