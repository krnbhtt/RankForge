# Phase 1 Report: Capture and Reproduction

- **Date**: 2026-11-20
- **Exit criterion (spec 10)**: at least 90% of the corpus reproduces with no visible difference from the live page; the variant selector and image gallery still work.
- **Result**: **NOT MET.** 12 of 18 expected-OK URLs reproduce within the 2% pixel threshold (66.7%). The threshold was not lowered.

## Method
Each URL is captured (`captureTarget`), then the stored snapshot is reloaded offline in a fresh browser (uncaptured images, fonts and styles may load; scripts may not) and pixel-diffed (pixelmatch, per-pixel threshold 0.1) against the live screenshot taken in the same capture session. A light interaction check clicks a gallery thumbnail and selects a variant and fails on new script errors. Run with `pnpm corpus`; raw rows are in `docs/corpus-results.csv`.

## Results

| id | status | platform | diff % | capture s | interaction | pass |
|---|---|---|---|---|---|---|
| c01 | ok | shopify | 1.07 | 22.4 | variant | yes |
| c02 | ok | shopify | 0.18 | 27.4 | gallery+variant | yes |
| c03 | ok | shopify | 0.24 | 22.9 | none-found | yes |
| c04 | ok | shopify | 1.37 | 24.1 | gallery+variant | yes |
| c05 | ok | shopify | 2.89 | 22.7 | gallery+variant | no |
| c06 | ok | shopify | 3.06 | 19.8 | gallery+variant | no |
| c07 | ok | shopify | 0.17 | 22.9 | gallery+variant | yes |
| c08 | ok | shopify | 0.18 | 23.2 | gallery+variant | yes |
| c09 | ok | shopify | 0.05 | 31.0 | gallery+variant | yes |
| c10 | ok | shopify | 1.97 | 25.9 | gallery+variant | yes |
| c11 | ok | shopify | 0.12 | 22.8 | gallery+variant | yes |
| c12 | ok | shopify | 0.87 | 30.5 | gallery+variant | yes |
| c13 | ok | shopify | 0.04 | 20.3 | none-found | yes |
| c14 | ok | shopify | 8.17 | 28.2 | gallery+variant | no |
| c15 | ok | shopify | 0.37 | 11.7 | gallery | yes |
| c16 | ok | custom | 14.12 | 17.2 | gallery | no |
| c17 | blocked | - | - | 4.3 | - | no |
| c18 | ok | custom | 2.72 | 11.7 | variant | no |
| c19 | blocked | - | - | 6.3 | - | yes |
| c20 | ok | custom | 2.02 | 27.2 | gallery+variant | no |

## Why the failing rows fail

- **Page state driven by the store's own API calls (c05, c06):** the live page asks a pincode service and shows its answer; the offline copy cannot, so one line of text differs. This is a content difference, not a rendering fault.
- **Animating hero images (c14, c18, c20):** a 1 to 2 px offset in a carousel or zoom animation produces a few percent of differing pixels on otherwise identical pages.
- **Layout built by JavaScript (c16):** gallery and thumbnail strip are laid out differently after the store scripts run again on the saved DOM (14%).
- **Slow page (c17):** bata.com did not finish loading within 45 s, even without images, and is reported as blocked.
- **Corpus label (c20):** amazon.in served a normal page, so it is not a blocked-path example; it also misses the threshold (2.02%).

## Fixes made because of this run

- Overlay neutraliser: pop-ups, cookie banners and their backdrops are hidden before the snapshot (took sampled pages from 11 to 20% down to under 1%).
- srcset parser rewritten to the HTML spec (URLs containing commas, such as Cloudflare image paths, broke every image on one store).
- Next.js extension alias, CSP-safe runner steps, repository-wide artifact directory.

## Gaps against the specification

- **Corpus size and mix:** 20 URLs, not 50: 15 Shopify, 3 custom, 2 marketplaces. No WooCommerce or Magento store could be found that was reachable without a bot wall, so those platforms are untested against live stores (detection is unit-tested only).
- **Capture time:** only some pages are visible within 20 s on this machine (see table); heavy stores take 20 to 30 s, especially with two captures in parallel.
- **Interaction check:** a light proxy for the variant and gallery requirement, not a full test of every theme.

## Next steps

- Offer a static-snapshot fallback (scripts removed) for pages whose reproduction diff exceeds the threshold.
- Move screenshots and the mobile render off the critical path to reduce capture time.
- Add real WooCommerce and Magento URLs once reachable stores are supplied.
