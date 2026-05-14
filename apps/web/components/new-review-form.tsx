"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ExternalLink, FileJson, GitPullRequest, UploadCloud } from "lucide-react";
import { createTerraformReview, getGitHubPrContext, listPolicyPacks } from "@/lib/api";
import type { GitHubPRContext, PolicyPack } from "@/types/api";
import { Button, Card, FieldLabel } from "@/components/ui";

export function NewReviewForm() {
  const router = useRouter();
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
  const [prContext, setPrContext] = useState<GitHubPRContext | null>(null);
  const [fetchingPr, setFetchingPr] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPolicyPacks()
      .then(setPolicyPacks)
      .catch(() => setPolicyPacks([]));
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (executionMode === "uploaded_plan" && !file) {
      setError("Choose a Terraform plan JSON file.");
      return;
    }
    setSubmitting(true);
    setError(null);
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

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
            <FileJson className="h-5 w-5 text-[#43c6ac]" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-white">New Terraform PR review</h1>
            <p className="mt-1 text-sm text-slate-400">Upload a plan JSON file and run the LangGraph review workflow.</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-6">
          <div>
            <FieldLabel>Terraform plan JSON</FieldLabel>
            <label className="mt-2 flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#3a506d] bg-[#091424] px-6 py-8 text-center transition hover:border-[#43c6ac]">
              <UploadCloud className="h-8 w-8 text-[#6ea8fe]" />
              <span className="mt-3 text-sm font-medium text-white">{file ? file.name : "Drop or choose tfplan.json"}</span>
              <span className="mt-2 max-w-xl text-xs leading-5 text-slate-400">Generated from terraform show -json. The backend stores raw and redacted artifacts, but only reduced redacted evidence is eligible for AI explanation.</span>
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>
          </div>

          <div className="rounded-lg border border-[#2b3d58] bg-[#0a1424] p-4">
            <FieldLabel>Plan source</FieldLabel>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => setExecutionMode("uploaded_plan")}
                className={`rounded-md border px-4 py-3 text-left text-sm ${executionMode === "uploaded_plan" ? "border-[#43c6ac] bg-[#102033] text-white" : "border-[#26364d] bg-[#091424] text-slate-300"}`}
              >
                Upload existing plan JSON
                <span className="mt-1 block text-xs text-slate-500">Default demo path; deterministic parser reads the uploaded artifact.</span>
              </button>
              <button
                type="button"
                onClick={() => setExecutionMode("sandbox_plan")}
                className={`rounded-md border px-4 py-3 text-left text-sm ${executionMode === "sandbox_plan" ? "border-[#43c6ac] bg-[#102033] text-white" : "border-[#26364d] bg-[#091424] text-slate-300"}`}
              >
                Sandbox Terraform plan
                <span className="mt-1 block text-xs text-slate-500">Opt-in backend mode; runs only under TERRAFORM_SANDBOX_ROOT.</span>
              </button>
            </div>
            {executionMode === "sandbox_plan" ? (
              <div className="mt-4 grid gap-3">
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
              </div>
            ) : null}
          </div>

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
              Optional GitHub PR context
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
              <span className="text-xs text-slate-500">Uses the backend `GITHUB_TOKEN`; falls back to a clear dev placeholder when unset.</span>
            </div>
            {prContext ? <GitHubContextPreview context={prContext} /> : null}
          </div>

          {error ? <div className="rounded-md border border-red-400/40 bg-red-500/12 px-4 py-3 text-sm text-red-100">{error}</div> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Running review..." : "Run LangGraph review"}
            </Button>
            <span className="text-xs text-slate-500">Runs usually complete in a few seconds for sample plans.</span>
          </div>
        </form>
      </Card>

      <div className="space-y-4">
        <Card className="p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-1 h-5 w-5 text-amber-300" />
            <div>
              <h2 className="text-base font-semibold text-white">Sensitive data warning</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">Terraform plan JSON can expose provider outputs, generated passwords, access keys, and connection strings. This app redacts suspicious keys before AI review, but raw artifacts should still be treated as sensitive.</p>
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
        <Card className="p-5">
          <h2 className="text-base font-semibold text-white">Sample plans</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Use files in sample-data/terraform-plans for a demo: risky-security-plan.json, risky-cost-plan.json, or destructive-prod-plan.json.</p>
        </Card>
      </div>
    </div>
  );
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
        <Metric label="Source" value={context.mock ? "dev placeholder" : "live GitHub"} />
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
