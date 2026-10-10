import assert from "node:assert/strict";
import test from "node:test";
import { getAuthHeaders } from "./auth.ts";

test("Cognito API authentication uses the identity token with organization claims", () => {
  const previousWindow = globalThis.window;
  const previousProvider = process.env.NEXT_PUBLIC_AUTH_PROVIDER;
  process.env.NEXT_PUBLIC_AUTH_PROVIDER = "cognito";
  let session = {accessToken:"access-token",idToken:"identity-token",expiresAt:Date.now()+60000};
  globalThis.window = {localStorage:{getItem:()=>JSON.stringify(session),removeItem:()=>{}},dispatchEvent:()=>{}};
  try {
    assert.deepEqual(getAuthHeaders(), {Authorization:"Bearer identity-token"});
    session = {...session,idToken:null};
    assert.deepEqual(getAuthHeaders(), {Authorization:"Bearer access-token"});
    session = {...session,expiresAt:0};
    assert.deepEqual(getAuthHeaders(), {});
  } finally {
    if(previousWindow === undefined) delete globalThis.window; else globalThis.window=previousWindow;
    if(previousProvider === undefined) delete process.env.NEXT_PUBLIC_AUTH_PROVIDER; else process.env.NEXT_PUBLIC_AUTH_PROVIDER=previousProvider;
  }
});
