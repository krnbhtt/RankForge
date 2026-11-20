import { NextResponse } from 'next/server';
import { getWebAuditStore } from '@/lib/audit-store';

export const dynamic = 'force-dynamic';

/** Audits grouped by store domain, for agencies that look after several stores (F8.1). */
export async function GET() {
  try {
    const audits = await getWebAuditStore().listAudits(200);
    const stores = new Map<string, { domain: string; platform: string; audits: unknown[] }>();
    for (const a of audits) {
      let domain: string;
      try {
        domain = new URL(a.targetUrl).hostname.replace(/^www\./, '');
      } catch {
        continue;
      }
      const entry = stores.get(domain) ?? { domain, platform: a.platform ?? 'unknown', audits: [] };
      entry.audits.push({
        auditId: a.auditId,
        targetUrl: a.targetUrl,
        keyword: a.keyword ?? null,
        status: a.status,
        createdAt: a.createdAt,
        ppiBefore: a.scores?.baseline?.ppi.current ?? null,
        ppiAfter: a.scores?.optimized?.ppi.current ?? null,
      });
      stores.set(domain, entry);
    }
    return NextResponse.json({ stores: [...stores.values()] });
  } catch {
    return NextResponse.json({ stores: [] });
  }
}
