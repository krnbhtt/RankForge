import { NextResponse } from 'next/server';
import { getWebAuditStore } from '@/lib/audit-store';

export const dynamic = 'force-dynamic';

/** Completed audits that can be opened instantly: the prepared examples shown when live credits are used up. */
export async function GET() {
  try {
    const audits = (await getWebAuditStore().listAudits(60)).filter((a) => a.status === 'complete' && a.capture && a.scores?.optimized && a.scores.optimized.attributions.length > 0 && a.scores.optimized.ppi.current > (a.scores.baseline?.ppi.current ?? Infinity));
    const seen = new Set<string>();
    const items = audits
      .filter((a) => {
        const key = `${a.targetUrl}|${a.keyword ?? ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6)
      .map((a) => ({
        auditId: a.auditId,
        targetUrl: a.targetUrl,
        keyword: a.keyword ?? null,
        createdAt: a.createdAt,
        ppiBefore: a.scores?.baseline?.ppi.current ?? null,
        ppiAfter: a.scores?.optimized?.ppi.current ?? null,
      }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
