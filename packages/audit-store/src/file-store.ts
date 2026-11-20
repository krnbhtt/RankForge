import * as fs from 'fs';
import * as path from 'path';
import { findRepoRoot } from '@rankforge/storage';
import { EventEmitter } from 'events';
import type {
  AuditRecord,
  AuditCompetitor,
  AuditFinding,
  AuditQuery,
  AuditBlueprintSection,
  AuditPatch,
  AuditImage,
} from '@rankforge/schema';

export interface AuditCompositeRecord {
  audit: AuditRecord;
  competitors: AuditCompetitor[];
  findings: AuditFinding[];
  queries: AuditQuery[];
  blueprint: AuditBlueprintSection[];
  patches: AuditPatch[];
  images: AuditImage[];
}

export interface IAuditStore {
  readComposite(auditId: string): Promise<AuditCompositeRecord | null>;
  createAudit(record: AuditRecord): Promise<void>;
  getAudit(auditId: string): Promise<AuditRecord | null>;
  updateAudit(auditId: string, patch: Partial<AuditRecord>): Promise<AuditRecord>;
  getFullRecord(auditId: string): Promise<AuditCompositeRecord | null>;
  saveCompetitors(auditId: string, competitors: AuditCompetitor[]): Promise<void>;
  getCompetitors(auditId: string): Promise<AuditCompetitor[]>;
  saveFindings(auditId: string, findings: AuditFinding[]): Promise<void>;
  getFindings(auditId: string): Promise<AuditFinding[]>;
  saveQueries(auditId: string, queries: AuditQuery[]): Promise<void>;
  getQueries(auditId: string): Promise<AuditQuery[]>;
  saveBlueprint(auditId: string, sections: AuditBlueprintSection[]): Promise<void>;
  getBlueprint(auditId: string): Promise<AuditBlueprintSection[]>;
  savePatches(auditId: string, patches: AuditPatch[]): Promise<void>;
  getPatches(auditId: string): Promise<AuditPatch[]>;
  saveImages(auditId: string, images: AuditImage[]): Promise<void>;
  getImages(auditId: string): Promise<AuditImage[]>;
  onAuditChange(auditId: string, callback: (record: AuditRecord) => void): () => void;
}

/**
 * Sanitizes and validates an auditId to protect against path traversal and malformed inputs.
 */
/** Validates the id format only (used by stores that are not path based). */
export function sanitizeAuditIdOnly(auditId: string): string {
  if (!auditId || !/^[a-zA-Z0-9_-]+$/.test(auditId)) {
    throw new Error(`Invalid auditId '${auditId}': ID must only contain alphanumeric characters, hyphens, and underscores`);
  }
  return auditId;
}

export function sanitizeAuditId(auditId: string, baseDir: string): string {
  if (!auditId || typeof auditId !== 'string' || auditId.trim().length === 0) {
    throw new Error('Invalid auditId: ID must be a non-empty string');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(auditId)) {
    throw new Error(
      `Invalid auditId '${auditId}': ID must only contain alphanumeric characters, hyphens, and underscores`
    );
  }
  if (auditId.includes('..') || auditId.includes('/') || auditId.includes('\\')) {
    throw new Error(`Invalid auditId '${auditId}': Path traversal characters are prohibited`);
  }
  const resolvedBase = path.resolve(baseDir);
  const resolvedPath = path.resolve(baseDir, `${auditId}.json`);
  if (path.dirname(resolvedPath) !== resolvedBase) {
    throw new Error(`Invalid auditId '${auditId}': Target path escapes store base directory`);
  }
  return resolvedPath;
}

/**
 * Resilient File-backed Audit Store for local and offline execution.
 * Writes atomic JSON records to `.data/audits/{auditId}.json`.
 */
