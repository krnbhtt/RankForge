import { FileAuditStore, getAuditStore, type IAuditStore } from '@rankforge/audit-store';

export { sanitizeAuditId } from '@rankforge/audit-store';
export type { AuditCompositeRecord } from '@rankforge/audit-store';

/** Local file store class, kept for tests. */
export const WebAuditStore = FileAuditStore;

export function getWebAuditStore(customBaseDir?: string): IAuditStore {
  return getAuditStore(customBaseDir);
}
