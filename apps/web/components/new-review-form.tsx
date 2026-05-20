"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, FileJson, GitPullRequest, LockKeyhole, Play, ShieldCheck, UploadCloud } from "lucide-react";
import { createDemoTerraformReview, createTerraformReview, getGitHubPrContext, listPolicyPacks } from "@/lib/api";
import type { GitHubPRContext, PolicyPack } from "@/types/api";
import { Button, Card, FieldLabel } from "@/components/ui";
import { DeploymentStatusPanel } from "@/components/deployment-status-panel";

const sampleReviews = [
  {
    sample: "risky-security",
    title: "Security risk review",
    description: "Public SSH, public RDS, and wildcard IAM policy findings.",
    cta: "Launch security review",
    badge: "Best first demo"
  },
  {
    sample: "destructive-prod",
    title: "Production blast radius",
    description: "Stateful replacement risk with rollback and approval checklist.",
    cta: "Launch prod review",
    badge: "Operational risk"
  },
  {
    sample: "risky-cost",
    title: "Cost spike review",
    description: "Large compute, NAT gateway, cost-center, and policy threshold checks.",
    cta: "Launch cost review",
    badge: "Cost control"
  }
];

const reviewFlowSteps = [
  "Validate Terraform plan JSON and summarize changed resources.",
  "Redact secret-like values before reviewer nodes use the artifact.",
  "Run deterministic security, cost, reliability, governance, and compliance checks.",
  "Generate evidence-backed findings, remediations, runbook steps, and a PR comment draft.",
  "Require approval before posting a GitHub comment or committing a suggested patch."
];

const privateDeploymentChecks = [
  "Cognito or another real identity provider is required for private team use.",
  "GitHub writes stay mocked in the hosted demo and become live only when credentials are configured.",
  "Terraform sandbox execution is disabled here; use a private deployment for repo plan generation.",
  "Infracost is optional, with heuristic estimates clearly labeled when it is not configured."
];

const showSandboxControls = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").includes("localhost");

