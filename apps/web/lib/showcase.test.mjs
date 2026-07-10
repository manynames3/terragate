import assert from "node:assert/strict";
import test from "node:test";

import { presentShowcaseRun } from "./showcase.ts";

test("showcase enrichment preserves the persisted backend risk score", () => {
  const run = {
    id: "run_safe_regression",
    mode: "terraform_pr_review",
    status: "approval_pending",
    environment: "dev",
    cloud_provider: "aws",
    policy_profile: "default",
    risk_score: 0,
    risk_level: "low",
    summary: "No material policy risks were detected in this Terraform plan.",
    approval_status: "pending",
    created_at: "2026-07-10T12:00:00Z",
    completed_at: "2026-07-10T12:00:06Z",
    severity_counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    repo_owner: "acme-infra",
    repo_name: "terraform-observability",
    pull_number: 41,
    terraform_execution: { mode: "demo_sample", sample: "safe" },
    github_pr_context: null,
    github_check: null,
    cost_estimate: {
      currency: "USD",
      monthly_delta: 0,
      annual_delta: 0,
      threshold: 500,
      over_threshold: false,
      source: "heuristic",
      message: "No material monthly delta detected.",
      line_items: []
    },
    blast_radius: {
      score: 0,
      level: "low",
      summary: "No destructive stateful changes detected.",
      stateful_changes: []
    }
  };

  const presented = presentShowcaseRun(run);

  assert.equal(presented.risk_score, 0);
  assert.equal(presented.risk_level, "low");
});
