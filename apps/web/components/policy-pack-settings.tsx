"use client";

import { useEffect, useState } from "react";
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
        <textarea
          value={editorValue}
          onChange={(event) => setEditorValue(event.target.value)}
          className="min-h-[420px] w-full resize-y rounded-md border border-[#31445f] bg-[#07101d] p-4 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-[#43c6ac]"
          spellCheck={false}
        />
      </div>
      {message ? <p className="mt-4 rounded-md border border-[#31445f] bg-[#091424] p-3 text-sm text-slate-200">{message}</p> : null}
    </Card>
  );
}
