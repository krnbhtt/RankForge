'use client';

import { useEffect, useState } from 'react';
import type { AuditStatus, ScoreCard } from '@rankforge/schema';

export interface AuditReportBundle {
  report: {
    optimisedExcludingSample?: ScoreCard;
    regression?: boolean;
    verify?: { interaction: string; sections: { sectionId: string; ok: boolean; reason?: string }[] };
    dropped?: { sectionId: string; reason: string }[];
    blueprint?: { decision: string; reason: string }[];
  } | null;
  trust: {
    toneAndTrustScore: number;
    toneNotes: string;
    currentCategory: string;
    recommendedCategory: string;
    recommendedValidated: boolean;
    reason: string;
  } | null;
  gap: {
    missing: { name: string; frequency: number }[];
    found: string[];
    querySequence: { query: string; order: number; answered: boolean; source: string; evidence: string }[];
  } | null;
  unmeasured: string[];
  schemaBefore: unknown[];
  schemaAfter: unknown[];
}

/** Loads the report bundle once the audit has reached a state where it exists, and again when it completes. */
export function useAuditReport(auditId: string, status: AuditStatus): AuditReportBundle | null {
  const [bundle, setBundle] = useState<AuditReportBundle | null>(null);
  const ready = ['analysed', 'blueprinted', 'rebuilding', 'verifying', 'complete'].includes(status);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    fetch(`/api/audits/${encodeURIComponent(auditId)}/report`)
      .then((r) => r.json())
      .then((json: { success: boolean } & AuditReportBundle) => {
        if (!cancelled && json.success) setBundle(json);
      })
      .catch(() => {
        if (!cancelled) setBundle(null);
      });
    return () => {
      cancelled = true;
    };
  }, [auditId, ready, status]);

  return bundle;
}
