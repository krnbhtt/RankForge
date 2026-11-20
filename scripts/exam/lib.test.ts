import { describe, expect, it } from 'vitest';
import { BUDGETS, budgetReport, creditsBlocker, csvCell, parseUnseenCsv, secondsBetween, summarise, toCsv, type ResultRow } from './lib.ts';

describe('exam helpers', () => {
  it('parses the unseen URL list', () => {
    const rows = parseUnseenCsv('id,url,category,note\nu01,https://a.example.org/products/x,apparel,n\nu02,https://b.example.org/p,,n\n');
    expect(rows).toEqual([
      { id: 'u01', url: 'https://a.example.org/products/x', category: 'apparel' },
      { id: 'u02', url: 'https://b.example.org/p', category: 'general' },
    ]);
  });

  it('checks the four performance budgets from the specification', () => {
    expect(BUDGETS).toEqual({ reproducedS: 20, scoresS: 90, firstSectionS: 120, completeS: 240 });
    expect(budgetReport({ reproducedS: 15, scoresS: 80, firstSectionS: 100, completeS: 200 }).allMet).toBe(true);
    const r = budgetReport({ reproducedS: 28, scoresS: 137, firstSectionS: null, completeS: 270 });
    expect(r.allMet).toBe(false);
    expect(r.missed).toEqual(['reproducedS', 'scoresS', 'firstSectionS', 'completeS']);
  });

  it('computes seconds between timestamps and tolerates gaps', () => {
    expect(secondsBetween('2026-11-20T10:00:00.000Z', '2026-11-20T10:00:12.500Z')).toBe(12.5);
    expect(secondsBetween(undefined, '2026-11-20T10:00:12.500Z')).toBeNull();
    expect(secondsBetween('2026-11-20T10:00:12.500Z', '2026-11-20T10:00:00.000Z')).toBeNull();
  });

  it('explains why credits block a run, and stays quiet when they are fine or unknown', () => {
    expect(creditsBlocker({ known: false })).toBeNull();
    expect(creditsBlocker({ known: true, serpOk: true, aiOk: true, aiConfigured: true })).toBeNull();
    expect(creditsBlocker({ known: true, serpOk: false, aiOk: true, aiConfigured: true })).toMatch(/search credits/);
    expect(creditsBlocker({ known: true, serpOk: true, aiOk: false, aiConfigured: true })).toMatch(/AI models/);
    expect(creditsBlocker({ known: true, aiConfigured: false })).toMatch(/not configured/);
  });

  it('writes CSV with quoting and summarises the 9 of 10 criterion', () => {
    expect(csvCell('a,b "c"')).toBe('"a,b ""c"""');
    const mk = (id: string, status: string): ResultRow => ({ id, url: `https://x/${id}`, status, errorCode: '', reproducedS: '', scoresS: '', firstSectionS: '', completeS: '', budgetsMet: '', ppiBefore: '', ppiAfter: '', ppiAfterWithoutSample: '', costInr: '', note: 'a,b' });
    const rows = [...Array.from({ length: 9 }, (_, i) => mk(`u${i}`, 'complete')), mk('u9', 'failed')];
    expect(summarise(rows)).toMatchObject({ completed: 9, total: 10, passes: true });
    expect(summarise([...rows.slice(0, 8), mk('a', 'not_run (credits)'), mk('b', 'not_run (credits)')])).toMatchObject({ completed: 8, notRun: 2, passes: false });
    expect(toCsv(rows).split('\n')[0]).toContain('budgetsMet');
    expect(toCsv(rows)).toContain('"a,b"');
  });
});
