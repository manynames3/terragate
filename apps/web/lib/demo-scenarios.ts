export type DemoScenario = {
  sample: "risky-security" | "destructive-prod" | "risky-cost";
  badge: string;
  title: string;
  description: string;
  cta: string;
  expected: string;
  decision: string;
  focus: string;
  outcome: string;
  tone: "danger" | "warn" | "info";
};

export const demoScenarios: DemoScenario[] = [
  {
    sample: "risky-security",
    badge: "Best first demo",
    title: "Security risk review",
    description: "Public SSH, public RDS, and wildcard IAM policy findings mapped to Terraform evidence.",
    cta: "Run security demo",
    expected: "Critical risk with public exposure evidence",
    decision: "Block merge",
    focus: "Security reviewer + governance policy checks",
    outcome: "Shows why the PR should not merge until ingress, database exposure, and IAM scope are fixed.",
    tone: "danger"
  },
  {
    sample: "destructive-prod",
    badge: "Operational risk",
    title: "Production blast radius",
    description: "Stateful replacement risk with rollback, backup, and approval checklist details.",
    cta: "Run prod demo",
    expected: "High risk from stateful replacements",
    decision: "Require operator approval",
    focus: "Blast radius + runbook readiness",
    outcome: "Makes the reviewer check rollback, backups, deletion protection, and maintenance timing before merge.",
    tone: "warn"
  },
  {
    sample: "risky-cost",
    badge: "Cost control",
    title: "Cost spike review",
    description: "Large compute, NAT gateway, cost-center, and policy threshold checks.",
    cta: "Run cost demo",
    expected: "Cost threshold exceeded",
    decision: "Review budget impact",
    focus: "Cost reviewer + governance tags",
    outcome: "Explains monthly impact, ownership gaps, and the approval path for expensive infrastructure.",
    tone: "info"
  }
];

export const primaryDemoScenario = demoScenarios[0];

export const trustSignals = [
  {
    title: "Evidence before explanation",
    description: "Rules parse the Terraform plan and attach JSON-path evidence before AI-assisted summaries are generated."
  },
  {
    title: "Approval before external writes",
    description: "GitHub comments and suggested commits are drafted first, then blocked until a reviewer approves them."
  },
  {
    title: "Redacted reviewer inputs",
    description: "Secret-like values, plan internals, and PR patch context are reduced before reviewer nodes use them."
  },
  {
    title: "Auditable demo history",
    description: "Runs keep findings, check status, approval state, policy context, artifacts, and action history."
  }
];
