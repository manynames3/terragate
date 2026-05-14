import { RunDetailClient } from "@/components/run-detail";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return <RunDetailClient runId={runId} />;
}
