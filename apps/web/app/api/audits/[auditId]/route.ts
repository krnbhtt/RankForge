import { type NextRequest, NextResponse } from 'next/server';
import { AuditErrorSchema } from '@rankforge/schema';
import { getWebAuditStore } from '@/lib/audit-store';

export async function GET(
  _req: NextRequest,
  { params }: { params: { auditId: string } }
) {
  try {
    const { auditId } = params;
    const store = getWebAuditStore();
    const composite = await store.readComposite(auditId);

    if (!composite || !composite.audit) {
      const errorPayload = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: `Audit with ID '${auditId}' was not found.`,
        recoveryAction: 'Verify the audit ID or return to the Start screen to initiate a new audit.',
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: false, error: errorPayload }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      audit: composite.audit,
      competitors: composite.competitors,
      findings: composite.findings,
      queries: composite.queries,
      blueprint: composite.blueprint,
      patches: composite.patches,
      images: composite.images,
    });
  } catch (err) {
    const error = err as Error;
    const errorPayload = AuditErrorSchema.parse({
      code: 'InternalError',
      message: error.message || 'Failed to retrieve audit snapshot',
      recoveryAction: 'Retry loading the audit record',
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ success: false, error: errorPayload }, { status: 500 });
  }
}
