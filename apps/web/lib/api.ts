import type {
  AuthUser,
  AuditLogEntry,
  DemoSamplePlan,
  Finding,
  FixPatch,
  GitHubCommentResponse,
  GitHubPRContext,
  PatchCommitResponse,
  PolicyPack,
  Report,
  RuntimeCapabilities,
  RunDetail,
  RunbookProgressEntry,
  RunListItem
} from "@/types/api";
import { getAuthHeaders } from "@/lib/auth";
import type { ReviewPage, Repository, RiskException, PlanPage } from "@/types/api";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...getAuthHeaders(),
        ...(init?.headers ?? {})
      },
      cache: "no-store"
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The request was cancelled before TerraGate received a response.");
    }
    throw new Error("TerraGate could not reach the API. Check your connection and try again.");
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: unknown; message?: unknown; trace_id?: unknown } | null;
    const detail = formatApiError(payload?.detail ?? payload?.message);
    if (response.status === 401) {
      throw new Error(detail || "Your session is missing or expired. Sign in again and retry.");
    }
    if (response.status === 403) {
      throw new Error(detail || "Your account does not have permission to perform this action.");
    }
    const trace = typeof payload?.trace_id === "string" ? payload.trace_id : response.headers.get("X-Request-ID");
    const reference = response.status >= 500 && trace && /^[a-f0-9]{32}$/.test(trace) ? ` Reference: ${trace}.` : "";
    throw new Error((detail || response.statusText || `Request failed with status ${response.status}.`) + reference);
  }
  return response.json() as Promise<T>;
}

function formatApiError(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const message = "msg" in item && typeof item.msg === "string" ? item.msg : null;
        const location = "loc" in item && Array.isArray(item.loc) ? item.loc.join(".") : null;
        return message ? `${location ? `${location}: ` : ""}${message}` : null;
      })
      .filter(Boolean);
    return messages.length ? messages.join(" ") : null;
  }
  return null;
}

export function getCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>("/api/v1/auth/me");
}

export function getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
  return request<RuntimeCapabilities>("/api/v1/runtime-capabilities");
}

export function listRuns(): Promise<RunListItem[]> {
  return request<RunListItem[]>("/api/v1/runs?limit=100");
}

export function listReviews(filters: Record<string, string>, signal?: AbortSignal): Promise<ReviewPage> {
  return request<ReviewPage>(`/api/v1/reviews?${new URLSearchParams(filters)}`, {signal});
}
export function listRepositories(): Promise<Repository[]> { return request("/api/v1/repositories"); }
export function listExceptions(runId?: string, offset = 0, findingId?: string): Promise<{items: RiskException[]; total: number}> {
  return request(`/api/v1/exceptions?${new URLSearchParams({...(runId ? {run_id: runId} : {}), ...(findingId ? {finding_id: findingId} : {}), offset: String(offset)})}`);
}
export function requestException(runId: string, body: {finding_id: string; review_snapshot_hash: string; justification: string; expires_at: string}): Promise<RiskException> {
  return request(`/api/v1/runs/${runId}/exceptions`, {method: "POST", body: JSON.stringify(body)});
}
export function decideException(id: string, decision: "approved" | "denied" | "revoked", notes: string): Promise<RiskException> {
  return request(`/api/v1/exceptions/${id}/decision`, {method: "POST", body: JSON.stringify({decision, notes})});
}
export function listAuditEvents(offset = 0): Promise<{items: Array<AuditLogEntry & {run_id: string}>; total: number}> {
  return request(`/api/v1/audit-log?offset=${offset}`);
}
export function getPlan(runId: string, offset = 0, resource?: string): Promise<PlanPage> { return request(`/api/v1/runs/${runId}/plan?${new URLSearchParams({offset: String(offset), ...(resource ? {resource} : {})})}`); }

