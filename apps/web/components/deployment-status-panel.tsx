import { Cloud, GitPullRequest, KeyRound, Server, ShieldCheck, WalletCards } from "lucide-react";
import { Badge, Card } from "@/components/ui";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const authProvider = process.env.NEXT_PUBLIC_AUTH_PROVIDER ?? "dev";

const statusItems = [
  {
    label: "Frontend",
    value: "Cloudflare Workers",
    detail: "OpenNext SSR deployment",
    tone: "success" as const,
    icon: Cloud
  },
  {
    label: "API",
    value: apiBaseUrl.includes("execute-api") ? "AWS API Gateway + Lambda" : "Local FastAPI",
    detail: apiBaseUrl.replace(/^https?:\/\//, ""),
    tone: "success" as const,
    icon: Server
  },
  {
    label: "Auth",
    value: authProvider === "cognito" ? "Cognito" : "Demo access",
    detail: authProvider === "cognito" ? "JWT validation enabled" : "No customer login required for samples",
    tone: authProvider === "cognito" ? "success" as const : "info" as const,
    icon: KeyRound
  },
  {
    label: "GitHub writes",
    value: "Approval gated",
    detail: "Mocked for anonymous visitors",
    tone: "info" as const,
    icon: GitPullRequest
  },
  {
    label: "Terraform sandbox",
    value: "Disabled here",
    detail: "Upload or sample plans only",
    tone: "neutral" as const,
    icon: ShieldCheck
  },
  {
    label: "Cost estimates",
    value: "Heuristic fallback",
    detail: "Infracost-ready adapter",
    tone: "neutral" as const,
    icon: WalletCards
  }
];

export function DeploymentStatusPanel() {
  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-semibold text-white">Runtime safeguards</p>
          <p className="mt-1 text-sm leading-6 text-slate-400">This hosted environment runs the live review workflow while blocking anonymous users from expensive or external-write actions.</p>
        </div>
        <Badge tone="info">Hosted demo</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {statusItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-md border border-[#26364d] bg-[#07101d] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                    <Icon className="h-3.5 w-3.5 text-[#6ea8fe]" />
                    {item.label}
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-100">{item.value}</p>
                  <p className="mt-1 truncate text-xs text-slate-500">{item.detail}</p>
                </div>
                <Badge tone={item.tone}>{item.tone === "success" ? "Live" : item.tone === "info" ? "Guarded" : "Demo"}</Badge>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
