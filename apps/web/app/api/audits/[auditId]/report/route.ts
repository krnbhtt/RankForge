import { type NextRequest, NextResponse } from 'next/server';
import { UserInputError, toRankForgeError } from '@rankforge/schema';
import { artifactKeys, createStorageFromEnv, type ArtifactStorage } from '@rankforge/storage';
import { getWebAuditStore } from '@/lib/audit-store';

const AUDIT_ID = /^[a-zA-Z0-9_-]+$/;

async function readJson<T>(storage: ArtifactStorage, key: string): Promise<T | null> {
  const obj = await storage.get(key);
  return obj ? (JSON.parse(obj.body.toString('utf8')) as T) : null;
}

/**
 * Read-only bundle for the studio panels: the verification report, category and gap analysis, and the structured data
 * before and after. Everything comes from artifacts the worker wrote; nothing is computed here.
 */
export async function GET(_req: NextRequest, { params }: { params: { auditId: string } }) {
  try {
    const { auditId } = params;
    if (!AUDIT_ID.test(auditId)) {
      return NextResponse.json({ success: false, error: new UserInputError('That audit link is not valid.').toAuditError() }, { status: 400 });
    }
    const storage = createStorageFromEnv();
    const [report, analysis, extraction, patches] = await Promise.all([
      readJson<Record<string, unknown>>(storage, `${auditId}/report.json`),
      readJson<{ trust: unknown; gap: unknown; cwv: unknown; unmeasured?: string[] }>(storage, `${auditId}/analysis.json`),
      readJson<{ jsonLd: unknown[] }>(storage, artifactKeys.extraction(auditId)),
      getWebAuditStore().getPatches(auditId),
    ]);

    const schemaAfter = patches
      .filter((p) => p.op === 'injectJsonLd' && p.status === 'applied' && p.htmlPayload)
      .map((p) => {
        try {
          return JSON.parse(p.htmlPayload as string) as unknown;
        } catch {
          return null;
        }
      })
      .filter((x): x is unknown => x !== null);

    return NextResponse.json({
      success: true,
      report,
      trust: analysis?.trust ?? null,
      gap: analysis?.gap ?? null,
      cwv: analysis?.cwv ?? null,
      unmeasured: analysis?.unmeasured ?? [],
      schemaBefore: extraction?.jsonLd ?? [],
      schemaAfter,
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: toRankForgeError(err).toAuditError() }, { status: 500 });
  }
}
