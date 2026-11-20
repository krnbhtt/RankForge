'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Sparkles, ShieldCheck, AlertCircle } from 'lucide-react';
import { CreditsNotice, PreparedExamples, useQuota, useShowcase } from '@/components/credits';

export default function StartPage() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [imageConsent, setImageConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quota = useQuota();
  const examples = useShowcase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/audits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.trim(),
          keyword: keyword.trim() || undefined,
          imageConsent,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to initialize audit.');
      }

      // Navigate to live studio page
      router.push(`/studio/${data.auditId}`);
    } catch (err: unknown) {
      const errorMsg = (err as Error).message || 'An error occurred while starting the audit.';
      setError(errorMsg);
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-16 sm:px-6 lg:px-8 bg-slate-50 dark:bg-slate-950 font-sans">
      <div className="w-full max-w-2xl space-y-8 text-center">
        {/* Brand Header */}
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Autonomous E-Commerce Optimization</span>
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-5xl">
            RankForge AI
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-400 sm:text-lg">
            Enter any product URL to diagnose ranking deficits, analyze top organic competitors, and rebuild your page with live uplift scoring.
          </p>
        </div>

        <CreditsNotice quota={quota} />

        {/* Start Form Container */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-xs text-red-700 dark:bg-red-950/50 dark:border-red-900 dark:text-red-300 text-left">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            <div>
              <label htmlFor="product-url" className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                Product Page URL <span className="text-red-500">*</span>
              </label>
              <input
                id="product-url"
                type="url"
                required
                placeholder="https://yourstore.com/products/example-item"
                value={url}
                onChange={(e: any) => setUrl(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 min-h-[44px]"
              />
            </div>

            <div>
              <label htmlFor="target-keyword" className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
                Target Keyword <span className="text-xs font-normal text-slate-500">(Optional — inferred automatically if omitted)</span>
              </label>
              <input
                id="target-keyword"
                type="text"
                placeholder="e.g. ceramic pour over dripper"
                value={keyword}
                onChange={(e: any) => setKeyword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-500 min-h-[44px]"
              />
            </div>

            {/* Image Generation Consent Checkbox (Spec F1.4) */}
            <div className="flex items-start gap-2 pt-1 text-left">
              <input
                id="image-consent"
                type="checkbox"
                checked={imageConsent}
                onChange={(e: any) => setImageConsent(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="image-consent" className="text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
                Also generate improved product images. They are made with AI, shown only in the preview, and always labelled Sample. Optional.
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !url.trim()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-blue-700 transition min-h-[48px]"
            >
              {loading ? (
                <span>Initiating Audit & Rebuild...</span>
              ) : (
                <>
                  <span>Audit & Rebuild Page</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Sandboxed preview isolation & SSRF protected</span>
          </div>
        </div>
        <PreparedExamples items={examples} />
        <p className="text-xs text-slate-500">
          Looking after several stores? <Link href="/workspace" className="font-medium text-blue-700 underline dark:text-blue-300">Open the workspace</Link>
        </p>
      </div>
    </main>
  );
}
