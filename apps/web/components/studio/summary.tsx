'use client';

import React from 'react';
import type { AuditBlueprintSection, AuditFinding, AuditPatch, AuditRecord } from '@rankforge/schema';
import type { AuditReportBundle } from '@/hooks/use-audit-report';

/** Problems that live in the store's own data or settings, which a demonstration rebuild cannot change. */
const NEEDS_STORE_CHANGE = /price|variant|pop-up|core web vitals|tap target|text is small/i;

const SEVERITY_WEIGHT: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function top(findings: AuditFinding[], wanted: ('ranking' | 'conversion')[], n = 3): AuditFinding[] {
  return findings
    .filter((f) => wanted.includes(f.category as 'ranking' | 'conversion') || f.category === 'both')
    .sort((a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0) || b.penaltyPoints - a.penaltyPoints)
    .slice(0, n);
}

function Reason({ f }: { f: AuditFinding }) {
  return (
    <li className="space-y-0.5">
      <div className="font-medium text-slate-900 dark:text-slate-100 text-xs">{f.title}</div>
      {f.evidence && <div className="text-[11px] text-slate-600 dark:text-slate-400">{f.evidence}</div>}
    </li>
  );
}

/**
 * "In plain English": the two questions the product answers, with the strongest evidence for each, so a newcomer can
 * explain after one run why the page is not ranking and why it is not converting.
 */
export function SummaryPanel({ audit, findings, patches, bundle }: { audit: AuditRecord | null; findings: AuditFinding[]; patches: AuditPatch[]; bundle: AuditReportBundle | null }) {
  if (findings.length === 0) {
    return <p className="text-xs text-slate-600 dark:text-slate-400">The summary appears here once your page has been analysed.</p>;
  }
  const ranking = top(findings, ['ranking']);
  const needsYou = findings.filter((f) => NEEDS_STORE_CHANGE.test(f.title)).slice(0, 3);
  const converting = top(findings, ['conversion']);
  const applied = new Set(patches.filter((p) => p.status === 'applied').map((p) => p.sectionId));
  const dropped = bundle?.report?.dropped?.length ?? 0;
  const before = audit?.scores?.baseline;
  const after = audit?.scores?.optimized;
  return (
    <div className="space-y-4">
      <section aria-label="Why the page is not ranking" className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Why this page is not ranking higher</h2>
        <ul className="space-y-2 list-disc pl-4 marker:text-purple-600">{ranking.map((f) => <Reason key={f.findingId} f={f} />)}</ul>
        {before && <p className="text-[11px] text-slate-500">Visibility score today: {before.visibility.current} out of 100.</p>}
      </section>
      <section aria-label="Why the page is not converting" className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Why visitors are not buying</h2>
        <ul className="space-y-2 list-disc pl-4 marker:text-blue-600">{converting.map((f) => <Reason key={f.findingId} f={f} />)}</ul>
        {before && <p className="text-[11px] text-slate-500">Conversion score today: {before.conversion.current} out of 100.</p>}
      </section>
      {needsYou.length > 0 && (
        <section aria-label="Problems only you can fix" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950/40">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Needs a change in your store</h2>
          <p className="text-[11px] text-amber-900 dark:text-amber-200">
            The rebuild is a demonstration and never touches your store, so it cannot fix these: {needsYou.map((f) => f.title.toLowerCase()).join('; ')}.
          </p>
        </section>
      )}
      <section aria-label="What was changed" className="space-y-1 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">What the rebuilt page changes</h2>
        {applied.size === 0 ? (
          <p className="text-[11px] text-slate-600 dark:text-slate-400">The rebuilt version appears here as it is built.</p>
        ) : (
          <p className="text-[11px] text-slate-600 dark:text-slate-400">
            {applied.size} change{applied.size === 1 ? '' : 's'} applied to your page (look for the numbered tags on the right).{' '}
            {dropped > 0 ? `${dropped} more were tried and left out because they would have damaged the page. ` : ''}
            {after && before ? `Overall score ${before.ppi.current} to ${after.ppi.current}, including content labelled Sample.` : ''}
          </p>
        )}
      </section>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  finding: 'Found on your page',
  competitor_pattern: 'Competitors do this',
  playbook_rule: 'Best practice',
};

const TAG_STYLE: Record<string, string> = {
  Ranking: 'bg-purple-100 text-purple-900 dark:bg-purple-950 dark:text-purple-200',
  Conversion: 'bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200',
  Both: 'bg-teal-100 text-teal-900 dark:bg-teal-950 dark:text-teal-200',
};

/** The blueprint as an outline: each planned section, why it exists, and whether it made it onto the page. */
export function PlanPanel({ blueprint, patches, bundle }: { blueprint: AuditBlueprintSection[]; patches: AuditPatch[]; bundle: AuditReportBundle | null }) {
  const sections = [...blueprint].filter((b) => b.spec).sort((a, b) => a.order - b.order);
  if (sections.length === 0) {
    return <p className="text-xs text-slate-600 dark:text-slate-400">The plan for your page appears here after the analysis.</p>;
  }
  const failed = new Map(patches.filter((p) => p.status === 'failed').map((p) => [p.sectionId, p.failureReason ?? 'It could not be applied.']));
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-600 dark:text-slate-400">Every section below is backed by something we measured. Sections marked Sample show illustrative content.</p>
      <ol className="space-y-2">
        {sections.map((b) => {
          const spec = b.spec!;
          const reason = failed.get(b.sectionId);
          const state = reason ? 'Left out' : b.status === 'completed' ? 'Added' : b.status === 'in_progress' ? 'Building' : 'Planned';
          return (
            <li key={b.sectionId} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/40 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {b.order}. {spec.h2}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${TAG_STYLE[spec.tag]}`}>{spec.tag}</span>
                    {spec.sample && <span className="rounded border border-amber-300 bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">Sample</span>}
                  </div>
                </div>
                <span className={`shrink-0 text-[11px] font-medium ${reason ? 'text-amber-800 dark:text-amber-300' : state === 'Added' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>{state}</span>
              </div>
              <ul className="space-y-0.5">
                {spec.justifications.slice(0, 3).map((j, i) => (
                  <li key={i} className="text-[11px] text-slate-600 dark:text-slate-400">
                    <span className="font-medium">{KIND_LABEL[j.kind] ?? j.kind}:</span> {j.note}
                  </li>
                ))}
              </ul>
              {reason && <p className="text-[11px] text-amber-800 dark:text-amber-300">Left out: {reason}</p>}
            </li>
          );
        })}
      </ol>
      {bundle?.report?.blueprint && bundle.report.blueprint.length > 0 && (
        <details className="text-[11px] text-slate-600 dark:text-slate-400">
          <summary className="cursor-pointer font-medium">How the plan was decided</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {bundle.report.blueprint.map((d, i) => (
              <li key={i}>
                {d.decision}. {d.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
