import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore, type Query } from "firebase-admin/firestore";
import type { DocData, DocDb, QuerySpec } from "./docDb.js";

/**
 * DocDb over the real Firestore, via firebase-admin. Credentials come from the
 * standard Google places (GOOGLE_APPLICATION_CREDENTIALS, gcloud, or the
 * runtime's service account). With FIRESTORE_EMULATOR_HOST set, firebase-admin
 * talks to the local emulator instead and needs no credentials.
 *
 * Loaded only when STORE=firestore, so the default in-memory mode never
 * imports firebase-admin.
 */
export function adminDocDb(projectId: string): DocDb {
  const app = getApps().find((a) => a.name === "daizee") ??
    initializeApp(
      process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { projectId, credential: applicationDefault() },
      "daizee",
    );
  return firestoreDocDb(getFirestore(app));
}

export function firestoreDocDb(fs: Firestore): DocDb {
  return {
    async get(path) {
      const snap = await fs.doc(path).get();
      return snap.exists ? toPlain(snap.data() ?? {}) : null;
    },
    async set(path, data) {
      await fs.doc(path).set(data);
    },
    async create(path, data) {
      try {
        await fs.doc(path).create(data);
        return true;
      } catch (err) {
        if ((err as { code?: number }).code === 6) return false; // ALREADY_EXISTS
        throw err;
      }
    },
    async update(path, data) {
      await fs.doc(path).update(data);
    },
    async query(collectionPath, spec: QuerySpec = {}) {
      let q: Query = fs.collection(collectionPath);
      for (const [field, op, value] of spec.where ?? []) q = q.where(field, op, value);
      if (spec.orderBy) q = q.orderBy(spec.orderBy.field, spec.orderBy.direction);
      if (spec.limit) q = q.limit(spec.limit);
      const snap = await q.get();
      return snap.docs.map((d) => ({ id: d.id, data: toPlain(d.data()) }));
    },
  };
}

/** Timestamps come back as Dates, so the store only ever sees plain values. */
function toPlain(data: DocData): DocData {
  const out: DocData = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = v instanceof Timestamp ? v.toDate() : v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date) ? toPlain(v as DocData) : v;
  }
  return out;
}
