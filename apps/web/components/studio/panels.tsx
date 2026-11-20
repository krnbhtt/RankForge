'use client';

import React, { useState } from 'react';
import type { AuditQuery } from '@rankforge/schema';
import type { AuditReportBundle } from '@/hooks/use-audit-report';

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-slate-600 dark:text-slate-400">{children}</p>;
}

const SOURCE_LABEL: Record<string, string> = { paa: 'People also ask', related: 'Related search', grounding: 'Added step', generated: 'Added step' };

/** The shopper's question journey (X, then Y, then Z) with whether the page answers each step, before and after. */
export function QueriesPanel({ queries, bundle }: { queries: AuditQuery[]; bundle: AuditReportBundle | null }) {
  const steps = bundle?.gap?.querySequence?.length
    ? bundle.gap.querySequence.map((q) => ({ order: q.order, query: q.query, answeredBefore: q.answered, source: q.source }))
    : [...queries].sort((a, b) => a.step - b.step).map((q) => ({ order: q.step, query: q.query, answeredBefore: q.answered, source: q.source }));
  if (steps.length === 0) return <Empty>Shopper questions appear here after competitors have been read.</Empty>;
  const answered = steps.filter((s) => s.answeredBefore).length;
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-slate-600 dark:text-slate-400">
        {answered} of {steps.length} questions are answered on your page today.
      </div>
      <ol className="space-y-2">
        {steps.map((s) => (
          <li key={s.order} className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 flex gap-2 items-start">
            <span className="mt-0.5 w-5 h-5 shrink-0 rounded-full bg-blue-600 text-white text-[10px] font-bold flex items-center justify-center">{s.order}</span>
            <div className="min-w-0">
              <div className="font-medium text-slate-900 dark:text-slate-100 text-xs">{s.query}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                {SOURCE_LABEL[s.source] ?? s.source} ·{' '}
                <span className={s.answeredBefore ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                  {s.answeredBefore ? 'Answered' : 'Not answered'}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="p-3 bg-slate-900 text-slate-200 rounded-lg font-mono text-[11px] overflow-x-auto leading-relaxed border border-slate-800 max-h-72">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** Structured data on the page today and the Product and Breadcrumb data the rebuild adds. */
export function SchemaPanel({ bundle }: { bundle: AuditReportBundle | null }) {
  const [copied, setCopied] = useState(false);
  if (!bundle) return <Empty>Structured data appears here once your page has been analysed.</Empty>;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(bundle.schemaAfter, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-4">
      <section aria-label="Structured data today" className="space-y-1.5">
        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">On your page today</div>
        {bundle.schemaBefore.length ? <JsonBlock value={bundle.schemaBefore} /> : <Empty>No JSON-LD structured data was found.</Empty>}
      </section>
      <section aria-label="Structured data added" className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">Added by the rebuild</span>
          {bundle.schemaAfter.length > 0 && (
            <button
              type="button"
              onClick={copy}
              className="px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded min-h-[36px]"
            >
              {copied ? 'Copied' : 'Copy JSON-LD'}
            </button>
          )}
        </div>
        {bundle.schemaAfter.length ? <JsonBlock value={bundle.schemaAfter} /> : <Empty>The rebuild has not added structured data (yet, or none was needed).</Empty>}
      </section>
    </div>
  );
}

/** Tone and trust score and the Google Product Taxonomy category check. */
export function CategoryPanel({ bundle }: { bundle: AuditReportBundle | null }) {
  const t = bundle?.trust;
  if (!t) return <Empty>The category check appears here once your page has been analysed.</Empty>;
  const different = t.currentCategory.trim().toLowerCase() !== t.recommendedCategory.trim().toLowerCase();
  return (
    <div className="space-y-4">
      <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase text-slate-500">Category the page uses</div>
        <div className="font-medium text-slate-800 dark:text-slate-200 break-words">{t.currentCategory || 'Not stated on the page'}</div>
      </div>
      <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-lg border border-blue-200 dark:border-blue-800 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase text-blue-700 dark:text-blue-300">Recommended Google Product Taxonomy path</div>
        <div className="font-semibold text-slate-900 dark:text-slate-100 break-words">{t.recommendedCategory}</div>
        <div className="text-[11px] text-slate-600 dark:text-slate-400">
          {t.recommendedValidated ? 'Matches an official taxonomy entry.' : 'Closest official taxonomy entry.'} {different ? '' : 'Same as the current category.'}
        </div>
        <p className="text-[11px] text-slate-600 dark:text-slate-400">{t.reason}</p>
      </div>
      <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-1.5">
        <div className="text-[10px] font-semibold uppercase text-slate-500">Tone and trust of the copy</div>
        <div className="font-semibold text-slate-900 dark:text-slate-100">{t.toneAndTrustScore} out of 4</div>
        <p className="text-[11px] text-slate-600 dark:text-slate-400">{t.toneNotes}</p>
      </div>
    </div>
  );
}
