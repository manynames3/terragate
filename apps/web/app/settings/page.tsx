import Link from "next/link";
import { ArrowRight, KeyRound, Lock, RadioTower, ShieldCheck } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { AuthSessionButton } from "@/components/auth-session-button";
import { DeploymentStatusPanel } from "@/components/deployment-status-panel";

const settings = [
  {
    title: "Identity boundary",
    status: "Runtime reported",
    body: "The API reports whether this environment uses Cognito or the development identity provider. Role checks are enforced again at mutation endpoints.",
    icon: Lock
  },
  {
    title: "Tracing",
    status: "Server managed",
    body: "LangSmith tracing is enabled only when server-side credentials are configured. Trace identifiers appear on completed review runs.",
    icon: RadioTower
  },
  {
    title: "External writes",
    status: "Approval gated",
    body: "GitHub comments and patch commits remain blocked until a reviewer approves the corresponding action, even when credentials are configured.",
    icon: KeyRound
  },
  {
    title: "Policy packs",
    status: "Managed in Policies",
    body: "Policy packs control required tags, regions, public ingress, deletion rules, allowed resources, and monthly cost thresholds.",
    icon: ShieldCheck
  }
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-[#24324a] pb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Platform configuration</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Settings</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Inspect this environment, manage your sign-in session, and follow the active security boundaries. Secret-backed integration changes stay in deployment configuration.</p>
      </div>
      <DeploymentStatusPanel />
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="p-5">
          <h2 className="text-lg font-semibold text-white">Current session</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">Sign in or inspect the active access mode for this browser.</p>
          <div className="mt-4"><AuthSessionButton /></div>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          {settings.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                    <Icon className="h-5 w-5 text-[#6ea8fe]" aria-hidden="true" />
                  </span>
                  <Badge tone="info">{item.status}</Badge>
                </div>
                <h2 className="mt-4 text-base font-semibold text-white">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
                {item.title === "Policy packs" ? (
                  <Link href="/policies" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#8de5d3] hover:text-white">
                    Open policies <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
