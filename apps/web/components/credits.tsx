'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

export interface QuotaState {
  known: boolean;
  serpOk?: boolean;
  serpRemaining?: number | null;
  aiOk?: boolean;
  aiConfigured?: boolean;
}

export interface ShowcaseItem {
  auditId: string;
  targetUrl: string;
  keyword: string | null;
  createdAt: string;
  ppiBefore: number | null;
  ppiAfter: number | null;
}

/** Polls the quota endpoint so a judge sees "credits are used up" before starting a run, not after it fails. */
export function useQuota(intervalMs = 60_000): QuotaState {
  const [quota, setQuota] = useState<QuotaState>({ known: false });
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch('/api/quota')
        .then((r) => r.json())
        .then((q: QuotaState) => {
          if (!cancelled) setQuota(q);
        })
        .catch(() => {
          if (!cancelled) setQuota({ known: false });
        });
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [intervalMs]);
  return quota;
}

export function useShowcase(): ShowcaseItem[] {
  const [items, setItems] = useState<ShowcaseItem[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/showcase')
      .then((r) => r.json())
      .then((j: { items: ShowcaseItem[] }) => {
        if (!cancelled) setItems(j.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return items;
}

/** Plain-language message for each kind of credit that can run out. */
export function quotaMessage(service: string | undefined): { title: string; body: string } {
  switch (service) {
    case 'serp':
      return {
        title: "Today's search credits are used up",
        body: 'We need a search to find the top competitors, and the daily allowance has run out. It renews daily; pages we have already searched still work.',
      };
    case 'gemini':
      return {
        title: "Today's AI credits are used up",
        body: 'The AI models we use have reached their daily limit. It renews daily.',
      };
    case 'budget':
      return {
        title: 'This audit reached its spending limit',
        body: 'Each audit has a cost cap so a single run cannot use up the budget. Nothing was lost; the work done so far is saved.',
      };
    default:
      return {
        title: 'We are at capacity right now',
        body: 'Too many requests are being processed. Please try again in a minute.',
      };
  }
}

export function CreditsNotice({ quota }: { quota: QuotaState }) {
  if (!quota.known) return null;
  const problems: string[] = [];
  if (quota.serpOk === false) problems.push('search');
  if (quota.aiOk === false) problems.push('AI');
  if (quota.aiConfigured === false) problems.push('AI setup');
  if (problems.length === 0) return null;
  const message =
    quota.aiConfigured === false
      ? { title: 'The AI service is not configured', body: 'An administrator needs to add the AI key. The prepared examples below still open.' }
      : quotaMessage(quota.serpOk === false ? 'serp' : 'gemini');
  return (
    <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="font-semibold">{message.title}</div>
      <p className="mt-1 text-xs">{message.body} You can still open the prepared examples below.</p>
    </div>
  );
}

export function PreparedExamples({ items, heading = 'Prepared examples (open instantly)' }: { items: ShowcaseItem[]; heading?: string }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={heading} className="space-y-2 text-left">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{heading}</h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => {
          let domain = i.targetUrl;
          try {
            domain = new URL(i.targetUrl).hostname.replace(/^www\./, '');
          } catch {
            domain = i.targetUrl;
          }
          return (
            <li key={i.auditId}>
              <Link
                href={`/studio/${i.auditId}`}
                className="block min-h-[44px] rounded-lg border border-slate-200 bg-white p-3 text-sm hover:border-blue-400 dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="font-medium text-slate-900 dark:text-slate-100 truncate">{domain}</div>
                <div className="text-xs text-slate-500 truncate">{i.keyword ?? 'No keyword'}</div>
                {i.ppiBefore !== null && i.ppiAfter !== null && (
                  <div className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                    Score {i.ppiBefore} to {i.ppiAfter}
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
