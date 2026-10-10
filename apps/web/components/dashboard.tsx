"use client";

import { Suspense } from "react";
import { ReviewWorkspace } from "@/components/review-workspace";
import { LoadingPanel } from "@/components/ui";

export function Dashboard() {
  return <Suspense fallback={<LoadingPanel label="Loading review workspace" />}><ReviewWorkspace /></Suspense>;
}
