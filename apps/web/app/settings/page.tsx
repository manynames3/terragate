import { KeyRound, Lock, RadioTower, ShieldCheck } from "lucide-react";
import { Badge, Card } from "@/components/ui";

const settings = [
  {
    title: "Auth provider",
    status: "Dev stub",
    body: "The API uses a lightweight dev user today. Clerk or Auth.js can replace the stub at the route dependency boundary.",
    icon: Lock
  },
  {
    title: "LangSmith tracing",
    status: "Env driven",
    body: "Set LANGSMITH_API_KEY, LANGSMITH_PROJECT, and LANGSMITH_TRACING to trace graph runs.",
    icon: RadioTower
  },
  {
    title: "GitHub posting",
    status: "Approval gated",
    body: "Set GITHUB_TOKEN and include PR metadata to post approved comments to pull requests.",
    icon: KeyRound
  },
  {
    title: "Policy packs",
    status: "Local rules",
    body: "Python checks are active. Rego policy files are included as placeholders for OPA integration.",
    icon: ShieldCheck
  }
];

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-[#24324a] pb-6">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#43c6ac]">Platform configuration</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Settings</h1>
        <p className="mt-2 text-sm text-slate-400">Production integrations are cleanly isolated behind environment variables and adapters.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {settings.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="p-5">
              <div className="flex items-start justify-between gap-4">
                <span className="flex h-11 w-11 items-center justify-center rounded-md border border-[#31445f] bg-[#111d31]">
                  <Icon className="h-5 w-5 text-[#6ea8fe]" />
                </span>
                <Badge tone="info">{item.status}</Badge>
              </div>
              <h2 className="mt-5 text-lg font-semibold text-white">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{item.body}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
