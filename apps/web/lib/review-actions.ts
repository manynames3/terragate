type Review = { id: string; status: string; approval_status: string; completed_at?: string | null };
type Draft = { run_id: string; pr_comment_draft: string; review_snapshot_hash: string; approval_valid: boolean; decision_blocker?: string | null };

export function canDecideReview(run: Review, report: Draft): boolean {
  return report.run_id === run.id && !report.decision_blocker && Boolean(run.completed_at && report.pr_comment_draft && report.review_snapshot_hash)
    && ["approval_pending", "approved", "rejected"].includes(run.status);
}

export function canPostReview(run: Review, report: Draft): boolean {
  return canDecideReview(run, report) && run.status === "approved" && report.approval_valid;
}
