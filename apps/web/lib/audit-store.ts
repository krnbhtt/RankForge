import * as fs from 'fs';
import * as path from 'path';
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

/**
 * Sanitizes and validates an auditId to protect against path traversal and malformed inputs.
 */
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

export class WebAuditStore {
  private baseDir: string;
  private emitter = new EventEmitter();
  private watchers = new Map<string, fs.FSWatcher>();

  constructor(customBaseDir?: string) {
    if (customBaseDir) {
      this.baseDir = customBaseDir;
    } else {
      const cwd = process.cwd();
      if (cwd.includes('apps')) {
        this.baseDir = path.resolve(cwd, '../../.data/audits');
      } else {
        this.baseDir = path.resolve(cwd, '.data/audits');
      }
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

  async writeComposite(composite: AuditCompositeRecord): Promise<void> {
    const filePath = this.getFilePath(composite.audit.auditId);
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substring(2, 8)}`;
    const data = JSON.stringify(composite, null, 2);
    await fs.promises.writeFile(tmpPath, data, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
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

  async updateAudit(auditId: string, patch: Partial<AuditRecord>): Promise<AuditRecord> {
    let composite = await this.readComposite(auditId);
    if (!composite) {
      throw new Error(`Audit ${auditId} not found`);
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

  onAuditChange(auditId: string, callback: (record: AuditRecord) => void): () => void {
    const eventName = `change:${auditId}`;
    this.emitter.on(eventName, callback);

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
        // Fallback to emitter
      }
    }

    return () => {
      this.emitter.off(eventName, callback);
    };
  }
}

let webAuditStoreInstance: WebAuditStore | null = null;

export function getWebAuditStore(customBaseDir?: string): WebAuditStore {
  if (!webAuditStoreInstance || customBaseDir) {
    webAuditStoreInstance = new WebAuditStore(customBaseDir);
  }
  return webAuditStoreInstance;
}
