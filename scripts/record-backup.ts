/**
 * Records a full run of the studio to docs/demo/backup-run.webm (the offline backup for demo day).
 * Uses a page and keyword whose search results are cached, so it works when search credits are used up.
 *
 * Usage: pnpm record:backup [--url http://localhost:3000] [--page <product url>] [--keyword "matte lipstick"]
 * The default page gets a throwaway query string so it is not served from the 24-hour audit cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const base = (value('url') ?? 'http://localhost:3000').replace(/\/$/, '');
const page = value('page') ?? `https://www.sugarcosmetics.com/products/set-of-2-matte-attack-transferproof-lipstick-4?ref=backup-${Date.now()}`;
const keyword = value('keyword') ?? 'matte lipstick';
const outDir = path.resolve(__dirname, '..', 'docs', 'demo');
const MAX_WAIT_MS = 12 * 60_000;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = path.join(outDir, '.recording');
  fs.rmSync(tmp, { recursive: true, force: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, recordVideo: { dir: tmp, size: { width: 1440, height: 810 } } });
  const p = await context.newPage();
  const pause = (ms: number) => p.waitForTimeout(ms);

  await p.goto(base, { waitUntil: 'load', timeout: 60_000 });
  await pause(2500);
  await p.fill('#product-url', page);
  await pause(800);
  await p.fill('#target-keyword', keyword);
  await pause(1200);
  await p.getByRole('button', { name: /Audit & Rebuild Page/i }).click();
  await p.waitForURL(/\/studio\//, { timeout: 60_000 });

  const started = Date.now();
  let tab = 0;
  const tabs = ['Competitors', 'Findings', 'Plan'];
  while (Date.now() - started < MAX_WAIT_MS) {
    const done = await p.getByText('COMPLETE', { exact: true }).first().isVisible().catch(() => false);
    const failed = await p.getByText(/FAILED|BLOCKED/).first().isVisible().catch(() => false);
    if (done || failed) break;
    // Show a different panel every 25 seconds while the run progresses.
    if (Math.floor((Date.now() - started) / 25_000) > tab && tab < tabs.length) {
      await p.getByRole('button', { name: tabs[tab], exact: true }).first().click().catch(() => undefined);
      tab++;
    }
    await pause(2000);
  }
  await pause(3000);
  for (const name of ['Summary', 'Plan', 'Scores', 'Findings', 'Queries', 'Schema', 'Category']) {
    await p.getByRole('button', { name, exact: true }).first().click().catch(() => undefined);
    await pause(2500);
  }
  await p.getByRole('button', { name: 'Summary', exact: true }).first().click().catch(() => undefined);
  await pause(2500);

  const video = p.video();
  await context.close();
  await browser.close();
  const file = await video?.path();
  if (!file) throw new Error('No video was recorded');
  const target = path.join(outDir, 'backup-run.webm');
  fs.copyFileSync(file, target);
  fs.rmSync(tmp, { recursive: true, force: true });
  const mb = (fs.statSync(target).size / 1_048_576).toFixed(1);
  console.log(`Saved ${target} (${mb} MB, ${Math.round((Date.now() - started) / 1000)} s of run time)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
