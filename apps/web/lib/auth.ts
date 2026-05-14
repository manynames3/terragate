export type AuthSession = {
  accessToken: string;
  idToken: string | null;
  email: string | null;
  name: string | null;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
};

const SESSION_KEY = "cloudops.auth.session";
const PKCE_VERIFIER_KEY = "cloudops.auth.pkce_verifier";
const PKCE_STATE_KEY = "cloudops.auth.state";

export function isCognitoAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_PROVIDER === "cognito";
}

export function cognitoConfigStatus(): "disabled" | "configured" | "incomplete" {
  if (!isCognitoAuthEnabled()) {
    return "disabled";
  }
  return cognitoDomain() && process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID && redirectUri() ? "configured" : "incomplete";
}

export function getStoredAuthSession(): AuthSession | null {
  if (typeof window === "undefined" || !isCognitoAuthEnabled()) {
    return null;
  }
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as AuthSession;
    if (!session.accessToken || session.expiresAt <= Date.now() + 30_000) {
      clearAuthSession();
      return null;
    }
    return session;
  } catch {
    clearAuthSession();
    return null;
  }
}

export function getAuthHeaders(): Record<string, string> {
  const session = getStoredAuthSession();
  return session ? { Authorization: `Bearer ${session.accessToken}` } : {};
}

export async function startCognitoLogin(): Promise<void> {
  const domain = requireCognitoDomain();
  const clientId = requireEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID);
  const callback = requireEnv("NEXT_PUBLIC_COGNITO_REDIRECT_URI", redirectUri());
  const verifier = randomBase64Url(64);
  const state = randomBase64Url(24);
  const challenge = await pkceChallenge(verifier);
  window.localStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  window.localStorage.setItem(PKCE_STATE_KEY, state);
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    scope: process.env.NEXT_PUBLIC_COGNITO_SCOPE || "openid email profile",
    code_challenge_method: "S256",
    code_challenge: challenge,
    state
  });
  window.location.assign(`${domain}/oauth2/authorize?${params.toString()}`);
}

export async function completeCognitoCallback(code: string, state: string | null): Promise<AuthSession> {
  const expectedState = window.localStorage.getItem(PKCE_STATE_KEY);
  const verifier = window.localStorage.getItem(PKCE_VERIFIER_KEY);
  if (!expectedState || !verifier || state !== expectedState) {
    throw new Error("Cognito callback state did not match the stored login request.");
  }
  const domain = requireCognitoDomain();
  const clientId = requireEnv("NEXT_PUBLIC_COGNITO_CLIENT_ID", process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID);
  const callback = requireEnv("NEXT_PUBLIC_COGNITO_REDIRECT_URI", redirectUri());
  const response = await fetch(`${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      redirect_uri: callback,
      code_verifier: verifier
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Cognito token exchange failed.");
  }
  const token = (await response.json()) as TokenResponse;
  const profile = decodeJwtPayload(token.id_token || token.access_token);
  const session: AuthSession = {
    accessToken: token.access_token,
    idToken: token.id_token || null,
    email: stringClaim(profile.email) || stringClaim(profile.username) || stringClaim(profile["cognito:username"]),
    name: stringClaim(profile.name),
    expiresAt: Date.now() + token.expires_in * 1000
  };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.localStorage.removeItem(PKCE_VERIFIER_KEY);
  window.localStorage.removeItem(PKCE_STATE_KEY);
  window.dispatchEvent(new Event("cloudops-auth-changed"));
  return session;
}

export function clearAuthSession(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(PKCE_VERIFIER_KEY);
  window.localStorage.removeItem(PKCE_STATE_KEY);
  window.dispatchEvent(new Event("cloudops-auth-changed"));
}

export function signOut(): void {
  clearAuthSession();
  if (!isCognitoAuthEnabled()) {
    return;
  }
  const domain = cognitoDomain();
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID;
  const logout = logoutUri();
  if (domain && clientId && logout) {
    const params = new URLSearchParams({
      client_id: clientId,
      logout_uri: logout
    });
    window.location.assign(`${domain}/logout?${params.toString()}`);
  }
}

function cognitoDomain(): string | null {
  const value = process.env.NEXT_PUBLIC_COGNITO_DOMAIN;
  if (!value) {
    return null;
  }
  const withScheme = value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, "");
}

function redirectUri(): string | null {
  if (process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI) {
    return process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI;
  }
  if (typeof window !== "undefined") {
    return `${window.location.origin}/auth/callback`;
  }
  return null;
}

function logoutUri(): string | null {
  if (process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI) {
    return process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI;
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return null;
}

function requireCognitoDomain(): string {
  return requireEnv("NEXT_PUBLIC_COGNITO_DOMAIN", cognitoDomain());
}

function requireEnv(name: string, value: string | null | undefined): string {
  if (!value) {
    throw new Error(`${name} is required for Cognito auth.`);
  }
  return value;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJwtPayload(token: string | null | undefined): Record<string, unknown> {
  if (!token) {
    return {};
  }
  const part = token.split(".")[1];
  if (!part) {
    return {};
  }
  try {
    const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringClaim(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
