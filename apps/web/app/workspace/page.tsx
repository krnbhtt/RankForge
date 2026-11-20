'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface WorkspaceAudit {
  auditId: string;
  targetUrl: string;
  keyword: string | null;
  status: string;
  createdAt: string;
  ppiBefore: number | null;
  ppiAfter: number | null;
}

interface WorkspaceStore {
  domain: string;
  platform: string;
  audits: WorkspaceAudit[];
}

const STATUS_LABEL: Record<string, string> = {
  complete: 'Complete',
  failed: 'Failed',
  blocked: 'Page blocked',
  queued: 'Queued',
};

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? u.hostname : u.pathname;
  } catch {
    return url;
  }
}

/** Workspace (F8.1): the stores an agency looks after, each with its audits and scores. */
export default function WorkspacePage() {
  const [stores, setStores] = useState<WorkspaceStore[] | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/workspace')
      .then((r) => r.json())
      .then((j: { stores: WorkspaceStore[] }) => {
        if (!cancelled) setStores(j.stores);
      })
      .catch(() => {
        if (!cancelled) setProblem(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 font-sans dark:bg-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Workspace</h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">Your stores and the audits you have run for them.</p>
          </div>
          <Link href="/" className="min-h-[44px] inline-flex items-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700">
            New audit
          </Link>
        </header>

        {problem && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            We could not load your stores. Reload the page to try again.
          </p>
        )}

        {stores === null && !problem && (
          <div role="status" aria-label="Loading stores" className="space-y-3 animate-pulse">
            <div className="h-24 rounded-xl bg-slate-200 dark:bg-slate-800" />
            <div className="h-24 rounded-xl bg-slate-200 dark:bg-slate-800" />
          </div>
        )}

        {stores && stores.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
            <p className="text-sm text-slate-700 dark:text-slate-300">No audits yet. Run your first one to see the store here.</p>
          </div>
        )}

        {stores?.map((store) => (
          <section key={store.domain} aria-label={store.domain} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{store.domain}</h2>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">{store.platform}</span>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
              {store.audits.map((a) => (
                <li key={a.auditId}>
                  <Link href={`/studio/${a.auditId}`} className="flex min-h-[44px] items-center justify-between gap-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-slate-900 dark:text-slate-100">{pathOf(a.targetUrl)}</span>
                      <span className="block truncate text-xs text-slate-500">
                        {a.keyword ?? 'No keyword'} · {new Date(a.createdAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="shrink-0 text-right text-xs">
                      <span className={a.status === 'complete' ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-600 dark:text-slate-400'}>{STATUS_LABEL[a.status] ?? 'In progress'}</span>
                      {a.ppiBefore !== null && (
                        <span className="block text-slate-700 dark:text-slate-300">
                          Score {a.ppiBefore}
                          {a.ppiAfter !== null ? ` to ${a.ppiAfter}` : ''}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <p className="text-xs text-slate-500">
          Sign-in with Google is not set up yet, so this list shows every audit on this server. Per-user workspaces need a Firebase project with Google sign-in turned on.
        </p>
      </div>
    </main>
  );
}
