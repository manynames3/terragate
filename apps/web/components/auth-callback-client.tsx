"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, ShieldAlert } from "lucide-react";
import { completeCognitoCallback } from "@/lib/auth";
import { Card } from "@/components/ui";

export function AuthCallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const callbackError = params.get("error_description") || params.get("error");
    if (callbackError) {
      setError(callbackError);
      return;
    }
    if (!code) {
      setError("Cognito did not return an authorization code.");
      return;
    }
    completeCognitoCallback(code, state)
      .then(() => router.replace("/"))
      .catch((exc: unknown) => {
        setError(exc instanceof Error ? exc.message : "Unable to complete Cognito sign-in.");
      });
  }, [params, router]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-md p-6 text-center">
        {error ? (
          <>
            <ShieldAlert className="mx-auto h-8 w-8 text-red-200" />
            <h1 className="mt-4 text-xl font-semibold text-white">Sign-in failed</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">{error}</p>
          </>
        ) : (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#43c6ac]" />
            <h1 className="mt-4 text-xl font-semibold text-white">Completing sign-in</h1>
            <p className="mt-2 text-sm text-slate-400">Validating Cognito callback and starting your session.</p>
          </>
        )}
      </Card>
    </div>
  );
}
