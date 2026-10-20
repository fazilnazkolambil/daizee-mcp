/**
 * The handful of document operations FirestoreStore needs. Kept this small so
 * the store's logic can be tested against an in-memory fake, while the real
 * implementation (firestoreAdmin.ts) is a thin wrapper over firebase-admin.
 *
 * Paths are slash-separated, like Firestore's own: "users/abc/meals/meal-1".
 * Values are plain JSON plus Date (stored as a Firestore Timestamp).
 */

export type DocData = Record<string, unknown>;

export interface QuerySpec {
  where?: Array<[field: string, op: "==" | ">=" | "<", value: unknown]>;
  orderBy?: { field: string; direction: "asc" | "desc" };
  limit?: number;
}

export interface DocDb {
  get(path: string): Promise<DocData | null>;
  set(path: string, data: DocData): Promise<void>;
  /** Writes only if the document does not exist yet. Returns false if it already did. */
  create(path: string, data: DocData): Promise<boolean>;
  /** Merges fields into an existing document. */
  update(path: string, data: DocData): Promise<void>;
  query(collectionPath: string, spec?: QuerySpec): Promise<Array<{ id: string; data: DocData }>>;
}

export class ForbiddenPathError extends Error {
  constructor(path: string) {
    super(`Refused: ${path} is outside the allowed accounts`);
    this.name = "ForbiddenPathError";
  }
}

/**
 * Wraps a DocDb so that every read and write must be inside `users/{uid}` for
 * one of the allowed uids. This is the last line of defence: even a bug in the
 * store cannot reach another person's data.
 */
export function allowlistGuard(db: DocDb, allowedUids: Iterable<string>): DocDb {
  const allowed = new Set(allowedUids);
  const check = (path: string) => {
    const parts = path.split("/");
    if (parts[0] !== "users" || !parts[1] || !allowed.has(parts[1]) || parts.some((p) => p === "" || p === "." || p === "..")) {
      throw new ForbiddenPathError(path);
    }
  };
  return {
    get: async (path) => (check(path), db.get(path)),
    set: async (path, data) => (check(path), db.set(path, data)),
    create: async (path, data) => (check(path), db.create(path, data)),
    update: async (path, data) => (check(path), db.update(path, data)),
    query: async (path, spec) => (check(path), db.query(path, spec)),
  };
}
