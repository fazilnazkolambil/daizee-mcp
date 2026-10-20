import { GoogleAuth } from "google-auth-library";

/**
 * Secrets come from Google Secret Manager, not from .env.
 *
 * With DAIZEE_SECRETS_PROJECT set, each name in SECRET_NAMES that is not
 * already in the environment is read from that project's Secret Manager
 * (latest version) using Application Default Credentials, so no key ever
 * sits in a file. A value already in the environment wins: the hosted
 * function gets its key from Firebase's own secret binding, and tests set
 * values directly.
 */
export const SECRET_NAMES = ["GEMINI_API_KEY"] as const;

/** Reads one secret's latest value. Swappable for tests. */
export type SecretFetcher = (project: string, name: string) => Promise<string>;

export async function loadSecrets(
  env: NodeJS.ProcessEnv,
  fetchSecret: SecretFetcher = fetchFromSecretManager,
): Promise<string[]> {
  const project = env.DAIZEE_SECRETS_PROJECT?.trim();
  if (!project) return [];
  const loaded: string[] = [];
  for (const name of SECRET_NAMES) {
    if (env[name]) continue;
    try {
      env[name] = await fetchSecret(project, name);
    } catch (err) {
      throw new Error(
        `Could not read secret ${name} from Secret Manager in project ${project}. ` +
          "Run `gcloud auth application-default login` and check you have Secret Manager Secret Accessor on it. " +
          `(${err instanceof Error ? err.message : String(err)})`,
      );
    }
    loaded.push(name);
  }
  return loaded;
}

let auth: GoogleAuth | undefined;

async function fetchFromSecretManager(project: string, name: string): Promise<string> {
  auth ??= new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const res = await client.request<{ payload?: { data?: string } }>({
    url: `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(project)}/secrets/${encodeURIComponent(name)}/versions/latest:access`,
    // Bill the call to the secret's own project, not whatever quota project the local login picked.
    headers: { "x-goog-user-project": project },
  });
  const data = res.data.payload?.data;
  if (!data) throw new Error("empty secret payload");
  return Buffer.from(data, "base64").toString("utf8").trim();
}
