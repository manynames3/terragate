import type { Finding, GitHubCommentResponse, Report, RunDetail, RunListItem } from "@/types/api";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
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