export function NewReviewForm() {
  const router = useRouter();
  const uploadSectionRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [environment, setEnvironment] = useState("dev");
  const [cloudProvider, setCloudProvider] = useState("aws");
  const [policyProfile, setPolicyProfile] = useState("default");
  const [policyPacks, setPolicyPacks] = useState<PolicyPack[]>([]);
  const [executionMode, setExecutionMode] = useState("uploaded_plan");
  const [terraformWorkingDir, setTerraformWorkingDir] = useState("");
  const [terraformWorkspace, setTerraformWorkspace] = useState("");
  const [terraformVarFile, setTerraformVarFile] = useState("");
  const [terraformBackendEnabled, setTerraformBackendEnabled] = useState(false);
  const [terraformEnvVarsJson, setTerraformEnvVarsJson] = useState("");
  const [terraformBackendConfigJson, setTerraformBackendConfigJson] = useState("");
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [pullNumber, setPullNumber] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [prContext, setPrContext] = useState<GitHubPRContext | null>(null);
  const [fetchingPr, setFetchingPr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [launchingSample, setLaunchingSample] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    listPolicyPacks()
      .then(setPolicyPacks)
      .catch(() => setPolicyPacks([]));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (executionMode === "uploaded_plan" && !file) {
      setUploadError("Choose a Terraform plan JSON file first, or launch a hosted-safe sample from the sample plans panel.");
      setError(null);
      window.requestAnimationFrame(() => uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    setSubmitting(true);
    setError(null);
    setUploadError(null);
    setStatusMessage("Uploading Terraform plan and creating the review run...");
    const formData = new FormData();
    if (file) formData.append("file", file);
    formData.append("environment", environment);
    formData.append("cloud_provider", cloudProvider);
    formData.append("policy_profile", policyProfile);
    formData.append("execution_mode", executionMode);
    if (terraformWorkingDir) formData.append("terraform_working_dir", terraformWorkingDir);
    if (terraformWorkspace) formData.append("terraform_workspace", terraformWorkspace);
    if (terraformVarFile) formData.append("terraform_var_file", terraformVarFile);
    if (terraformEnvVarsJson) formData.append("terraform_env_vars_json", terraformEnvVarsJson);
    if (terraformBackendConfigJson) formData.append("terraform_backend_config_json", terraformBackendConfigJson);
    formData.append("terraform_backend_enabled", String(terraformBackendEnabled));
    if (repoOwner) formData.append("repo_owner", repoOwner);
    if (repoName) formData.append("repo_name", repoName);
    if (pullNumber) formData.append("pull_number", pullNumber);

    try {
      const result = await createTerraformReview(formData);
      router.push(`/runs/${result.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create review.");
    } finally {
      setSubmitting(false);
      setStatusMessage(null);
    }
  }

  async function fetchPrContext() {
    if (!repoOwner || !repoName || !pullNumber) {
      setError("Enter repo owner, repo name, and pull number before fetching PR context.");
      return;
    }
    setFetchingPr(true);
    setError(null);
    setPrContext(null);
    try {
      setPrContext(await getGitHubPrContext(repoOwner, repoName, pullNumber));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch GitHub PR context.");
    } finally {
      setFetchingPr(false);
    }
  }

  function parsePrUrl() {
    const parsed = parseGitHubPrUrl(prUrl);
    if (!parsed) {
      setError("Paste a GitHub pull request URL like https://github.com/acme/infra/pull/42.");
      return;
    }
    setRepoOwner(parsed.owner);
    setRepoName(parsed.repo);
    setPullNumber(String(parsed.pullNumber));
    setError(null);
  }

  async function launchDemoSample(sample: string) {
    setLaunchingSample(sample);
    setError(null);
    setStatusMessage("Creating hosted sample review...");
    try {
      const result = await createDemoTerraformReview(sample);
      router.push(`/runs/${result.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch demo sample.");
    } finally {
      setLaunchingSample(null);
      setStatusMessage(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[#24324a] pb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Terraform PR review</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Start a risk review</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
          Use a hosted sample for the fastest walkthrough, attach GitHub PR context when available, or upload a Terraform plan JSON file for a real review.
        </p>
      </div>

      {statusMessage ? (
        <div className="rounded-lg border border-[#43c6ac]/40 bg-[#43c6ac]/10 px-4 py-3 text-sm text-[#baf4e9]" role="status">
          {statusMessage}
        </div>
      ) : null}
      {error ? <div className="rounded-lg border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-100">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#6ea8fe]/40 bg-[#6ea8fe]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#bdd6ff]">
                  <GitPullRequest className="h-3.5 w-3.5" />
                  Production workflow
                </div>
                <h2 className="mt-4 text-xl font-semibold text-white">Start from a GitHub PR</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Paste a PR URL to fetch changed Terraform files and attach file/patch context to findings. In a private deployment, the webhook can start reviews automatically on PR open and synchronize events.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <input
                value={prUrl}
                onChange={(event) => setPrUrl(event.target.value)}
                placeholder="https://github.com/org/repo/pull/123"
                className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
              />
              <Button type="button" variant="secondary" onClick={parsePrUrl}>
                Parse PR URL
              </Button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <input value={repoOwner} onChange={(event) => setRepoOwner(event.target.value)} placeholder="repo owner" className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
              <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="repo name" className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
              <input value={pullNumber} onChange={(event) => setPullNumber(event.target.value)} placeholder="pull number" inputMode="numeric" className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="button" onClick={() => void fetchPrContext()} disabled={fetchingPr}>
                <GitPullRequest className="h-4 w-4" /> {fetchingPr ? "Fetching PR..." : "Fetch PR context"}
              </Button>
              <span className="text-xs text-slate-500">Webhook endpoint: {webhookUrl()}</span>
            </div>
            {prContext ? <GitHubContextPreview context={prContext} /> : null}
          </Card>

          <Card className="p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#43c6ac]/40 bg-[#43c6ac]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#9aeadc]">
                  <Play className="h-3.5 w-3.5" />
                  Fastest path
                </div>
                <h2 className="mt-4 text-xl font-semibold text-white">Try a hosted sample review</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  See risk score, graph progress, evidence, remediation, approval gates, and mock GitHub actions without uploading anything sensitive.
                </p>
              </div>
            </div>
            <div className="mt-5 grid gap-3 lg:grid-cols-3">
              {sampleReviews.map((sample) => (
                <div key={sample.sample} className="rounded-lg border border-[#26364d] bg-[#091424] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#6ea8fe]">{sample.badge}</p>
                  <h3 className="mt-3 text-base font-semibold text-white">{sample.title}</h3>
                  <p className="mt-2 min-h-16 text-sm leading-6 text-slate-400">{sample.description}</p>
                  <Button
                    type="button"
                    className="mt-4 w-full"
                    variant={sample.sample === "risky-security" ? "primary" : "secondary"}
                    onClick={() => void launchDemoSample(sample.sample)}
                    disabled={launchingSample !== null || submitting}
                  >
                    <Play className="h-4 w-4" />
                    {launchingSample === sample.sample ? "Creating review..." : sample.cta}
                  </Button>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                <FileJson className="h-5 w-5 text-[#43c6ac]" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-white">Upload your own plan</h2>
                <p className="mt-1 text-sm text-slate-400">Use this path when you already have a Terraform plan JSON file.</p>
              </div>
            </div>

            <form onSubmit={onSubmit} className="space-y-6">
              <div ref={uploadSectionRef}>
                <FieldLabel>Terraform plan JSON</FieldLabel>
                <label className={`mt-2 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-[#091424] px-6 py-8 text-center transition hover:border-[#43c6ac] ${uploadError ? "border-red-300/70 ring-2 ring-red-400/20" : "border-[#3a506d]"}`}>
                  <UploadCloud className="h-8 w-8 text-[#6ea8fe]" />
                  <span className="mt-3 text-sm font-medium text-white">{file ? file.name : "Choose tfplan.json"}</span>
                  <span className="mt-2 max-w-xl text-xs leading-5 text-slate-400">
                    The app parses the plan, redacts sensitive values, and sends only reduced evidence to AI-assisted review nodes.
                  </span>
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    aria-invalid={Boolean(uploadError)}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setExecutionMode("uploaded_plan");
                      setUploadError(null);
                      setError(null);
                    }}
                  />
                </label>
                {uploadError ? (
                  <div className="mt-3 rounded-md border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-100" role="alert">
                    {uploadError}
                  </div>
                ) : null}
              </div>

              {showSandboxControls ? (
                <details className="rounded-lg border border-[#2b3d58] bg-[#0a1424] p-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-100">Advanced: sandbox Terraform plan</summary>
                  <div className="mt-4 grid gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setExecutionMode(executionMode === "sandbox_plan" ? "uploaded_plan" : "sandbox_plan");
                        setUploadError(null);
                      }}
                      className={`rounded-md border px-4 py-3 text-left text-sm ${executionMode === "sandbox_plan" ? "border-[#43c6ac] bg-[#102033] text-white" : "border-[#26364d] bg-[#091424] text-slate-300"}`}
                    >
                      {executionMode === "sandbox_plan" ? "Sandbox plan selected" : "Use sandbox plan source"}
                      <span className="mt-1 block text-xs text-slate-500">Private deployment path under TERRAFORM_SANDBOX_ROOT.</span>
                    </button>
                    {executionMode === "sandbox_plan" ? (
                      <>
                        <input
                          value={terraformWorkingDir}
                          onChange={(event) => setTerraformWorkingDir(event.target.value)}
                          placeholder="relative path under sandbox root, e.g. demo-infra"
                          className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                        />
                        <div className="grid gap-3 md:grid-cols-2">
                          <input
                            value={terraformWorkspace}
                            onChange={(event) => setTerraformWorkspace(event.target.value)}
                            placeholder="workspace, optional"
                            className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                          />
                          <input
                            value={terraformVarFile}
                            onChange={(event) => setTerraformVarFile(event.target.value)}
                            placeholder="var file, optional"
                            className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                          />
                        </div>
                        <textarea
                          value={terraformEnvVarsJson}
                          onChange={(event) => setTerraformEnvVarsJson(event.target.value)}
                          placeholder='env vars JSON, e.g. {"TF_VAR_region":"us-east-1"}'
                          className="min-h-20 w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-500"
                        />
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                          <input type="checkbox" checked={terraformBackendEnabled} onChange={(event) => setTerraformBackendEnabled(event.target.checked)} />
                          Enable backend config for sandbox init
                        </label>
                        {terraformBackendEnabled ? (
                          <textarea
                            value={terraformBackendConfigJson}
                            onChange={(event) => setTerraformBackendConfigJson(event.target.value)}
                            placeholder='backend config JSON, e.g. {"bucket":"tf-state-demo"}'
                            className="min-h-20 w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-500"
                          />
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </details>
              ) : null}

              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-2">
                  <FieldLabel>Environment</FieldLabel>
                  <select value={environment} onChange={(event) => setEnvironment(event.target.value)} className="w-full rounded-md border border-[#31445f] bg-[#0a1424] px-3 py-2.5 text-sm text-white">
                    <option value="dev">dev</option>
                    <option value="staging">staging</option>
                    <option value="prod">prod</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <FieldLabel>Cloud provider</FieldLabel>
                  <select value={cloudProvider} onChange={(event) => setCloudProvider(event.target.value)} className="w-full rounded-md border border-[#31445f] bg-[#0a1424] px-3 py-2.5 text-sm text-white">
                    <option value="aws">AWS</option>
                    <option value="azure">Azure</option>
                    <option value="gcp">GCP</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <FieldLabel>Policy profile</FieldLabel>
                  <select value={policyProfile} onChange={(event) => setPolicyProfile(event.target.value)} className="w-full rounded-md border border-[#31445f] bg-[#0a1424] px-3 py-2.5 text-sm text-white">
                    {(policyPacks.length ? policyPacks : [{ name: "default" }, { name: "restricted" }, { name: "startup_cost_control" }] as PolicyPack[]).map((pack) => (
                      <option key={pack.name} value={pack.name}>{pack.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-[#2b3d58] bg-[#0a1424] p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <GitPullRequest className="h-4 w-4 text-[#6ea8fe]" />
                  GitHub PR context attached to this review
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <input value={repoOwner} onChange={(event) => setRepoOwner(event.target.value)} placeholder="repo owner" className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                  <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="repo name" className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                  <input value={pullNumber} onChange={(event) => setPullNumber(event.target.value)} placeholder="pull number" inputMode="numeric" className="rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" onClick={() => void fetchPrContext()} disabled={fetchingPr}>
                    <GitPullRequest className="h-4 w-4" /> {fetchingPr ? "Fetching PR..." : "Fetch PR context"}
                  </Button>
                  <span className="text-xs text-slate-500">Uses configured GitHub credentials; otherwise returns a safe placeholder so the demo flow stays usable.</span>
                </div>
                {prContext ? <p className="mt-4 text-xs text-[#9aeadc]">PR context fetched above and will be saved with this review.</p> : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={submitting || launchingSample !== null}>
                  {submitting ? "Creating review..." : "Run uploaded plan review"}
                </Button>
                <span className="text-xs text-slate-500">{file || executionMode === "sandbox_plan" ? "Runs usually complete in a few seconds." : "Choose a plan JSON first."}</span>
              </div>
            </form>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 text-amber-300" />
              <div>
                <h2 className="text-base font-semibold text-white">Plan privacy</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Terraform plans can expose secrets, resource names, provider values, and topology. Hosted samples are safest for a quick trial; uploaded plans are redacted before AI review.
                </p>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <ShieldCheck className="mt-1 h-5 w-5 text-[#43c6ac]" />
              <div>
                <h2 className="text-base font-semibold text-white">What happens after submit</h2>
                <div className="mt-4 space-y-3">
                  {reviewFlowSteps.map((step) => (
                    <div key={step} className="flex gap-2 text-sm leading-5 text-slate-400">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#43c6ac]" />
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <LockKeyhole className="mt-1 h-5 w-5 text-[#6ea8fe]" />
              <div>
                <h2 className="text-base font-semibold text-white">Private deployment checklist</h2>
                <div className="mt-4 space-y-3">
                  {privateDeploymentChecks.map((item) => (
                    <div key={item} className="flex gap-2 text-sm leading-5 text-slate-400">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#6ea8fe]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
          <Card className="p-5">
            <h2 className="text-base font-semibold text-white">Generate a plan file</h2>
            <pre className="mt-4 overflow-x-auto rounded-md border border-[#25364d] bg-[#07101d] p-4 text-xs leading-6 text-slate-200">
{`terraform plan -out=tfplan.binary
terraform show -json tfplan.binary > tfplan.json`}
            </pre>
          </Card>
          <DeploymentStatusPanel />
        </div>
      </div>
    </div>
  );
}

function parseGitHubPrUrl(value: string): { owner: string; repo: string; pullNumber: number } | null {
  try {
    const url = new URL(value.trim());
    if (url.hostname !== "github.com") return null;
    const [owner, repo, pullLiteral, pullNumber] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo || pullLiteral !== "pull" || !pullNumber) return null;
    const parsedPull = Number(pullNumber);
    if (!Number.isFinite(parsedPull)) return null;
    return { owner, repo, pullNumber: parsedPull };
  } catch {
    return null;
  }
}

function webhookUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  return `${apiBase.replace(/\/$/, "")}/api/v1/github/webhook`;
}

function GitHubContextPreview({ context }: { context: GitHubPRContext }) {
  const terraformFiles = context.terraform_files.length;
  return (
    <div className="mt-4 rounded-lg border border-[#26364d] bg-[#091424] p-4">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <p className="text-sm font-semibold text-white">
            {context.title ?? `${context.repo_full_name ?? "GitHub PR"}#${context.pull_number ?? ""}`}
          </p>
          <p className="mt-1 text-xs text-slate-400">{context.message}</p>
        </div>
        {context.html_url ? (
          <a href={context.html_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[#43c6ac]">
            Open PR <ExternalLink className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
      <div className="mt-4 grid gap-3 text-sm sm:grid-cols-4">
        <Metric label="Source" value={context.mock ? "safe placeholder" : "live GitHub"} />
        <Metric label="Files" value={String(context.changed_files_count)} />
        <Metric label="Terraform files" value={String(terraformFiles)} />
        <Metric label="Diff" value={`+${context.additions} / -${context.deletions}`} />
      </div>
      {context.terraform_files.length > 0 ? (
        <div className="mt-4 space-y-2">
          {context.terraform_files.slice(0, 4).map((file) => (
            <div key={file.filename} className="flex items-center justify-between rounded-md border border-[#26364d] bg-[#07101d] px-3 py-2 text-xs">
              <span className="font-mono text-slate-200">{file.filename}</span>
              <span className="text-slate-500">+{file.additions} / -{file.deletions}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#26364d] bg-[#07101d] p-3">
      <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 font-semibold text-slate-100">{value}</p>
    </div>
  );
}
