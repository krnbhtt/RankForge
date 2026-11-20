/**
 * Phase 7 exit test: run every URL in docs/unseen.csv through the real pipeline and record whether 9 of 10 complete
 * within the performance budgets of specification 11.3.
 *
 * Usage:  pnpm exam [--resume] [--only u01,u02] [--url http://localhost:3000]
 *
 * Needs the web app and worker running (locally or deployed) and search and AI credits. Before starting it asks the
 * server whether credits are available; if they are used up it stops, says why, and records the URLs as not run, so
 * it can be run again after the daily allowance renews (use --resume to keep the URLs that already finished).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  BUDGETS,
  budgetReport,
  creditsBlocker,
  parseUnseenCsv,
  secondsBetween,
  summarise,
  toCsv,
  type Milestones,
  type QuotaSnapshot,
  type ResultRow,
} from './lib.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (value('url') ?? process.env.RANKFORGE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const root = path.resolve(__dirname, '..', '..');
const resultsFile = path.join(root, 'docs/unseen-results.csv');
const TERMINAL = new Set(['complete', 'failed', 'blocked']);
const MAX_RUN_MS = 12 * 60_000;

interface AuditBundle {
  audit: {
    status: string;
    createdAt: string;
    totalCostInr?: number;
    stageTimings: Record<string, string>;
    error?: { code: string; message: string; details?: { service?: string } };
    scores?: { baseline?: { ppi: { current: number } }; optimized?: { ppi: { current: number } } };
  };
  patches: { sectionId: string; createdAt: string; status: string }[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string, init?: RequestInit): Promise<{ status: number; json: T; headers: Headers }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  return { status: res.status, json: (await res.json()) as T, headers: res.headers };
}

function loadExisting(): ResultRow[] {
  if (!fs.existsSync(resultsFile)) return [];
  const [header, ...lines] = fs.readFileSync(resultsFile, 'utf8').trim().split(/\r?\n/);
  const cols = (header ?? '').split(',');
  return lines.map((l) => {
    const cells = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"')) ?? [];
    return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ''])) as ResultRow;
  });
}

function boxed(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '+'.padEnd(width - 1, '-') + '+';
  console.log([bar, ...lines.map((l) => `| ${l.padEnd(width - 4)} |`), bar].join('\n'));
}

async function runOne(row: { id: string; url: string }): Promise<ResultRow> {
  const out: ResultRow = {
    id: row.id,
    url: row.url,
    status: 'failed',
    errorCode: '',
    reproducedS: '',
    scoresS: '',
    firstSectionS: '',
    completeS: '',
    budgetsMet: '',
    ppiBefore: '',
    ppiAfter: '',
    ppiAfterWithoutSample: '',
    costInr: '',
    note: '',
  };
  const created = await getJson<{ success: boolean; auditId?: string; error?: { message: string } }>(`${base}/api/audits`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: row.url, imageConsent: false, refresh: true }),
  });
  if (created.status === 429) {
    const wait = Number(created.headers.get('retry-after') ?? 30);
    console.log(`  rate limited; waiting ${wait}s`);
    await sleep(wait * 1000);
    return runOne(row);
  }
  if (!created.json.auditId) {
    out.note = created.json.error?.message ?? `HTTP ${created.status}`;
    return out;
  }
  const auditId = created.json.auditId;
  const started = Date.now();
  let bundle: AuditBundle | null = null;
  while (Date.now() - started < MAX_RUN_MS) {
    await sleep(5000);
    bundle = (await getJson<AuditBundle>(`${base}/api/audits/${auditId}`)).json;
    process.stdout.write(`\r  ${row.id} ${bundle.audit.status.padEnd(18)}`);
    if (TERMINAL.has(bundle.audit.status)) break;
  }
  process.stdout.write('\n');
  if (!bundle) {
    out.note = 'No answer from the server.';
    return out;
  }
  const a = bundle.audit;
  out.status = TERMINAL.has(a.status) ? a.status : 'timed_out';
  out.errorCode = a.error?.code ?? '';
  out.note = a.error ? `${a.error.message}${a.error.details?.service ? ` [${a.error.details.service}]` : ''}` : '';
  const firstSectionAt = bundle.patches
    .filter((p) => !p.sectionId.startsWith('fix_') && p.status === 'applied')
    .map((p) => p.createdAt)
    .sort()[0];
  const milestones: Milestones = {
    reproducedS: secondsBetween(a.createdAt, a.stageTimings.captured),
    scoresS: secondsBetween(a.createdAt, a.stageTimings.analysed),
    firstSectionS: secondsBetween(a.createdAt, firstSectionAt),
    completeS: secondsBetween(a.createdAt, a.stageTimings.complete),
  };
  out.reproducedS = String(milestones.reproducedS ?? '');
  out.scoresS = String(milestones.scoresS ?? '');
  out.firstSectionS = String(milestones.firstSectionS ?? '');
  out.completeS = String(milestones.completeS ?? '');
  const report = budgetReport(milestones);
  out.budgetsMet = report.allMet ? 'all' : `missed: ${report.missed.join(' ')}`;
  out.ppiBefore = String(a.scores?.baseline?.ppi.current ?? '');
  out.ppiAfter = String(a.scores?.optimized?.ppi.current ?? '');
  out.costInr = String(a.totalCostInr ?? '');
  try {
    const rep = await getJson<{ report?: { optimisedExcludingSample?: { ppi: { current: number } } } }>(`${base}/api/audits/${auditId}/report`);
    out.ppiAfterWithoutSample = String(rep.json.report?.optimisedExcludingSample?.ppi.current ?? '');
  } catch (err) {
    out.note = `${out.note} report unavailable: ${(err as Error).message}`.trim();
  }
  return out;
}

async function main() {
  const all = parseUnseenCsv(fs.readFileSync(path.join(root, 'docs/unseen.csv'), 'utf8'));
  const only = value('only')?.split(',');
  const rows = all.filter((r) => !only || only.includes(r.id));
  const existing = flag('resume') ? loadExisting() : [];
  const done = new Map(existing.filter((r) => ['complete', 'failed', 'blocked', 'timed_out'].includes(r.status)).map((r) => [r.id, r]));
  const results = new Map<string, ResultRow>(done);

  const save = () => {
    const ordered = all.map((r) => results.get(r.id) ?? placeholder(r, 'not_run'));
    fs.writeFileSync(resultsFile, toCsv(ordered));
    return ordered;
  };

  const quota = (await getJson<QuotaSnapshot>(`${base}/api/quota`).catch(() => ({ json: { known: false } as QuotaSnapshot }))).json;
  const blocker = creditsBlocker(quota);
  if (blocker) {
    for (const r of rows) if (!results.has(r.id)) results.set(r.id, placeholder(r, 'not_run (credits)', blocker));
    save();
    boxed([
      'CREDITS ARE USED UP - the exit test was not started',
      '',
      blocker,
      'Credits renew daily. Run `pnpm exam --resume` after the reset.',
      'Prepared examples can still be opened in the studio meanwhile.',
    ]);
    process.exit(2);
  }

  console.log(`Running ${rows.length} URLs against ${base} (budgets: ${JSON.stringify(BUDGETS)} seconds)`);
  for (const row of rows) {
    if (results.has(row.id)) {
      console.log(`${row.id} already done (${results.get(row.id)?.status}); skipping`);
      continue;
    }
    console.log(`${row.id} ${row.url}`);
    const r = await runOne(row);
    results.set(row.id, r);
    save();
    console.log(`  -> ${r.status} ${r.budgetsMet} ${r.note ? `(${r.note})` : ''}`);
    if (r.errorCode === 'QuotaError') {
      for (const rest of rows) if (!results.has(rest.id)) results.set(rest.id, placeholder(rest, 'not_run (credits)', 'Stopped when credits ran out.'));
      save();
      boxed(['CREDITS RAN OUT DURING THE RUN', '', r.note, 'The URLs that finished are saved. Run `pnpm exam --resume` after the reset.']);
      process.exit(2);
    }
  }
  const ordered = save();
  const s = summarise(ordered);
  boxed([
    `Completed end to end: ${s.completed} of ${s.total} (target: 9 of 10)`,
    `Exit criterion: ${s.passes ? 'MET' : s.notRun ? 'NOT YET DEMONSTRATED' : 'NOT MET'}`,
    `Results: docs/unseen-results.csv`,
  ]);
  process.exit(s.passes ? 0 : 1);
}

function placeholder(r: { id: string; url: string }, status: string, note = ''): ResultRow {
  return {
    id: r.id,
    url: r.url,
    status,
    errorCode: status.startsWith('not_run') ? 'QuotaError' : '',
    reproducedS: '',
    scoresS: '',
    firstSectionS: '',
    completeS: '',
    budgetsMet: '',
    ppiBefore: '',
    ppiAfter: '',
    ppiAfterWithoutSample: '',
    costInr: '',
    note,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
