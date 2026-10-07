import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { canDecideReview, canPostReview } from "./review-actions.ts";

const run = { id: "run_real", status: "approval_pending", approval_status: "pending", completed_at: "2026-10-07T12:00:00Z" };
const report = { run_id: run.id, pr_comment_draft: "Exact API draft", review_snapshot_hash: "a".repeat(64), approval_valid: false };

test("decisions require a completed review and the matching displayed draft", () => {
  assert.equal(canDecideReview(run, report), true);
  for (const status of ["queued", "running", "failed", "comment_posted", "mock_comment_ready"]) {
    assert.equal(canDecideReview({ ...run, status }, report), false);
  }
  assert.equal(canDecideReview({ ...run, completed_at: null }, report), false);
  assert.equal(canDecideReview(run, { ...report, run_id: "run_other" }), false);
  assert.equal(canDecideReview(run, { ...report, pr_comment_draft: "" }), false);
  assert.equal(canDecideReview(run, { ...report, decision_blocker: "Run a new review" }), false);
});

test("posting requires a current versioned approval and cannot repeat a completed post", () => {
  const approved = { ...run, status: "approved", approval_status: "approved" };
  assert.equal(canPostReview(approved, report), false);
  assert.equal(canPostReview(approved, { ...report, approval_valid: true }), true);
  assert.equal(canPostReview({ ...approved, status: "comment_posted" }, { ...report, approval_valid: true }), false);
});

test("customer views use API data without scenario enrichment or score recalibration", () => {
  for (const name of ["dashboard", "run-detail", "approval-center", "reports-center", "compliance-center", "runbook-center"]) {
    const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /presentShowcase|presentRunListItem|lib\/showcase|calibratedListRiskScore/);
  }
  const detail = readFileSync(new URL("../components/run-detail.tsx", import.meta.url), "utf8");
  assert.match(detail, /setRun\(runData\)/);
  assert.match(detail, /setReport\(reportData\)/);
});
