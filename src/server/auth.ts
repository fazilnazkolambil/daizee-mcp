import type { IncomingMessage } from "node:http";

/**
 * Per-user auth for /mcp, in the shape MCP authorization (spec 2025-11-25)
 * and Alexa+ account linking expect: the client sends
 * `Authorization: Bearer <token>`, and the token says who the user is.
 *
 * The token is a Firebase ID token from the DayZer0 app's own sign-in, so the
 * person is the same account they use in the app. This server only checks
 * tokens (it is a resource server). It does not issue them: there is no
 * authorization server here, and no language model.
 */

/** Checks a Firebase ID token and returns its uid. Throws if it is not valid. */
export type VerifyIdToken = (token: string) => Promise<{ uid: string }>;

export interface AuthConfig {
  /** The DayZer0 Firebase project: tokens must be issued for it. */
  projectId: string;
  verify: VerifyIdToken;
  /** Firebase uid -> the store's user name. Uids not on the allowlist get undefined. */
  userForUid: (uid: string) => string | undefined;
  /**
   * Also accept the old `x-daizee-user` header when no token is sent.
   * Only for a local demo recording (DEMO_MODE=1); off by default.
   */
  allowDemoHeader?: boolean;
  /** Public base URL (for example https://example.com) when behind a proxy. */
  publicUrl?: string;
}

/** The issuer of every Firebase ID token for a project (the `iss` claim). */
export function firebaseIssuer(projectId: string): string {
  return `https://securetoken.google.com/${projectId}`;
}

export type AuthResult =
  | { ok: true; userId: string; via: "token" | "demo-header" }
  | { ok: false; status: 401 | 403; error: "invalid_request" | "invalid_token" | "access_denied"; description: string };

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Decides who a /mcp request acts as. Never reads `x-daizee-user` once a token is sent. */
export async function authenticate(req: IncomingMessage, auth: AuthConfig): Promise<AuthResult> {
  const authorization = header(req, "authorization");
  if (!authorization) {
    const demoUser = auth.allowDemoHeader ? header(req, "x-daizee-user") : undefined;
    if (demoUser) return { ok: true, userId: demoUser, via: "demo-header" };
    return { ok: false, status: 401, error: "invalid_request", description: "Sign in to DayZer0 to link your account." };
  }
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)\s*$/i.exec(authorization);
  if (!match) {
    return { ok: false, status: 401, error: "invalid_token", description: "Use Authorization: Bearer <Firebase ID token>." };
  }
  let uid: string;
  try {
    ({ uid } = await auth.verify(match[1] as string));
  } catch (err) {
    const expired = (err as { code?: string }).code === "auth/id-token-expired";
    return { ok: false, status: 401, error: "invalid_token", description: expired ? "The token has expired." : "The token is not valid." };
  }
  const userId = auth.userForUid(uid);
  if (!userId) {
    // A real DayZer0 account, but not one this hosted demo may reach.
    return { ok: false, status: 403, error: "access_denied", description: "This account is not enabled for the voice demo." };
  }
  return { ok: true, userId, via: "token" };
}

/** The server's public origin, as the client reached it. */
export function publicOrigin(req: IncomingMessage, auth?: Pick<AuthConfig, "publicUrl">): string {
  if (auth?.publicUrl) return auth.publicUrl.replace(/\/+$/, "");
  const proto = header(req, "x-forwarded-proto")?.split(",")[0]?.trim() || "http";
  const host = header(req, "x-forwarded-host")?.split(",")[0]?.trim() || header(req, "host") || "localhost";
  return `${proto}://${host}`;
}

/** Where the protected resource metadata for /mcp lives (RFC 9728, path-suffixed form). */
export function metadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

/** The WWW-Authenticate header for a 401 or 403 (RFC 6750 + RFC 9728, as MCP 2025-11-25 requires). */
export function wwwAuthenticate(origin: string, failure?: { error: string; description: string }): string {
  const parts = [`resource_metadata="${metadataUrl(origin)}"`];
  if (failure && failure.error !== "invalid_request") {
    parts.unshift(`error="${failure.error}"`, `error_description="${failure.description.replace(/"/g, "'")}"`);
  }
  return `Bearer ${parts.join(", ")}`;
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) for /mcp. */
export function protectedResourceMetadata(origin: string, auth: AuthConfig | undefined): Record<string, unknown> {
  if (!auth) {
    return {
      resource: `${origin}/mcp`,
      resource_name: "daizee-mcp (demo)",
      bearer_methods_supported: [],
      note: "Demo server with fictional data: no authentication. Connected to the DayZer0 app, it requires a Firebase ID token.",
    };
  }
  return {
    resource: `${origin}/mcp`,
    resource_name: "Daizee, the DayZer0 coach",
    authorization_servers: [firebaseIssuer(auth.projectId)],
    bearer_methods_supported: ["header"],
    note: "Send a Firebase ID token from DayZer0 sign-in as Authorization: Bearer <token>.",
  };
}
