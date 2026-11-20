# Phases 6 and 7 Report: Studio and Hardening

- **Date**: 2026-11-20
- **Phase 6 exit criterion**: a newcomer explains both failures after one run. **Not tested with a person.**
- **Phase 7 exit criterion**: 9 of 10 unseen URLs complete end to end. **Not run.** Only one store page has been taken through the full pipeline live, because the supplied SERP credits ran out.

## Phase 6: studio

Built and checked in a real browser:

- Live progress timeline; reproduction on the left and optimised page on the right in sandboxed iframes, synchronised scroll, desktop and mobile toggle.
- The optimised preview reloads as each section lands. Numbered annotation tags on every added section with a pop-over showing Ranking, Conversion or Both, a Sample chip where content is illustrative, and the reason (toggle: Hide tags).
- Panels, all from real data: Scores (before and after, factor bars, Sample marker with the score without Sample content, regression warning), Findings (with evidence), Queries (the shopper question journey and whether each is answered), Competitors (with skipped sites shown as skipped), Schema (JSON-LD today and the data the rebuild adds, with copy), Category (tone and trust, taxonomy-validated category).
- Blocked pages show a recovery card with the HTML-paste form. A "Static copy" toggle shows the script-free reproduction. "Copy preview link" copies the noindex preview URL.
- All Phase 0 hard-coded demo content has been removed from the studio.

Not built or not verified:

- **Workspace screen and Google sign-in (F8.1, Could)** are not built.
- **Blueprint outline** is not shown (see Phase 4 and 5 report).
- **Accessibility** was designed for (labels, roles, focus targets, `aria-pressed`, progress bars with values) but no automated or manual WCAG audit was run.
- Cosmetic: the "Elapsed" counter shows 00:00 for an audit opened after it finished, and the completion banner always says "Optimized storefront and before/after ready" even when the rebuilt page scored lower.

## Phase 7: hardening

Done:

| Item | Where |
|---|---|
| Rate limit (token bucket per client) and cap on concurrent audits | `apps/web/lib/rate-limit.ts`, tested |
| Reuse of a completed audit of the same page and keyword for 24 hours (`refresh: true` to skip) | `findRecentComplete` on both stores, `POST /api/audits` |
| SERP cache with a stale-result fallback when the SERP API is out of quota or down | `competitors/serp.ts`, tested |
| Per-audit spending cap (₹25 default, estimated from token counts) | `SpendTracker`, `COST_CAP_INR` |
| Fast failure with a clear message when the AI key is missing; `/healthz` reports configuration | `routes/tasks.ts`, `index.ts` |
| Retry and resume: `POST /api/audits/{id}/retry` continues from finished stages | `routes/tasks.ts`, `retry/route.ts` |
| Runtime config for the preview origin (no build-time variable) | `/api/config` |
| Bundled worker and preview that run with plain `node` | `scripts/bundle.mjs` (run and health-checked locally) |
| Dockerfiles for worker and preview, updated web Dockerfile, `cloudbuild.yaml` per spec 8.9 | repo root and `apps/*` |
| Failure analysis of the corpus grouped by cause | `docs/failures.md` |

Not done:

- **Nothing has been deployed.** No `gcloud` or `firebase` command that creates or changes cloud resources was run. The commands are in `cloudbuild.yaml` and `docs/RUNBOOK.md` for review.
- **The Docker images have never been built.** The Docker daemon on this machine hangs. The bundled worker and preview run under `node`, but the image layers, the Playwright base image tag (v1.65.1-noble) and the pnpm install inside Docker are unverified.
- **Warm instances, demo-day rehearsal, 10 unseen URLs, a backup screen recording and the deck update** were not done.
- **Cached showcase audits:** the cache makes a second request for the same page open instantly, but three prepared showcase audits have not been created for a production deployment.
- **Firebase Hosting, security rules deployment and anonymous auth** are not set up; `firestore.rules` exists and is not deployed or tested with the rules emulator.
- **Cloud Tasks** enqueueing is written but untested against a real queue; local development calls the worker directly.
- The SERP API trial credits and the free-tier Gemini quota (see `KNOWN_ISSUES.md`) mean the live run count so far is small.
