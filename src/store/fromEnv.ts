import type { Clock } from "../memory/index.js";
import { FirestoreStore } from "./firestoreStore.js";

/**
 * Settings for connecting to the real DayZer0 app (STORE=firestore).
 *
 *   DAIZEE_ALLOWED_UIDS   required. "demo=<firebase uid>" pairs, comma separated.
 *                         The left side is what x-daizee-user sends; nothing else is reachable.
 *   FIREBASE_PROJECT_ID   the Firebase project (or GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT).
 *   FIRESTORE_EMULATOR_HOST   set by `firebase emulators:*`: talk to the local emulator.
 *   DAIZEE_ALLOW_LIVE_FIRESTORE=1   required to touch a real (non-emulator) project, so a
 *                         stray setting during development can never write to production.
 *   GOOGLE_APPLICATION_CREDENTIALS  a service account key file, for a real project.
 */
export interface FirestoreSettings {
  projectId: string;
  users: Map<string, string>;
  emulator: boolean;
}

export function parseAllowedUids(raw: string | undefined): Map<string, string> {
  const users = new Map<string, string>();
  for (const entry of (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [name, uid] = entry.includes("=") ? entry.split("=", 2).map((s) => s.trim()) : [entry, entry];
    if (!name || !uid || !/^[A-Za-z0-9_-]{1,40}$/.test(name) || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
      throw new Error(`DAIZEE_ALLOWED_UIDS: bad entry "${entry}". Use name=uid, for example demo=AbC123`);
    }
    users.set(name, uid);
  }
  return users;
}

export function firestoreSettings(env: NodeJS.ProcessEnv): FirestoreSettings {
  const projectId = (env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? "").trim();
  if (!projectId) throw new Error("STORE=firestore needs FIREBASE_PROJECT_ID");
  const users = parseAllowedUids(env.DAIZEE_ALLOWED_UIDS);
  if (users.size === 0) throw new Error("STORE=firestore needs DAIZEE_ALLOWED_UIDS (for example demo=<firebase uid>)");
  const emulator = Boolean(env.FIRESTORE_EMULATOR_HOST?.trim());
  if (!emulator && env.DAIZEE_ALLOW_LIVE_FIRESTORE !== "1") {
    throw new Error(
      `STORE=firestore would use the REAL project "${projectId}". Set DAIZEE_ALLOW_LIVE_FIRESTORE=1 to allow it, or FIRESTORE_EMULATOR_HOST to use the emulator.`,
    );
  }
  return { projectId, users, emulator };
}

/** Builds the Firestore store. firebase-admin is imported only here, on demand. */
export async function firestoreStoreFromEnv(env: NodeJS.ProcessEnv, clock: Clock): Promise<{ store: FirestoreStore; settings: FirestoreSettings }> {
  const settings = firestoreSettings(env);
  const { adminDocDb } = await import("./firestoreAdmin.js");
  return { store: new FirestoreStore(adminDocDb(settings.projectId), settings.users, clock), settings };
}