export function getRun(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/v1/runs/${runId}`);
}

export function getFindings(runId: string): Promise<Finding[]> {
  return request<Finding[]>(`/api/v1/runs/${runId}/findings`);
}

export function getReport(runId: string): Promise<Report> {
  return request<Report>(`/api/v1/runs/${runId}/report`);
}

export async function createTerraformReview(formData: FormData): Promise<{ run_id: string; status: string }> {
  const file = formData.get("file");
  if (typeof File !== "undefined" && file instanceof File) {
    return request<{ run_id: string; status: string }>("/api/v1/terraform-reviews/json", {
      method: "POST",
      body: JSON.stringify({
        file_name: file.name || "tfplan.json",
        plan_json_text: await file.text(),
        environment: String(formData.get("environment") ?? "dev"),
        cloud_provider: String(formData.get("cloud_provider") ?? "aws"),
        policy_profile: String(formData.get("policy_profile") ?? "default"),
        repo_owner: nullableString(formData.get("repo_owner")),
        repo_name: nullableString(formData.get("repo_name")),
        pull_number: nullableNumber(formData.get("pull_number"))
      })
    });
  }

  return request<{ run_id: string; status: string }>("/api/v1/terraform-reviews", {
    method: "POST",
    body: formData
  });
}

function nullableString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function nullableNumber(value: FormDataEntryValue | null): number | null {
  const text = nullableString(value);
  if (!text) {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function listDemoSamplePlans(): Promise<DemoSamplePlan[]> {
  return request<DemoSamplePlan[]>("/api/v1/demo/sample-plans");
}

export function createDemoTerraformReview(
  sample: string,
  options?: {
    environment?: string;
    cloud_provider?: string;
    policy_profile?: string;
    repo_owner?: string;
    repo_name?: string;
    pull_number?: number;
  }
): Promise<{ run_id: string; status: string }> {
  return request<{ run_id: string; status: string }>("/api/v1/demo/terraform-reviews", {
    method: "POST",
    body: JSON.stringify({ sample, ...(options ?? {}) })
  });
}

export function listPolicyPacks(): Promise<PolicyPack[]> {
  return request<PolicyPack[]>("/api/v1/policy-packs");
}

export function getPolicyPack(name: string): Promise<PolicyPack> {
  return request<PolicyPack>(`/api/v1/policy-packs/${name}`);
}

export function updatePolicyPack(name: string, payload: Partial<PolicyPack>): Promise<PolicyPack> {
  return request<PolicyPack>(`/api/v1/policy-packs/${name}`, {
    method: "PUT",
    body: JSON.stringify(payload)
  });
}

export function getGitHubPrContext(repoOwner: string, repoName: string, pullNumber: string): Promise<GitHubPRContext> {
  const params = new URLSearchParams({
    repo_owner: repoOwner,
    repo_name: repoName,
    pull_number: pullNumber
  });
  return request<GitHubPRContext>(`/api/v1/github/pr-context?${params.toString()}`);
}

export function approveRun(runId: string, notes: string, reviewSnapshotHash: string): Promise<{ run_id: string; decision: string; status: string }> {
  return request(`/api/v1/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes, review_snapshot_hash: reviewSnapshotHash })
  });
}

export function rejectRun(runId: string, notes: string, reviewSnapshotHash: string): Promise<{ run_id: string; decision: string; status: string }> {
  return request(`/api/v1/runs/${runId}/reject`, {
    method: "POST",
    body: JSON.stringify({ notes, review_snapshot_hash: reviewSnapshotHash })
  });
}

export function postGitHubComment(runId: string): Promise<GitHubCommentResponse> {
  return request<GitHubCommentResponse>(`/api/v1/runs/${runId}/github-comment`, {
    method: "POST"
  });
}

export function getFixPatches(runId: string): Promise<FixPatch[]> {
  return request<FixPatch[]>(`/api/v1/runs/${runId}/fix-patches`);
}

export function approveFixPatch(runId: string, patchId: string, reviewSnapshotHash: string): Promise<FixPatch> {
  return request<FixPatch>(`/api/v1/runs/${runId}/fix-patches/${patchId}/approve`, {
    method: "POST",
    body: JSON.stringify({ review_snapshot_hash: reviewSnapshotHash })
  });
}

export function commitFixPatch(runId: string, patchId: string): Promise<PatchCommitResponse> {
  return request<PatchCommitResponse>(`/api/v1/runs/${runId}/fix-patches/${patchId}/github-commit`, {
    method: "POST"
  });
}

export function getAuditLog(runId: string): Promise<AuditLogEntry[]> {
  return request<AuditLogEntry[]>(`/api/v1/runs/${runId}/audit-log`);
}

export function getRunbookProgress(runId: string): Promise<RunbookProgressEntry[]> {
  return request<RunbookProgressEntry[]>(`/api/v1/runs/${runId}/runbook-progress`);
}

export function updateRunbookProgress(runId: string, stepId: string, checked: boolean, sectionId?: string): Promise<RunbookProgressEntry> {
  return request<RunbookProgressEntry>(`/api/v1/runs/${runId}/runbook-progress/${encodeURIComponent(stepId)}`, {
    method: "PUT",
    body: JSON.stringify({ checked, section_id: sectionId ?? null })
  });
}
