/** Pure helpers for the unseen-URL exit test (specification 11.1 to 11.3). Kept separate so they can be unit tested. */

export interface UnseenRow {
  id: string;
  url: string;
  category: string;
}

export interface Milestones {
  /** Seconds from the audit start. */
  reproducedS: number | null;
  scoresS: number | null;
  firstSectionS: number | null;
  completeS: number | null;
}

/** Performance budgets from specification 11.3, in seconds. */
export const BUDGETS = { reproducedS: 20, scoresS: 90, firstSectionS: 120, completeS: 240 } as const;

export function parseUnseenCsv(text: string): UnseenRow[] {
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const cols = (header ?? '').split(',');
  return lines
    .filter((l) => l.trim())
    .map((l) => {
      const cells = l.split(',');
      const row = Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
      return { id: row.id as string, url: row.url as string, category: (row.category as string) || 'general' };
    });
}

export function budgetReport(m: Milestones): { met: string[]; missed: string[]; allMet: boolean } {
  const met: string[] = [];
  const missed: string[] = [];
  for (const key of Object.keys(BUDGETS) as (keyof typeof BUDGETS)[]) {
    const value = m[key];
    if (value !== null && value <= BUDGETS[key]) met.push(key);
    else missed.push(key);
  }
  return { met, missed, allMet: missed.length === 0 };
}

/** Seconds between two ISO timestamps, or null if either is missing. */
export function secondsBetween(from?: string, to?: string): number | null {
  if (!from || !to) return null;
  const s = (Date.parse(to) - Date.parse(from)) / 1000;
  return Number.isFinite(s) && s >= 0 ? Math.round(s * 10) / 10 : null;
}

export interface QuotaSnapshot {
  known: boolean;
  serpOk?: boolean;
  serpRemaining?: number | null;
  aiOk?: boolean;
  aiConfigured?: boolean;
}

/** Why a run should not start, in plain language, or null when credits look fine (or are unknown). */
export function creditsBlocker(q: QuotaSnapshot): string | null {
  if (!q.known) return null;
  if (q.aiConfigured === false) return 'The AI key is not configured on the server.';
  if (q.serpOk === false) return 'The search credits for today are used up (the search service reports none left).';
  if (q.aiOk === false) return "The AI models' daily quota is used up (every model in the fallback chain is cooling down).";
  return null;
}

export const RESULT_COLUMNS = [
  'id',
  'url',
  'status',
  'errorCode',
  'reproducedS',
  'scoresS',
  'firstSectionS',
  'completeS',
  'budgetsMet',
  'ppiBefore',
  'ppiAfter',
  'ppiAfterWithoutSample',
  'costInr',
  'note',
] as const;

export type ResultRow = Record<(typeof RESULT_COLUMNS)[number], string>;

export const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: ResultRow[]): string {
  return [RESULT_COLUMNS.join(','), ...rows.map((r) => RESULT_COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
}

export function summarise(rows: ResultRow[], target = 9): { completed: number; total: number; notRun: number; passes: boolean } {
  const completed = rows.filter((r) => r.status === 'complete').length;
  const notRun = rows.filter((r) => r.status.startsWith('not_run')).length;
  return { completed, total: rows.length, notRun, passes: completed >= target };
}
