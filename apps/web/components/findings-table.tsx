"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ExternalLink, Eye, X } from "lucide-react";
import type { Category, Finding } from "@/types/api";
import { Button, Card, EmptyState, SeverityBadge } from "@/components/ui";

const categories: Array<Category | "all"> = ["all", "security", "cost", "reliability", "governance", "compliance"];

export function FindingsTable({ findings }: { findings: Finding[] }) {
  const [category, setCategory] = useState<Category | "all">("all");
  const [selected, setSelected] = useState<Finding | null>(null);
  const filtered = useMemo(
    () => (category === "all" ? findings : findings.filter((finding) => finding.category === category)),
    [category, findings]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {categories.map((item) => (
          <button
            key={item}
            onClick={() => setCategory(item)}
            className={`rounded-md border px-3 py-2 text-sm capitalize transition ${
              category === item
                ? "border-[#43c6ac] bg-[#43c6ac]/14 text-[#bdf4e9]"
                : "border-[#31445f] bg-[#0d1728] text-slate-300 hover:bg-[#13213a]"
            }`}
          >
            {item}
          </button>
        ))}
      </div>
      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-5">
            <EmptyState title="No findings in this view" body="The selected category has no findings for this run." />
          </div>
        ) : (
          <>
          <div className="grid gap-3 p-4 md:hidden">
            {filtered.map((finding) => {
              const evidence = finding.evidence[0];
              return (
                <div key={finding.id} className="min-w-0 rounded-md border border-[#26364d] bg-[#091424] p-4">
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <SeverityBadge severity={finding.severity} />
                    <span className="text-xs capitalize text-slate-400">{finding.category}</span>
                  </div>
                  <h3 className="mt-3 min-w-0 text-sm font-semibold text-white">{finding.title}</h3>
                  <p className="mt-2 min-w-0 text-xs leading-5 text-slate-400">{finding.impact || finding.description}</p>
                  <div className="mt-3 min-w-0 space-y-2 text-xs">
                    <p className="min-w-0 truncate font-mono text-slate-200">{finding.resource_address ?? "resource not mapped"}</p>
                    <p className="min-w-0 truncate font-mono text-slate-500">{evidence?.json_path ?? "no JSON path"}</p>
                  </div>
                  <Button variant="secondary" onClick={() => setSelected(finding)} className="mt-4 min-h-9 w-full min-w-0 px-3">
                    <Eye className="h-4 w-4" /> Review evidence
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-[#24324a] bg-[#101b2d] text-xs uppercase tracking-[0.12em] text-slate-400">
                <tr>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Finding</th>
                  <th className="px-4 py-3">Evidence</th>
                  <th className="px-4 py-3">Terraform target</th>
                  <th className="px-4 py-3">Reviewer</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((finding) => {
                  const evidence = finding.evidence[0];
                  return (
                    <tr key={finding.id} className="border-b border-[#1d2a3f] last:border-0">
                      <td className="px-4 py-4 align-top"><SeverityBadge severity={finding.severity} /></td>
                      <td className="px-4 py-4 align-top">
                        <p className="font-medium text-white">{finding.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{finding.impact || finding.description}</p>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="rounded-full border border-[#31445f] px-2 py-1 capitalize text-slate-300">{finding.category}</span>
                          <span className="rounded-full border border-[#31445f] px-2 py-1 text-slate-300">{Math.round(finding.confidence * 100)}% confidence</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <p className="max-w-72 truncate font-mono text-xs text-slate-200">{evidence?.json_path ?? "no JSON path"}</p>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{evidence?.explanation ?? "Evidence was not attached to this finding."}</p>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <p className="max-w-64 truncate font-mono text-xs text-slate-200">{finding.resource_address ?? "resource not mapped"}</p>
                        <p className="mt-2 text-xs text-slate-500">{finding.change_actions.join(", ") || "action not reported"}</p>
                        <div className="mt-2 max-w-64 truncate font-mono text-xs text-slate-400">
                          {finding.pr_file_path ? (
                            finding.pr_file_url ? (
                              <a href={finding.pr_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#9eeadf] hover:text-white">
                                {finding.pr_file_path}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : (
                              finding.pr_file_path
                            )
                          ) : (
                            "PR file not mapped"
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <p className="text-xs capitalize text-slate-300">{finding.source.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs text-slate-500">{finding.reviewer_node}</p>
                      </td>
                      <td className="px-4 py-4 align-top">
                        <Button variant="secondary" onClick={() => setSelected(finding)} className="min-h-9 px-3">
                          <Eye className="h-4 w-4" /> Review
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </Card>
      {selected ? <FindingDrawer finding={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function FindingDrawer({ finding, onClose }: { finding: Finding; onClose: () => void }) {
  const evidence = finding.evidence[0];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/55">
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-[#31445f] bg-[#081120] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <SeverityBadge severity={finding.severity} />
            <h2 className="mt-4 text-2xl font-semibold text-white">{finding.title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">{finding.description}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-2 text-slate-400 hover:bg-white/8 hover:text-white" aria-label="Close finding detail">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 grid gap-4">
          <DetailBlock title="Why this matters">
            <div className="grid gap-3 text-sm md:grid-cols-2">
              <ImpactMetric label="Resource" value={finding.resource_address ?? "resource not mapped"} mono />
              <ImpactMetric label="Terraform action" value={finding.change_actions.join(", ") || "not reported"} />
              <ImpactMetric label="Changed file" value={finding.pr_file_path ?? "not mapped to a PR file"} mono />
              <ImpactMetric label="Primary evidence" value={evidence?.json_path ?? "no JSON path"} mono />
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {finding.impact || "This finding is tied to deployable Terraform evidence and should be reviewed before apply."}
            </p>
          </DetailBlock>
          <DetailBlock title="Impact" body={finding.impact} />
          <DetailBlock title="Recommendation" body={finding.recommendation} />
          <DetailBlock title="Evidence">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-slate-500">JSON path</dt>
                <dd className="mt-1 font-mono text-slate-200">{evidence?.json_path ?? "n/a"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Observed</dt>
                <dd className="mt-1 rounded-md bg-[#07101d] p-3 font-mono text-xs text-slate-200">{String(evidence?.observed_value ?? "n/a")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Expected</dt>
                <dd className="mt-1 rounded-md bg-[#07101d] p-3 font-mono text-xs text-slate-200">{String(evidence?.expected_value ?? "n/a")}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Rule</dt>
                <dd className="mt-1 text-slate-200">{evidence?.rule_id ?? "n/a"} - {evidence?.explanation ?? ""}</dd>
              </div>
            </dl>
          </DetailBlock>
          {finding.pr_file_path || finding.pr_patch ? (
            <DetailBlock title="GitHub PR context">
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">Changed file</dt>
                  <dd className="mt-1 font-mono text-slate-200">
                    {finding.pr_file_url ? (
                      <a href={finding.pr_file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[#9eeadf] hover:text-white">
                        {finding.pr_file_path}
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    ) : (
                      finding.pr_file_path ?? "n/a"
                    )}
                  </dd>
                </div>
                {finding.pr_patch ? (
                  <div>
                    <dt className="text-slate-500">Patch excerpt</dt>
                    <dd>
                      <pre className="mt-1 max-h-80 overflow-auto rounded-md border border-[#25364d] bg-[#07101d] p-3 text-xs leading-6 text-slate-200">{finding.pr_patch}</pre>
                    </dd>
                  </div>
                ) : null}
              </dl>
            </DetailBlock>
          ) : null}
          {finding.remediation ? (
            <DetailBlock title="Remediation">
              <p className="text-sm leading-6 text-slate-400">{finding.remediation.explanation}</p>
              <pre className="mt-3 overflow-x-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-100">{finding.remediation.snippet}</pre>
              <p className="mt-3 text-xs text-slate-500">Risk of change: {finding.remediation.risk_of_change}</p>
            </DetailBlock>
          ) : null}
          {finding.runbook_checklist.length ? (
            <DetailBlock title="Operational checklist">
              <ul className="space-y-2 text-sm text-slate-200">
                {finding.runbook_checklist.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-[#43c6ac]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </DetailBlock>
          ) : null}
          <DetailBlock title="Compliance references" body={finding.compliance_refs.join(", ") || "Internal TerraGate Policy"} />
          <DetailBlock title="Review metadata" body={`${finding.source.replaceAll("_", " ")} via ${finding.reviewer_node}. Human review: ${finding.requires_human_review ? "required" : "not required"}.`} />
        </div>
      </aside>
    </div>
  );
}

function ImpactMetric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-[#26364d] bg-[#07101d] p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className={mono ? "mt-1 truncate font-mono text-xs text-slate-100" : "mt-1 truncate text-sm font-medium text-slate-100"}>{value}</p>
    </div>
  );
}

function DetailBlock({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <section className="rounded-lg border border-[#25364d] bg-[#0d1728] p-4">
      <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">{title}</h3>
      {body ? <p className="mt-3 text-sm leading-6 text-slate-200">{body}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}
