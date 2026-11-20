import { type NextRequest, NextResponse } from 'next/server';
import {
  AuditCreateInputSchema,
  AuditCreateResponseSchema,
  AuditErrorSchema,
} from '@rankforge/schema';
import { validateTargetUrl } from '@rankforge/ssrf';
import { getWebAuditStore } from '@/lib/audit-store';
import { enqueueAuditTask } from '@/lib/task-queue';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parseResult = AuditCreateInputSchema.safeParse(body);

    if (!parseResult.success) {
      const errorPayload = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: 'Invalid audit creation input',
        recoveryAction: 'Please supply a valid HTTP or HTTPS product page URL',
        details: { issues: parseResult.error.issues },
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: false, error: errorPayload }, { status: 400 });
    }

    const { url, keyword, imageConsent, userId } = parseResult.data;

    // SSRF Validation
    const ssrfResult = await validateTargetUrl(url);
    if (!ssrfResult.isValid) {
      const errorPayload = AuditErrorSchema.parse({
        code: 'UserInputError',
        message: ssrfResult.error || 'The requested URL failed SSRF security verification.',
        recoveryAction: 'Provide a publicly accessible e-commerce product URL.',
        timestamp: new Date().toISOString(),
      });
      return NextResponse.json({ success: false, error: errorPayload }, { status: 400 });
    }

    const auditId = crypto.randomUUID();
    const now = new Date().toISOString();
    const store = getWebAuditStore();

    // Persist initial audit record
    await store.createAudit({
      auditId,
      wsId: 'default',
      userId: userId || 'anonymous',
      targetUrl: url,
      keyword,
      keywordCandidates: [],
      imageConsent: Boolean(imageConsent),
      status: 'queued',
      stage: 'init',
      progressPercent: 5,
      platform: 'unknown',
      patchMode: 'static',
      stageTimings: {
        queued: now,
      },
      createdAt: now,
      updatedAt: now,
      totalCostInr: 0,
    });

    // Enqueue task asynchronously (unawaited)
    enqueueAuditTask({
      auditId,
      targetUrl: url,
      keyword,
      imageConsent: Boolean(imageConsent),
      fastMode: false,
    });

    const responsePayload = AuditCreateResponseSchema.parse({
      success: true,
      auditId,
      status: 'queued',
      createdAt: now,
    });

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err) {
    const error = err as Error;
    const errorPayload = AuditErrorSchema.parse({
      code: 'InternalError',
      message: error.message || 'An error occurred while creating the audit',
      recoveryAction: 'Please retry creating the audit job',
      timestamp: new Date().toISOString(),
    });
    return NextResponse.json({ success: false, error: errorPayload }, { status: 500 });
  }
}
