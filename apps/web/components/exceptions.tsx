"use client";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, CircleAlert, RefreshCcw } from "lucide-react";
import {
  decideException,
  getCurrentUser,
  listExceptions,
  requestException,
} from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { AuthUser, RiskException } from "@/types/api";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  LoadingPanel,
} from "@/components/ui";

export function Exceptions() {
  const [page, setPage] = useState<{
    items: RiskException[];
    total: number;
  } | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    item: RiskException;
    decision: "approved" | "denied" | "revoked";
  } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPage(await listExceptions(undefined, offset));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Exceptions unavailable");
    } finally {
      setLoading(false);
    }
  }, [offset]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null));
  }, []);
  async function confirm() {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await decideException(pending.item.id, pending.decision, notes);
      setSuccess(
        `Exception ${pending.decision}. This does not approve deployment or the PR comment.`,
      );
      setPending(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Risk exceptions</h1>
          <p className="mt-2 text-sm text-slate-600">
            Time-limited acceptance for a finding in one exact review revision.
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh exceptions"
          title="Refresh exceptions"
        >
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </header>
      <AlertBanner title="Separate from comment approval">
        An exception needs a different administrator, a business justification,
        and an expiration within 90 days. It does not hide evidence, reduce risk
        scores, approve deployment, or change GitHub checks. Changed review
        content makes it stale.
      </AlertBanner>
      {error ? <AlertBanner tone="danger">{error}</AlertBanner> : null}
      {success ? (
        <AlertBanner tone="success" onDismiss={() => setSuccess(null)}>
          {success}
        </AlertBanner>
      ) : null}
      {loading ? (
        <LoadingPanel label="Loading exceptions" />
      ) : error && !page ? null : !page?.items.length ? (
        <EmptyState
          title="No exceptions requested"
          body="Open a finding in a completed review to request a scoped, expiring risk exception."
        />
      ) : (
        <div className="space-y-4">
          {page.items.map((item) => (
            <Card key={item.id} className="p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={`/runs/${item.run_id}?finding=${item.finding_id}#findings`}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-teal-700"
                >
                  <CircleAlert className="h-4 w-4" />
                  {item.finding_title || item.finding_id}
                </Link>
                <Badge
                  tone={
                    item.status === "approved"
                      ? "warn"
                      : item.status === "denied" || item.status === "revoked"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {item.status}
                </Badge>
              </div>
              <p className="mt-3 break-all font-mono text-xs text-slate-500">
                {item.resource_address || "Resource not mapped"} ·{" "}
                {item.finding_id}
              </p>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm text-slate-700">
                {item.justification}
              </p>
              <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
                <div>
                  <dt className="text-slate-500">Requested by</dt>
                  <dd className="mt-1 break-all">{item.requester_email}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Expires</dt>
                  <dd className="mt-1">{formatDate(item.expires_at)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Approver</dt>
                  <dd className="mt-1 break-all">
                    {item.approver_email || "Awaiting decision"}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 break-all font-mono text-[11px] text-slate-500">
                Snapshot {item.review_snapshot_hash}
              </p>
              {item.decision_notes ? (
                <p className="mt-3 text-sm text-slate-700">
                  Decision: {item.decision_notes}
                </p>
              ) : null}
              {user?.role === "platform-admin" &&
              user.email !== item.requester_email &&
              ["pending", "approved"].includes(item.status) ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {(item.status === "pending"
                    ? ["approved", "denied"]
                    : ["revoked"]
                  ).map((d) => (
                    <Button
                      key={d}
                      variant={d === "approved" ? "primary" : "secondary"}
                      onClick={() => {
                        setNotes("");
                        setPending({
                          item,
                          decision: d as "approved" | "denied" | "revoked",
                        });
                      }}
                    >
                      {d === "approved"
                        ? "Accept risk"
                        : d === "denied"
                          ? "Deny"
                          : "Revoke"}
                    </Button>
                  ))}
                </div>
              ) : item.status === "pending" ? (
                <p className="mt-4 text-xs text-slate-500">
                  A different platform administrator must review this request.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{page?.total ?? "..."} exceptions</span>
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
      <ConfirmDialog
        open={!!pending}
        title={
          pending?.decision === "approved"
            ? "Accept this scoped risk?"
            : pending?.decision === "revoked"
              ? "Revoke risk acceptance?"
              : "Deny this exception?"
        }
        description="The finding remains in the report. This decision only applies to the saved review snapshot, not future PR revisions or infrastructure deployment."
        confirmLabel="Record decision"
        busy={busy}
        confirmDisabled={notes.trim().length < 10}
        onCancel={() => setPending(null)}
        onConfirm={() => void confirm()}
      >
        <label className="block text-sm">
          Decision notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            minLength={10}
            maxLength={2000}
            className="mt-2 min-h-24 w-full rounded-md border border-[var(--border)] p-3"
            placeholder="Reason for acceptance, denial, or revocation"
          />
        </label>
        {error ? (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

export function ExceptionRequestForm({
  runId,
  findingId,
  snapshotHash,
  disabled,
  onCreated,
}: {
  runId: string;
  findingId: string;
  snapshotHash: string;
  disabled: boolean;
  onCreated: () => void;
}) {
  const [reason, setReason] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RiskException[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setHistory(null);
    setHistoryError(null);
    listExceptions(runId, 0, findingId)
      .then((page) => {
        if (active) setHistory(page.items);
      })
      .catch((e) => {
        if (active) setHistoryError(e.message);
      });
    return () => {
      active = false;
    };
  }, [runId, findingId, snapshotHash, historyRefresh]);
  const current = history?.find(
    (item) => item.status === "approved" || item.status === "pending",
  );
  const [message, setMessage] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  useEffect(() => {
    setReason("");
    setExpiry("");
    setMessage(null);
  }, [findingId]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const item = await requestException(runId, {
        finding_id: findingId,
        review_snapshot_hash: snapshotHash,
        justification: reason.trim(),
        expires_at: new Date(expiry).toISOString(),
      });
      setHistory([item, ...(history || [])]);
      setMessage({
        error: false,
        text: "Exception requested. A different administrator must decide it.",
      });
      onCreated();
    } catch (e) {
      setMessage({
        error: true,
        text: e instanceof Error ? e.message : "Request failed",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={submit}
      className="space-y-3 border-t border-[var(--border)] pt-5"
    >
      <h3 className="text-sm font-semibold">Request risk exception</h3>
      <p className="text-xs text-slate-500">
        This finding, this review only. Evidence remains visible. Expiration
        must be within 90 days.
      </p>
      {historyError ? (
        <AlertBanner tone="warning">
          Exception history unavailable.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setHistoryRefresh((x) => x + 1)}
          >
            Retry
          </button>
        </AlertBanner>
      ) : history === null ? (
        <p className="text-xs text-slate-500" role="status">
          Checking this finding’s exceptions...
        </p>
      ) : history.length ? (
        <div className="space-y-3">
          {history.map((item) => (
            <div
              key={item.id}
              className="border-b border-[var(--border)] pb-3 text-xs last:border-0"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={item.status === "approved" ? "warn" : "neutral"}>
                  {item.status}
                </Badge>
                <span>Expires {formatDate(item.expires_at)}</span>
              </div>
              <p className="mt-2 break-words text-slate-600">
                {item.justification}
              </p>
              <p className="mt-2 break-all text-slate-500">
                Requested by {item.requester_email}
                {item.approver_email
                  ? ` · Decision by ${item.approver_email}`
                  : ""}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          No exception recorded for this finding.
        </p>
      )}
      <label className="block text-xs font-medium text-slate-600">
        Business justification
        <textarea
          required
          minLength={20}
          maxLength={2000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-2 min-h-24 w-full rounded-md border border-[var(--border)] p-3 text-sm"
          disabled={disabled || busy || history === null || !!current}
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Expires (your local time)
        <input
          type="datetime-local"
          required
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          className="mt-2 h-10 w-full rounded-md border border-[var(--border)] px-3 text-sm"
          disabled={disabled || busy || history === null || !!current}
        />
      </label>
      <Button
        type="submit"
        variant="secondary"
        disabled={
          disabled ||
          busy ||
          history === null ||
          !!current ||
          reason.trim().length < 20 ||
          !expiry
        }
      >
        {busy ? "Requesting..." : "Request exception"}
      </Button>
      {disabled ? (
        <p className="text-xs text-slate-500">
          A completed review and reviewer access are required.
        </p>
      ) : null}
      {current ? (
        <p className="text-xs text-slate-500">
          A current {current.status} exception already covers this finding and
          snapshot.
        </p>
      ) : null}
      {message ? (
        <AlertBanner tone={message.error ? "danger" : "success"}>
          {message.text}
        </AlertBanner>
      ) : null}
      <Link
        href="/exceptions"
        className="block text-xs font-semibold text-teal-700"
      >
        Open exception history
      </Link>
    </form>
  );
}
