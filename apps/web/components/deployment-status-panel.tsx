"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Cloud, GitPullRequest, KeyRound, Server, ShieldCheck, WalletCards } from "lucide-react";
import { API_BASE_URL, getCurrentUser, getRuntimeCapabilities } from "@/lib/api";
import type { AuthUser, RuntimeCapabilities } from "@/types/api";
import { AlertBanner, Badge, Card } from "@/components/ui";

type StatusItem = {
  label: string;
  value: string;
  detail: string;
  tone: "success" | "info" | "neutral" | "warn";
  icon: typeof Cloud;
};

export function DeploymentStatusPanel() {
  const [capabilities, setCapabilities] = useState<RuntimeCapabilities | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [frontendTarget, setFrontendTarget] = useState("Local or self-hosted");
  const [frontendHost, setFrontendHost] = useState("Current browser origin");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const hostname = window.location.hostname;
    setFrontendTarget(hostname.endsWith("workers.dev") ? "Cloudflare Workers" : hostname === "localhost" || hostname === "127.0.0.1" ? "Local Next.js" : hostname);
    setFrontendHost(window.location.host);
    Promise.all([getRuntimeCapabilities(), getCurrentUser()])
      .then(([runtime, currentUser]) => {
        setCapabilities(runtime);
        setUser(currentUser);
      })
      .catch((requestError: Error) => setError(requestError.message));
  }, []);

  const statusItems = useMemo<StatusItem[]>(() => {
    const apiTarget = API_BASE_URL.includes("execute-api") ? "AWS API Gateway + Lambda" : "FastAPI";
    if (!capabilities) {
      return [
        { label: "Frontend", value: frontendTarget, detail: frontendHost, tone: "success", icon: Cloud },
        { label: "API", value: apiTarget, detail: "Checking runtime capabilities", tone: "info", icon: Server }
      ];
    }
    return [
      { label: "Frontend", value: frontendTarget, detail: frontendHost, tone: "success", icon: Cloud },
      { label: "API", value: apiTarget, detail: `${capabilities.environment} / ${capabilities.review_execution_mode} execution`, tone: "success", icon: Server },
      { label: "Identity", value: capabilities.auth_provider === "cognito" ? "Amazon Cognito" : "Development identity", detail: user ? `${user.email} / ${user.role}` : "Identity unavailable", tone: capabilities.auth_provider === "cognito" ? "success" : "warn", icon: KeyRound },
      { label: "GitHub writes", value: labelValue(capabilities.github_writes), detail: capabilities.github_writes === "live" ? "Approval gate remains enforced" : capabilities.github_writes === "mocked" ? "External mutation is blocked" : "No server credential configured", tone: capabilities.github_writes === "live" ? "success" : capabilities.github_writes === "mocked" ? "info" : "neutral", icon: GitPullRequest },
      { label: "Terraform sandbox", value: labelValue(capabilities.terraform_sandbox), detail: capabilities.terraform_sandbox_driver ? `${capabilities.terraform_sandbox_driver} isolation driver` : "Upload plan JSON instead", tone: capabilities.terraform_sandbox === "enabled" ? "success" : "neutral", icon: ShieldCheck },
      { label: "Cost estimates", value: capabilities.cost_estimation === "infracost" ? "Infracost" : "Heuristic", detail: capabilities.cost_estimation === "infracost" ? "Provider-backed estimate" : "Clearly labeled fallback", tone: capabilities.cost_estimation === "infracost" ? "success" : "neutral", icon: WalletCards },
      { label: "AI enrichment", value: labelValue(capabilities.llm_enrichment), detail: capabilities.llm_enrichment === "enabled" ? `Tracing ${capabilities.tracing}` : "Deterministic review remains active", tone: capabilities.llm_enrichment === "enabled" ? "success" : "neutral", icon: BrainCircuit }
    ];
  }, [capabilities, frontendHost, frontendTarget, user]);

  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-semibold text-white">Runtime capabilities</p>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">Values below are reported by this environment. They describe active behavior without exposing credentials or secret configuration.</p>
        </div>
        <Badge tone={capabilities?.public_demo ? "info" : "success"}>{capabilities?.public_demo ? "Public demo" : "Private runtime"}</Badge>
      </div>
      {error ? <div className="mt-4"><AlertBanner tone="danger" title="Runtime status unavailable">{error}</AlertBanner></div> : null}
      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] gap-3">
        {statusItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-md border border-[#26364d] bg-[#07101d] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <Icon className="h-3.5 w-3.5 text-[#6ea8fe]" aria-hidden="true" />
                    {item.label}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-100">{item.value}</p>
                  <p className="mt-1 truncate text-xs text-slate-500" title={item.detail}>{item.detail}</p>
                </div>
                <Badge tone={item.tone}>{statusLabel(item.tone)}</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function labelValue(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function statusLabel(tone: StatusItem["tone"]) {
  if (tone === "success") return "Active";
  if (tone === "warn") return "Dev only";
  if (tone === "info") return "Guarded";
  return "Unavailable";
}
