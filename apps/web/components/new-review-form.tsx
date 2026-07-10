"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ExternalLink, FileJson, GitPullRequest, Play, ShieldCheck, UploadCloud } from "lucide-react";
import { createDemoTerraformReview, createTerraformReview, getCurrentUser, getGitHubPrContext, getRuntimeCapabilities, listPolicyPacks } from "@/lib/api";
import { demoScenarioReviewOptions } from "@/lib/showcase";
import type { GitHubPRContext, PolicyPack } from "@/types/api";
import { AlertBanner, Button, Card, FieldLabel } from "@/components/ui";
import { DeploymentStatusPanel } from "@/components/deployment-status-panel";

const sampleReviews = [
  {
    sample: "risky-security",
    title: "Security risk review",
    description: "Public SSH, public RDS, and wildcard IAM policy findings.",
    cta: "Launch security review",
    badge: "Security controls"
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

export function NewReviewForm() {
  const router = useRouter();
  const uploadSectionRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
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
  const [sandboxAvailable, setSandboxAvailable] = useState(false);
  const [samplesAvailable, setSamplesAvailable] = useState(false);
  const [maxPlanBytes, setMaxPlanBytes] = useState<number | null>(null);
  const [canCreateReview, setCanCreateReview] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    Promise.allSettled([listPolicyPacks(), getRuntimeCapabilities(), getCurrentUser()]).then(([packResult, capabilityResult, userResult]) => {
      if (packResult.status === "fulfilled") setPolicyPacks(packResult.value);
      if (capabilityResult.status === "fulfilled") {
        setSandboxAvailable(capabilityResult.value.terraform_sandbox === "enabled");
        setSamplesAvailable(capabilityResult.value.public_demo || capabilityResult.value.auth_provider === "dev");
        setMaxPlanBytes(capabilityResult.value.max_upload_bytes);
      }
      if (userResult.status === "fulfilled") setCanCreateReview(userResult.value.role === "reviewer" || userResult.value.role === "platform-admin");
      setAccessChecked(true);
    });
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canCreateReview) {
      setError("Reviewer or platform administrator access is required to create Terraform reviews.");
      return;
    }
    if (executionMode === "uploaded_plan" && !file) {
      setUploadError("Choose a Terraform plan JSON file before starting the review.");
      setError(null);
      window.requestAnimationFrame(() => uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
      return;
    }
    if (executionMode === "uploaded_plan" && file) {
      const fileError = await validatePlanFile(file, maxPlanBytes);
      if (fileError) {
        setUploadError(fileError);
        window.requestAnimationFrame(() => uploadSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
        return;
      }
    }
    if (prUrl.trim() && !repoOwner && !repoName && !pullNumber) {
      setError("Parse the GitHub pull request URL before starting the review, or clear the URL field.");
      return;
    }
    const githubError = validateGitHubContext(repoOwner, repoName, pullNumber);
    if (githubError) {
      setError(githubError);
      return;
    }
    if (executionMode === "sandbox_plan") {
      if (!terraformWorkingDir.trim()) {
        setError("Enter a working directory under the configured Terraform sandbox root.");
        return;
      }
      const envError = validateJsonObject(terraformEnvVarsJson, "Terraform environment variables");
      if (envError) {
        setError(envError);
        return;
      }
      if (terraformBackendEnabled) {
        const backendError = validateJsonObject(terraformBackendConfigJson, "Terraform backend configuration");
        if (backendError) {
          setError(backendError);
          return;
        }
      }
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
    const githubError = validateGitHubContext(repoOwner, repoName, pullNumber, true);
    if (githubError) {
      setError(githubError);
      return;
    }
    setFetchingPr(true);
    setError(null);
    setPrContext(null);
    try {
      const context = await getGitHubPrContext(repoOwner, repoName, pullNumber);
      if (!context.available || context.mock) {
        setError(context.message || "Live GitHub PR context is not available in this environment.");
        return;
      }
      setPrContext(context);
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
      const result = await createDemoTerraformReview(sample, demoScenarioReviewOptions(sample));
      router.push(`/runs/${result.run_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch example review.");
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
          Upload Terraform plan JSON, choose the policy context, and optionally attach the GitHub pull request that produced the change.
        </p>
      </div>

      {statusMessage ? <AlertBanner tone="info" title="Review in progress">{statusMessage}</AlertBanner> : null}
      {error ? <div ref={errorRef} tabIndex={-1}><AlertBanner tone="danger" title="Review could not start" onDismiss={() => setError(null)}>{error}</AlertBanner></div> : null}
      {accessChecked && !canCreateReview ? <AlertBanner tone="warning" title="Read-only access">Reviewer or platform administrator access is required to create a review.</AlertBanner> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <div className="flex min-w-0 flex-col gap-6">
          {samplesAvailable ? <Card className="order-2 p-6">
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#43c6ac]/40 bg-[#43c6ac]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#9aeadc]">
                  <Play className="h-3.5 w-3.5" />
                  Example data
                </div>
                <h2 className="mt-4 text-xl font-semibold text-white">Explore with a sample plan</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                  Creates a clearly labeled sample run using bundled Terraform data. It never reads a real repository or performs a GitHub write.
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
                    disabled={launchingSample !== null || submitting || !canCreateReview}
                  >
                    <Play className="h-4 w-4" />
                    {launchingSample === sample.sample ? "Creating review..." : sample.cta}
                  </Button>
                </div>
              ))}
            </div>
          </Card> : null}

          <Card className="order-1 p-6">
            <div className="mb-6 flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                <FileJson className="h-5 w-5 text-[#43c6ac]" />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-white">Review a Terraform plan</h2>
                <p className="mt-1 text-sm text-slate-400">Use JSON produced by <code className="text-slate-300">terraform show -json</code>.</p>
              </div>
            </div>

            <form onSubmit={onSubmit} className="space-y-6">
              <div ref={uploadSectionRef}>
                <label htmlFor="terraform-plan-file"><FieldLabel>Terraform plan JSON</FieldLabel></label>
                <label htmlFor="terraform-plan-file" className={`mt-2 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-[#091424] px-6 py-8 text-center transition hover:border-[#43c6ac] ${uploadError ? "border-red-300/70 ring-2 ring-red-400/20" : "border-[#3a506d]"}`}>
                  <UploadCloud className="h-8 w-8 text-[#6ea8fe]" />
                  <span className="mt-3 text-sm font-medium text-white">{file ? file.name : "Choose tfplan.json"}</span>
                  <span id="terraform-plan-help" className="mt-2 max-w-xl text-xs leading-5 text-slate-400">
                    JSON only{maxPlanBytes ? `, up to ${formatFileSize(maxPlanBytes)}` : ""}. TerraGate validates the shape and redacts sensitive values before reviewer enrichment.
                  </span>
                  {file ? <span className="mt-2 text-xs font-medium text-[#9aeadc]">{formatFileSize(file.size)} selected</span> : null}
                  <input
                    id="terraform-plan-file"
                    name="terraform-plan-file"
                    type="file"
                    accept="application/json,.json"
                    className="sr-only"
                    aria-invalid={Boolean(uploadError)}
                    aria-describedby={`terraform-plan-help${uploadError ? " terraform-plan-error" : ""}`}
                    onChange={(event) => {
                      const selectedFile = event.target.files?.[0] ?? null;
                      setFile(selectedFile);
                      setExecutionMode("uploaded_plan");
                      setUploadError(null);
                      setError(null);
                      if (selectedFile) {
                        void validatePlanFile(selectedFile, maxPlanBytes).then((validationError) => {
                          if (validationError) setUploadError(validationError);
                        });
                      }
                    }}
                  />
                </label>
                {uploadError ? (
                  <div id="terraform-plan-error" className="mt-3 rounded-md border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-100" role="alert">
                    {uploadError}
                  </div>
                ) : null}
              </div>

              {sandboxAvailable ? (
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
                        <label className="space-y-2">
                          <span className="text-xs font-medium text-slate-300">Working directory</span>
                          <input
                            value={terraformWorkingDir}
                            onChange={(event) => setTerraformWorkingDir(event.target.value)}
                            placeholder="relative path under sandbox root"
                            className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                          />
                        </label>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-2">
                            <span className="text-xs font-medium text-slate-300">Workspace (optional)</span>
                            <input value={terraformWorkspace} onChange={(event) => setTerraformWorkspace(event.target.value)} placeholder="default" className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                          </label>
                          <label className="space-y-2">
                            <span className="text-xs font-medium text-slate-300">Variable file (optional)</span>
                            <input value={terraformVarFile} onChange={(event) => setTerraformVarFile(event.target.value)} placeholder="prod.tfvars" className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                          </label>
                        </div>
                        <label className="space-y-2">
                          <span className="text-xs font-medium text-slate-300">Environment variables JSON (optional)</span>
                          <textarea value={terraformEnvVarsJson} onChange={(event) => setTerraformEnvVarsJson(event.target.value)} placeholder='{"TF_VAR_region":"us-east-1"}' className="min-h-20 w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-500" />
                        </label>
                        <label className="flex items-center gap-2 text-sm text-slate-300">
                          <input type="checkbox" checked={terraformBackendEnabled} onChange={(event) => setTerraformBackendEnabled(event.target.checked)} />
                          Enable backend config for sandbox init
                        </label>
                        {terraformBackendEnabled ? (
                          <label className="space-y-2">
                            <span className="text-xs font-medium text-slate-300">Backend configuration JSON</span>
                            <textarea value={terraformBackendConfigJson} onChange={(event) => setTerraformBackendConfigJson(event.target.value)} placeholder='{"bucket":"tf-state"}' className="min-h-20 w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 font-mono text-xs text-white placeholder:text-slate-500" />
                          </label>
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
                    {(policyPacks.length ? policyPacks : [{ name: "default" }] as PolicyPack[]).map((pack) => (
                      <option key={pack.name} value={pack.name}>{pack.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="rounded-lg border border-[#2b3d58] bg-[#0a1424] p-4">
                <div className="mb-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                    <GitPullRequest className="h-4 w-4 text-[#6ea8fe]" />
                    Optional GitHub PR context
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">Attach changed-file and redacted patch evidence to this plan review. A PR URL does not replace the Terraform plan.</p>
                </div>
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <label className="space-y-2">
                    <span className="text-xs font-medium text-slate-300">Pull request URL</span>
                    <input
                      id="github-pr-url"
                      type="url"
                      value={prUrl}
                      onChange={(event) => setPrUrl(event.target.value)}
                      placeholder="https://github.com/org/repo/pull/123"
                      autoComplete="url"
                      className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
                    />
                  </label>
                  <div className="flex items-end">
                    <Button type="button" variant="secondary" onClick={parsePrUrl} disabled={!prUrl.trim()}>
                      Parse URL
                    </Button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <label className="mt-4 space-y-2">
                    <span className="text-xs font-medium text-slate-300">Repository owner</span>
                    <input value={repoOwner} onChange={(event) => setRepoOwner(event.target.value)} placeholder="acme" autoComplete="off" className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                  </label>
                  <label className="mt-4 space-y-2">
                    <span className="text-xs font-medium text-slate-300">Repository name</span>
                    <input value={repoName} onChange={(event) => setRepoName(event.target.value)} placeholder="infrastructure" autoComplete="off" className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                  </label>
                  <label className="mt-4 space-y-2">
                    <span className="text-xs font-medium text-slate-300">Pull request number</span>
                    <input value={pullNumber} onChange={(event) => setPullNumber(event.target.value.replace(/[^0-9]/g, ""))} placeholder="42" inputMode="numeric" pattern="[0-9]*" className="w-full rounded-md border border-[#31445f] bg-[#09111f] px-3 py-2.5 text-sm text-white placeholder:text-slate-500" />
                  </label>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button type="button" variant="secondary" onClick={() => void fetchPrContext()} disabled={fetchingPr}>
                    <GitPullRequest className="h-4 w-4" /> {fetchingPr ? "Fetching PR..." : "Fetch PR context"}
                  </Button>
                  <span className="text-xs text-slate-500">Live context requires a configured server-side GitHub credential.</span>
                </div>
                {prContext ? <GitHubContextPreview context={prContext} /> : null}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={submitting || launchingSample !== null || Boolean(uploadError) || !canCreateReview} aria-busy={submitting}>
                  {submitting ? "Creating review..." : "Run uploaded plan review"}
                </Button>
                <span className="text-xs text-slate-500">{file || executionMode === "sandbox_plan" ? "You will be taken to live graph progress after creation." : "Choose a plan JSON first."}</span>
              </div>
            </form>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card className="p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-1 h-5 w-5 text-amber-300" />
              <div>
                <h2 className="text-base font-semibold text-white">Plan privacy</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Terraform plans can expose secrets, resource names, provider values, and topology. Uploaded plans are stored as review artifacts and redacted before any optional AI enrichment.
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
    if (!Number.isInteger(parsedPull) || parsedPull < 1) return null;
    return { owner, repo, pullNumber: parsedPull };
  } catch {
    return null;
  }
}

async function validatePlanFile(file: File, maxBytes: number | null): Promise<string | null> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    return "Terraform plans must be uploaded as a .json file generated by terraform show -json.";
  }
  if (file.size === 0) return "The selected Terraform plan is empty.";
  if (maxBytes && file.size > maxBytes) {
    return `The selected plan is ${formatFileSize(file.size)}. This environment accepts files up to ${formatFileSize(maxBytes)}.`;
  }
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { resource_changes?: unknown }).resource_changes)) {
      return "This JSON does not contain a Terraform resource_changes array. Generate it with terraform show -json.";
    }
  } catch {
    return "The selected file is not valid JSON. Regenerate it with terraform show -json and try again.";
  }
  return null;
}

function validateGitHubContext(owner: string, repo: string, pullNumber: string, required = false): string | null {
  const values = [owner.trim(), repo.trim(), pullNumber.trim()];
  if (!required && values.every((value) => !value)) return null;
  if (values.some((value) => !value)) return "Enter the repository owner, repository name, and pull request number together.";
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    return "Repository owner and name may contain letters, numbers, periods, underscores, and hyphens.";
  }
  const parsedPull = Number(pullNumber);
  if (!Number.isInteger(parsedPull) || parsedPull < 1) return "Pull request number must be a positive whole number.";
  return null;
}

function validateJsonObject(value: string, label: string): string | null {
  if (!value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return `${label} must be a JSON object.`;
    return null;
  } catch {
    return `${label} contains invalid JSON.`;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
        <Metric label="Source" value={context.mock ? "unavailable" : "live GitHub"} />
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
