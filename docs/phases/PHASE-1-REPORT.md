# Phase 1 Report: Capture and Reproduction

- **Date**: 2026-11-20 (updated after the static-copy fallback)
- **Exit criterion (spec 10)**: at least 90% of the corpus reproduces with no visible difference from the live page; the variant selector and image gallery still work.
- **Result**: **NOT MET.** 14 of 18 expected-OK URLs (77.8%) reproduce within the 2% pixel threshold; **11 of 18 (61.1%) do so with the interactive copy** (gallery and variants working). The other 3 pass only with the static copy (scripts removed), which cannot show the gallery or variants. The threshold was not lowered.

## Method
Each URL is captured, then the stored snapshot is reloaded offline in a fresh browser (uncaptured images, fonts and styles may load; scripts may not) and pixel-diffed (pixelmatch, per-pixel threshold 0.1) against the live screenshot from the same capture session. If the interactive copy misses 2%, the static copy is measured too and the better one is reported. A light interaction check clicks a gallery thumbnail and selects a variant and fails on new script errors. Run with `pnpm corpus`; raw rows are in `docs/corpus-results.csv`; causes are in `docs/failures.md`.

## Results

| id | status | platform | interactive diff % | static diff % | best | capture s | pass |
|---|---|---|---|---|---|---|---|
| c01 | ok | shopify | 1.04 | - | interactive | 22.7 | yes |
| c02 | ok | shopify | 0.11 | - | interactive | 26.1 | yes |
| c03 | ok | shopify | 0.17 | - | interactive | 14.8 | yes |
| c04 | ok | shopify | 0.88 | - | interactive | 27.5 | yes |
| c05 | ok | shopify | 2.91 | 0.01 | static | 17.5 | yes |
| c06 | ok | shopify | 3.06 | 0.03 | static | 22.2 | yes |
| c07 | ok | shopify | 0.17 | - | interactive | 17.0 | yes |
| c08 | ok | shopify | 0.17 | - | interactive | 16.8 | yes |
| c09 | ok | shopify | 0.05 | - | interactive | 17.5 | yes |
| c10 | ok | shopify | 2.19 | 1.43 | static | 27.3 | yes |
| c11 | ok | shopify | 0.29 | - | interactive | 17.0 | yes |
| c12 | ok | shopify | 0.87 | - | interactive | 27.8 | yes |
| c13 | ok | shopify | 0.04 | - | interactive | 15.4 | yes |
| c14 | ok | shopify | 11.18 | 3.69 | static | 23.4 | no |
| c15 | ok | shopify | 0.37 | - | interactive | 10.4 | yes |
| c16 | ok | custom | 9.37 | 8.42 | static | 72.1 | no |
| c17 | blocked | - | - | - | - | 0.8 | no |
| c18 | ok | custom | 2.94 | 2.94 | interactive | 17.1 | no |
| c19 | ok | custom | 0 | - | interactive | 3.8 | no |
| c20 | ok | custom | 2.02 | 2.02 | interactive | 16.7 | no |

Captured within 20 s: 9 of 18.

## Why the remaining rows fail

- **Layout built by scripts (c16 woodenstreet, c14 sleepycat):** the gallery and thumbnail strip are laid out differently after the store scripts run again on the saved DOM. The static copy also differs on these (8.4% and 3.7%).
- **Slow page (c17 bata.com):** did not finish loading within 45 s, even without images; reported as blocked.
- **Animated or state-driven content (c18, c20):** a few percent of pixels differ in both copies.
- **c19 (amazon.com):** the page is a "continue shopping" interstitial. The block detector now recognises that pattern; the stored result for this row predates the fix and should be rerun.

## What changed since the first run

- Overlay neutraliser hides pop-ups and backdrops before the snapshot (sampled pages went from 11 to 20% down to under 1%).
- Spec-conformant srcset parser (URLs containing commas broke every image on one store).
- A static copy is stored next to the interactive one and the preview can serve it (`?static=1`); the studio has a toggle. This lifted three rows over the threshold, at the cost of interactivity.
- Soft-block detection for short interstitials. The Amazon.in row was relabelled as an ordinary page.

## Gaps against the specification

- **Corpus size and mix:** 20 URLs, not 50: 15 Shopify, 3 custom, 2 marketplaces. No reachable WooCommerce or Magento store could be found, so those platforms are only unit-tested.
- **Capture time:** heavy stores take 20 to 30 s, especially with two captures in parallel.
- **Interaction check:** a light proxy for the variant and gallery requirement, not a full test of every theme.
