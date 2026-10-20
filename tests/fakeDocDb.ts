import type { DocData, DocDb, QuerySpec } from "../src/store/docDb.js";

/** An in-memory stand-in for Firestore, with just the behaviour FirestoreStore relies on. */
export class FakeDocDb implements DocDb {
  readonly docs = new Map<string, DocData>();
  readonly touched: string[] = [];

  async get(path: string) {
    this.touched.push(path);
    const d = this.docs.get(path);
    return d ? structuredClone(d) : null;
  }
  async set(path: string, data: DocData) {
    this.touched.push(path);
    this.docs.set(path, structuredClone(data));
  }
  async create(path: string, data: DocData) {
    this.touched.push(path);
    if (this.docs.has(path)) return false;
    this.docs.set(path, structuredClone(data));
    return true;
  }
  async update(path: string, data: DocData) {
    this.touched.push(path);
    const d = this.docs.get(path);
    if (!d) throw new Error(`NOT_FOUND: ${path}`);
    this.docs.set(path, { ...d, ...structuredClone(data) });
  }
  async query(collectionPath: string, spec: QuerySpec = {}) {
    this.touched.push(collectionPath);
    const depth = collectionPath.split("/").length + 1;
    let rows = [...this.docs.entries()]
      .filter(([p]) => p.startsWith(`${collectionPath}/`) && p.split("/").length === depth)
      .map(([p, data]) => ({ id: p.split("/").pop() as string, data: structuredClone(data) }));
    for (const [field, op, value] of spec.where ?? []) {
      rows = rows.filter(({ data }) => {
        const v = data[field];
        return op === "==" ? v === value : op === ">=" ? Number(v) >= Number(value) : Number(v) < Number(value);
      });
    }
    if (spec.orderBy) {
      const { field, direction } = spec.orderBy;
      rows.sort((a, b) => (Number(a.data[field]) - Number(b.data[field])) * (direction === "asc" ? 1 : -1));
    }
    return spec.limit ? rows.slice(0, spec.limit) : rows;
  }
}
