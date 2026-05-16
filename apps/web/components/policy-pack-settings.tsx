"use client";

import { useEffect, useMemo, useState } from "react";
import { Save } from "lucide-react";
import { getPolicyPack, listPolicyPacks, updatePolicyPack } from "@/lib/api";
import type { PolicyPack } from "@/types/api";
import { Badge, Button, Card } from "@/components/ui";

export function PolicyPackSettings() {
  const [packs, setPacks] = useState<PolicyPack[]>([]);
  const [selectedName, setSelectedName] = useState("default");
  const [editorValue, setEditorValue] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const parsedPolicy = useMemo(() => {
    try {
      return JSON.parse(editorValue) as PolicyPack;
    } catch {
      return null;
    }
  }, [editorValue]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const available = await listPolicyPacks();
        setPacks(available);
        const initial = available.find((pack) => pack.name === "default") ?? available[0];
        if (initial) {
          setSelectedName(initial.name);
          const pack = await getPolicyPack(initial.name);
          setEditorValue(JSON.stringify(pack, null, 2));
        }
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to load policy packs.");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  async function selectPack(name: string) {
    setSelectedName(name);
    setMessage(null);
    try {
      const pack = await getPolicyPack(name);
      setEditorValue(JSON.stringify(pack, null, 2));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to load policy pack.");
    }
  }

  async function savePack() {
    setSaving(true);
    setMessage(null);
    try {
      const payload = JSON.parse(editorValue) as Partial<PolicyPack>;
      const saved = await updatePolicyPack(selectedName, payload);
      setEditorValue(JSON.stringify(saved, null, 2));
      setPacks(await listPolicyPacks());
      setMessage(`Saved ${selectedName} policy pack.`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Policy pack JSON is invalid.");
    } finally {
      setSaving(false);
    }
  }

  function updatePolicyField<K extends keyof PolicyPack>(key: K, value: PolicyPack[K]) {
    const base = parsedPolicy;
    if (!base) return;
    setEditorValue(JSON.stringify({ ...base, [key]: value }, null, 2));
  }

  return (
    <Card className="p-5">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-white">Policy pack workflow</h2>
            <Badge tone="success">Editable</Badge>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Teams can tune required tags, allowed regions, instance families, public ingress rules, stateful deletion rules, and cost thresholds without code changes.
          </p>
        </div>
        <Button onClick={() => void savePack()} disabled={saving || loading}>
          <Save className="h-4 w-4" /> Save policy pack
        </Button>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        <div className="space-y-2">
          {packs.map((pack) => (
            <button
              key={pack.name}
              type="button"
              onClick={() => void selectPack(pack.name)}
              className={`w-full rounded-md border px-3 py-3 text-left transition ${
                selectedName === pack.name
                  ? "border-[#43c6ac] bg-[#12352f]"
                  : "border-[#26364d] bg-[#091424] hover:bg-[#111d31]"
              }`}
            >
              <p className="text-sm font-semibold text-white">{pack.name}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{pack.description || "No description"}</p>
              <p className="mt-2 text-xs text-slate-500">${pack.max_monthly_delta}/mo threshold</p>
            </button>
          ))}
        </div>
        <div className="space-y-4">
          {parsedPolicy ? (
            <div className="rounded-lg border border-[#26364d] bg-[#091424] p-4">
              <div className="flex flex-col justify-between gap-2 md:flex-row md:items-start">
                <div>
                  <h3 className="text-base font-semibold text-white">Common controls</h3>
                  <p className="mt-1 text-sm text-slate-400">Edit the fields teams usually care about without touching raw JSON.</p>
                </div>
                <Badge tone="info">Policy version: {parsedPolicy.name}</Badge>
              </div>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <LabeledInput
                  label="Required tags"
                  value={parsedPolicy.required_tags.join(", ")}
                  onChange={(value) => updatePolicyField("required_tags", csv(value))}
                />
                <LabeledInput
                  label="Allowed regions"
                  value={parsedPolicy.allowed_regions.join(", ")}
                  onChange={(value) => updatePolicyField("allowed_regions", csv(value))}
                />
                <LabeledInput
                  label="Allowed instance families"
                  value={parsedPolicy.allowed_instance_families.join(", ")}
                  onChange={(value) => updatePolicyField("allowed_instance_families", csv(value))}
                />
                <LabeledInput
                  label="Max monthly cost delta"
                  value={String(parsedPolicy.max_monthly_delta)}
                  type="number"
                  onChange={(value) => updatePolicyField("max_monthly_delta", Number(value))}
                />
                <LabeledInput
                  label="Min prod backup retention days"
                  value={String(parsedPolicy.min_prod_backup_retention_days)}
                  type="number"
                  onChange={(value) => updatePolicyField("min_prod_backup_retention_days", Number(value))}
                />
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <BooleanToggle label="Block public admin ingress" checked={parsedPolicy.block_public_admin_ingress} onChange={(checked) => updatePolicyField("block_public_admin_ingress", checked)} />
                <BooleanToggle label="Require cost center" checked={parsedPolicy.require_cost_center} onChange={(checked) => updatePolicyField("require_cost_center", checked)} />
                <BooleanToggle label="Block production stateful deletes" checked={parsedPolicy.block_production_stateful_deletes} onChange={(checked) => updatePolicyField("block_production_stateful_deletes", checked)} />
                <BooleanToggle label="Require prod deletion protection" checked={parsedPolicy.require_deletion_protection_in_prod} onChange={(checked) => updatePolicyField("require_deletion_protection_in_prod", checked)} />
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-amber-300/35 bg-amber-400/10 p-4 text-sm text-amber-100">
              Raw JSON is currently invalid. Fix the JSON below to restore the guided policy controls.
            </div>
          )}
          <textarea
            value={editorValue}
            onChange={(event) => setEditorValue(event.target.value)}
            className="min-h-[360px] w-full resize-y rounded-md border border-[#31445f] bg-[#07101d] p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-[#43c6ac]"
            spellCheck={false}
          />
        </div>
      </div>
      {message ? <p className="mt-4 rounded-md border border-[#31445f] bg-[#091424] p-3 text-sm text-slate-200">{message}</p> : null}
    </Card>
  );
}

function csv(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function LabeledInput({ label, value, type = "text", onChange }: { label: string; value: string; type?: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-2">
      <span className="text-sm font-medium text-slate-200">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-[#31445f] bg-[#07101d] px-3 py-2.5 text-sm text-white placeholder:text-slate-500"
      />
    </label>
  );
}

function BooleanToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-md border border-[#26364d] bg-[#07101d] px-3 py-2.5 text-sm text-slate-200">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-[#43c6ac]" />
    </label>
  );
}