export class FileAuditStore implements IAuditStore {
  private baseDir: string;
  private emitter = new EventEmitter();
  private watchers = new Map<string, fs.FSWatcher>();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = customBaseDir;
    } else {
      this.baseDir = path.join(findRepoRoot(), '.data', 'audits');
    }

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(auditId: string): string {
    return sanitizeAuditId(auditId, this.baseDir);
  }

  async readComposite(auditId: string): Promise<AuditCompositeRecord | null> {
    const filePath = this.getFilePath(auditId);
    try {
      if (!fs.existsSync(filePath)) return null;
      const content = await fs.promises.readFile(filePath, 'utf8');
      return JSON.parse(content) as AuditCompositeRecord;
    } catch {
      return null;
    }
  }

  private async writeComposite(composite: AuditCompositeRecord): Promise<void> {
    const filePath = this.getFilePath(composite.audit.auditId);
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    const data = JSON.stringify(composite, null, 2);
    await fs.promises.writeFile(tmpPath, data, 'utf8');
    // On Windows a rename can fail briefly while antivirus or a watcher holds the target; retry a few times.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.promises.rename(tmpPath, filePath);
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (attempt >= 6 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    this.emitter.emit(`change:${composite.audit.auditId}`, composite.audit);
  }

  async createAudit(record: AuditRecord): Promise<void> {
    const composite: AuditCompositeRecord = {
      audit: record,
      competitors: [],
      findings: [],
      queries: [],
      blueprint: [],
      patches: [],
      images: [],
    };
    await this.writeComposite(composite);
  }

  async getAudit(auditId: string): Promise<AuditRecord | null> {
    const composite = await this.readComposite(auditId);
    return composite ? composite.audit : null;
  }

  async getFullRecord(auditId: string): Promise<AuditCompositeRecord | null> {
    return this.readComposite(auditId);
  }


  async updateAudit(auditId: string, patch: Partial<AuditRecord>): Promise<AuditRecord> {
    let composite = await this.readComposite(auditId);
    if (!composite) {
      throw new Error(`Audit ${auditId} not found in store`);
    }

    const updatedAudit: AuditRecord = {
      ...composite.audit,
      ...patch,
      stageTimings: {
        ...composite.audit.stageTimings,
        ...(patch.stageTimings || {}),
      },
      updatedAt: new Date().toISOString(),
    };

    composite = {
      ...composite,
      audit: updatedAudit,
    };

    await this.writeComposite(composite);
    return updatedAudit;
  }

  async saveCompetitors(auditId: string, competitors: AuditCompetitor[]): Promise<void> {
    const composite = await this.readComposite(auditId);
    if (composite) {
      composite.competitors = competitors;
      await this.writeComposite(composite);
    }
  }

  async getCompetitors(auditId: string): Promise<AuditCompetitor[]> {
    const composite = await this.readComposite(auditId);
    return composite?.competitors || [];
  }

  async saveFindings(auditId: string, findings: AuditFinding[]): Promise<void> {
    const composite = await this.readComposite(auditId);
    if (composite) {
      composite.findings = findings;
      await this.writeComposite(composite);
    }
  }

  async getFindings(auditId: string): Promise<AuditFinding[]> {
    const composite = await this.readComposite(auditId);
    return composite?.findings || [];
  }

  async saveQueries(auditId: string, queries: AuditQuery[]): Promise<void> {
    const composite = await this.readComposite(auditId);
    if (composite) {
      composite.queries = queries;
      await this.writeComposite(composite);
    }
  }

  async getQueries(auditId: string): Promise<AuditQuery[]> {
    const composite = await this.readComposite(auditId);
    return composite?.queries || [];
  }

  async saveBlueprint(auditId: string, sections: AuditBlueprintSection[]): Promise<void> {
    const composite = await this.readComposite(auditId);
    if (composite) {
      composite.blueprint = sections;
      await this.writeComposite(composite);
    }
  }

  async getBlueprint(auditId: string): Promise<AuditBlueprintSection[]> {
    const composite = await this.readComposite(auditId);
    return composite?.blueprint || [];
  }

  async savePatches(auditId: string, patches: AuditPatch[]): Promise<void> {
    const composite = await this.readComposite(auditId);
    if (composite) {
      composite.patches = patches;
      await this.writeComposite(composite);
    }
  }

  async getPatches(auditId: string): Promise<AuditPatch[]> {
    const composite = await this.readComposite(auditId);
    return composite?.patches || [];
  }

  async saveImages(auditId: string, images: AuditImage[]): Promise<void> {
    const composite = await this.readComposite(auditId);
    if (composite) {
      composite.images = images;
      await this.writeComposite(composite);
    }
  }

  async getImages(auditId: string): Promise<AuditImage[]> {
    const composite = await this.readComposite(auditId);
    return composite?.images || [];
  }

  onAuditChange(auditId: string, callback: (record: AuditRecord) => void): () => void {
    const eventName = `change:${auditId}`;
    this.emitter.on(eventName, callback);

    // Also attach file watcher to detect changes written by external process (e.g. worker writing, web reading)
    const filePath = this.getFilePath(auditId);
    if (!this.watchers.has(auditId) && fs.existsSync(filePath)) {
      try {
        const watcher = fs.watch(filePath, async (eventType: string) => {
          if (eventType === 'change' || eventType === 'rename') {
            const updated = await this.getAudit(auditId);
            if (updated) {
              this.emitter.emit(eventName, updated);
            }
          }
        });
        this.watchers.set(auditId, watcher);
      } catch {
        // Fallback to emitter only
      }
    }

    return () => {
      this.emitter.off(eventName, callback);
    };
  }
}
