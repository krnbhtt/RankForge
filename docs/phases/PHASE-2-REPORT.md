# Phase 2 Report: Competitors

- **Date**: 2026-11-20
- **Exit criterion (spec 10)**: 7+ usable competitors per corpus URL within budget.
- **Result**: **Reached on 4 of the 5 URLs tried; not demonstrated across the corpus.** One URL ended with low competitor confidence (4 usable). One further run crashed on a file-system error before the competitor stage finished (fixed afterwards, not rerun). Only 5 of the 18 corpus URLs were tried, because Gemini quota on the supplied key limited live runs.

## What was built

| Spec item | Where | Notes |
|---|---|---|
| F3.1, F3.2 SERP, People Also Ask, related searches | `competitors/serp.ts` | SearchAPI.io Google engine. Google `/goto` redirect links are resolved with one manual hop. Widened with page 2 and the top two related searches when fewer than 20 domains are found. 401, 402, 429 map to typed errors. |
| F3.3 AI-cited sources | `competitors/grounding.ts` | Gemini Search Grounding with redirect resolution (SSRF-checked) and the Search entry point kept for display. **No quota on this key**, so it returns "unavailable" and the audit continues. Untested against live grounding. |
| F3.4 Parallel capture, skip and backfill | `competitors/capture.ts` | 5 sessions, 25 s budget each, ranks 1 to 10 first, backfill only while fewer than 7 usable. Lite capture mode (no snapshot, no mobile render). Cards are written to the store as each finishes. |
| F3.5, F3.6, F3.7 Structure, trust and image profile | `competitors/profile.ts` | Headings, schema types, trust elements (COD, UPI, returns, delivery, warranty and others), image types, CTA position. Deterministic. |
| Entities | `competitors/entities.ts` | Batched Gemini Flash calls (several pages per request to save quota). |
| F3.8 Consensus model | `competitors/consensus.ts` | Deterministic frequencies and shares; "low competitor confidence" below 5. |
| Keyword resolution | `competitors/keyword.ts` | Uses the supplied keyword, otherwise 3 to 5 candidates (prompted for broad 2 to 4 word terms), waits for the user, defaults to the top one. |
| Stage | `stages/competitors-stage.ts` | Writes competitors and queries to the store; consensus and profiles to storage. |

## Live results

| URL | Keyword (inferred) | Candidates | Usable | Skipped | Competitor stage |
|---|---|---|---|---|---|
| c07 Sugar lipstick | matte lipstick | 12 | 11 | 1 (could not be read) | 256 s* |
| c07 again, through the web app | matte lipstick (given) | 12 | 10 | blocked, too slow | 97 s |
| c05 boAt earphones | wired in-ear earphones | 10 | 8 | 2 blocked | 107 s |
| c14 Sleepycat mattress | memory foam mattress | 10 | 9 | 1 too slow | 57 s |
| c11 Chumbak tea set | floral tea set | 5 | 4 | 1 blocked | 218 s* |

\* These runs included slow model fallbacks while the Gemini quota was being exhausted.

Through the web app, the first competitor card appeared about 40 s after the audit started (budget 60 s) and the whole competitor stage finished at about 1 min 37 s.

## Findings

- **Keyword breadth decides the candidate pool.** A long-tail inferred keyword ("floral tea set") produced only 5 candidate domains and a low-confidence result; broad keywords produced 10 to 13. The keyword prompt was changed to ask for broad category terms and the SERP is widened with related searches.
- **Marketplaces and social pages are filtered or tried last.** The target's own domain, video and social sites are removed; marketplaces are kept as backfill because they usually block.
- **Blocked or slow sites are skipped and shown as skipped**, not hidden.

## Limits

- 5 of 18 corpus URLs tried; the "7+ per corpus URL" claim is not established for the rest.
- AI-cited sources (GEO view) could not run for lack of Search Grounding quota.
- Competitor capture time per site is higher than the 25 s budget on heavy pages, which then count as skipped.
- Entity names written by the model rarely match across competitors, so the consensus entity list is short (see Phase 3 report).
- A transient Windows file-lock error (EPERM on rename) stopped one run; the file store now retries.
