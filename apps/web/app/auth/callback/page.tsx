import { Suspense } from "react";
import { AuthCallbackClient } from "@/components/auth-callback-client";
import { Card } from "@/components/ui";

export default function CognitoCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] items-center justify-center">
          <Card className="w-full max-w-md p-6 text-center text-sm text-slate-400">Loading Cognito callback...</Card>
        </div>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
