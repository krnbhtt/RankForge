import { Firestore, type DocumentData } from '@google-cloud/firestore';
import type {
  AuditBlueprintSection,
  AuditCompetitor,
  AuditFinding,
  AuditImage,
  AuditPatch,
  AuditQuery,
  AuditRecord,
} from '@rankforge/schema';
import { sanitizeAuditIdOnly, type AuditCompositeRecord, type IAuditStore } from './file-store.js';

const SUBCOLLECTIONS = {
  competitors: 'competitors',
  findings: 'findings',
  queries: 'queries',
  blueprint: 'blueprint',
  patches: 'patches',
  images: 'images',
} as const;

/**
 * Firestore-backed audit store (spec 6.1). Writes are idempotent: every document has a deterministic id,
 * so a retried stage rewrites the same documents. Honors FIRESTORE_EMULATOR_HOST automatically.
 */
export class FirestoreAuditStore implements IAuditStore {
  private readonly db: Firestore;

  constructor(options: { projectId?: string; db?: Firestore } = {}) {
    this.db =
      options.db ??
      new Firestore({
        projectId: options.projectId ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? 'rankforge-dev',
        ignoreUndefinedProperties: true,
      });
  }

  private audit(auditId: string) {
    return this.db.collection('audits').doc(sanitizeAuditIdOnly(auditId));
  }

  async createAudit(record: AuditRecord): Promise<void> {
    // ownerUid backs the Firestore security rules (spec 8.8).
    await this.audit(record.auditId).set({ ...record, ownerUid: record.userId });
  }

  async listAudits(limit: number): Promise<AuditRecord[]> {
    const snap = await this.db.collection('audits').orderBy('createdAt', 'desc').limit(limit).get();
    return snap.docs.map((d) => stripOwner(d.data()));
  }

  async findRecentComplete(targetUrl: string, keyword: string | undefined, maxAgeMs: number): Promise<AuditRecord | null> {
    // Equality filter only (no composite index needed); the rest is filtered here.
    const snap = await this.db.collection('audits').where('targetUrl', '==', targetUrl).limit(25).get();
    let best: AuditRecord | null = null;
    for (const doc of snap.docs) {
      const a = stripOwner(doc.data());
      if (a.status !== 'complete') continue;
      if (keyword && a.keyword !== keyword) continue;
      if (Date.now() - Date.parse(a.createdAt) > maxAgeMs) continue;
      if (!best || a.createdAt > best.createdAt) best = a;
    }
    return best;
  }

  async getAudit(auditId: string): Promise<AuditRecord | null> {
    const snap = await this.audit(auditId).get();
    return snap.exists ? stripOwner(snap.data() as DocumentData) : null;
  }

  async updateAudit(auditId: string, patch: Partial<AuditRecord>): Promise<AuditRecord> {
    const ref = this.audit(auditId);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error(`Audit ${auditId} not found in store`);
      const current = stripOwner(snap.data() as DocumentData);
      const updated: AuditRecord = {
        ...current,
        ...patch,
        stageTimings: { ...current.stageTimings, ...(patch.stageTimings ?? {}) },
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, { ...updated, ownerUid: updated.userId });
      return updated;
    });
  }

  private async replace<T extends object>(
    auditId: string,
    name: string,
    items: T[],
    idOf: (item: T) => string
  ): Promise<void> {
    const col = this.audit(auditId).collection(name);
    const keep = new Set(items.map(idOf));
    const existing = await col.listDocuments();
    const batch = this.db.batch();
    for (const doc of existing) if (!keep.has(doc.id)) batch.delete(doc);
    for (const item of items) batch.set(col.doc(idOf(item)), item as DocumentData);
    await batch.commit();
  }

  private async list<T>(auditId: string, name: string): Promise<T[]> {
    const snap = await this.audit(auditId).collection(name).get();
    return snap.docs.map((d) => d.data() as T);
  }

  saveCompetitors(auditId: string, items: AuditCompetitor[]) {
    return this.replace(auditId, SUBCOLLECTIONS.competitors, items, (i) => i.competitorId);
  }
  getCompetitors(auditId: string) {
    return this.list<AuditCompetitor>(auditId, SUBCOLLECTIONS.competitors).then((r) => r.sort((a, b) => a.rank - b.rank));
  }
  saveFindings(auditId: string, items: AuditFinding[]) {
    return this.replace(auditId, SUBCOLLECTIONS.findings, items, (i) => i.findingId);
  }
  getFindings(auditId: string) {
    return this.list<AuditFinding>(auditId, SUBCOLLECTIONS.findings);
  }
  saveQueries(auditId: string, items: AuditQuery[]) {
    return this.replace(auditId, SUBCOLLECTIONS.queries, items, (i) => i.queryId);
  }
  getQueries(auditId: string) {
    return this.list<AuditQuery>(auditId, SUBCOLLECTIONS.queries);
  }
  saveBlueprint(auditId: string, items: AuditBlueprintSection[]) {
    return this.replace(auditId, SUBCOLLECTIONS.blueprint, items, (i) => i.sectionId);
  }
  getBlueprint(auditId: string) {
    return this.list<AuditBlueprintSection>(auditId, SUBCOLLECTIONS.blueprint).then((r) =>
      r.sort((a, b) => (a as { order?: number }).order! - (b as { order?: number }).order!)
    );
  }
  savePatches(auditId: string, items: AuditPatch[]) {
    return this.replace(auditId, SUBCOLLECTIONS.patches, items, (i) => i.patchId);
  }
  getPatches(auditId: string) {
    return this.list<AuditPatch>(auditId, SUBCOLLECTIONS.patches);
  }
  saveImages(auditId: string, items: AuditImage[]) {
    return this.replace(auditId, SUBCOLLECTIONS.images, items, (i) => i.imageId);
  }
  getImages(auditId: string) {
    return this.list<AuditImage>(auditId, SUBCOLLECTIONS.images);
  }

  async getFullRecord(auditId: string): Promise<AuditCompositeRecord | null> {
    const audit = await this.getAudit(auditId);
    if (!audit) return null;
    const [competitors, findings, queries, blueprint, patches, images] = await Promise.all([
      this.getCompetitors(auditId),
      this.getFindings(auditId),
      this.getQueries(auditId),
      this.getBlueprint(auditId),
      this.getPatches(auditId),
      this.getImages(auditId),
    ]);
    return { audit, competitors, findings, queries, blueprint, patches, images };
  }

  readComposite(auditId: string): Promise<AuditCompositeRecord | null> {
    return this.getFullRecord(auditId);
  }

  onAuditChange(auditId: string, callback: (record: AuditRecord) => void): () => void {
    return this.audit(auditId).onSnapshot((snap) => {
      if (snap.exists) callback(stripOwner(snap.data() as DocumentData));
    });
  }
}

function stripOwner(data: DocumentData): AuditRecord {
  const { ownerUid: _ownerUid, ...rest } = data;
  return rest as AuditRecord;
}
