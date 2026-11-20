import { FileAuditStore, type IAuditStore } from './file-store.js';
import { FirestoreAuditStore } from './firestore-store.js';

export * from './file-store.js';
export { FirestoreAuditStore } from './firestore-store.js';

/** Firestore when an emulator host or AUDIT_STORE=firestore is configured, otherwise the local file store. */
export function createAuditStoreFromEnv(env: NodeJS.ProcessEnv = process.env): IAuditStore {
  if (env.FIRESTORE_EMULATOR_HOST || env.AUDIT_STORE === 'firestore') return new FirestoreAuditStore();
  return new FileAuditStore();
}

let shared: IAuditStore | null = null;

/** Process-wide store. Passing a directory forces a file store there (used by tests). */
export function getAuditStore(customBaseDir?: string): IAuditStore {
  if (customBaseDir) {
    shared = new FileAuditStore(customBaseDir);
  } else if (!shared) {
    shared = createAuditStoreFromEnv();
  }
  return shared;
}
