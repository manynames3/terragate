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
  RunDetail,
  RunListItem
} from "@/types/api";
import { getAuthHeaders } from "@/lib/auth";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...getAuthHeaders(),
      ...(init?.headers ?? {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(payload.detail ?? response.statusText);
  }
  return response.json() as Promise<T>;
}

export function getCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>("/api/v1/auth/me");
}

export function listRuns(): Promise<RunListItem[]> {
  return request<RunListItem[]>("/api/v1/runs");
}

export function getRun(runId: string): Promise<RunDetail> {
  return request<RunDetail>(`/api/v1/runs/${runId}`);
}

export function getFindings(runId: string): Promise<Finding[]> {
  return request<Finding[]>(`/api/v1/runs/${runId}/findings`);
}

export function getReport(runId: string): Promise<Report> {
  return request<Report>(`/api/v1/runs/${runId}/report`);
}

export function createTerraformReview(formData: FormData): Promise<{ run_id: string; status: string }> {
  return request<{ run_id: string; status: string }>("/api/v1/terraform-reviews", {
    method: "POST",
    body: formData
  });
}

export function listDemoSamplePlans(): Promise<DemoSamplePlan[]> {
  return request<DemoSamplePlan[]>("/api/v1/demo/sample-plans");
}

export function createDemoTerraformReview(sample: string): Promise<{ run_id: string; status: string }> {
  return request<{ run_id: string; status: string }>("/api/v1/demo/terraform-reviews", {
    method: "POST",
    body: JSON.stringify({ sample })
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

export function approveRun(runId: string, notes: string): Promise<{ run_id: string; decision: string; status: string }> {
  return request(`/api/v1/runs/${runId}/approve`, {
    method: "POST",
    body: JSON.stringify({ notes })
  });
}

export function rejectRun(runId: string, notes: string): Promise<{ run_id: string; decision: string; status: string }> {
  return request(`/api/v1/runs/${runId}/reject`, {
    method: "POST",
    body: JSON.stringify({ notes })
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

export function approveFixPatch(runId: string, patchId: string): Promise<FixPatch> {
  return request<FixPatch>(`/api/v1/runs/${runId}/fix-patches/${patchId}/approve`, {
    method: "POST"
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
