# Corpus failures, grouped by cause

Generated from `docs/corpus-results.csv` (run `pnpm corpus`). Passing rows are omitted.

## Visible difference after reproduction (state loaded by the store's own scripts, animation, or layout built by scripts)

| id | url | status | interactive diff % | static diff % | note |
|---|---|---|---|---|---|
| c14 | https://www.sleepycat.in/products/carbon-mattress | ok | 11.18 | 3.69 | - |
| c16 | https://www.woodenstreet.com/product/walken-bed-with-storage-honey-fin | ok | 9.37 | 8.42 | - |
| c18 | https://www.buywow.in/brands/wow-skin-science/products/eau-de-parfum-l | ok | 2.94 | 2.94 | - |
| c20 | https://www.amazon.in/dp/B09G9HD6PD | ok | 2.02 | 2.02 | - |

## The page could not be loaded or was blocked

| id | url | status | interactive diff % | static diff % | note |
|---|---|---|---|---|---|
| c17 | https://www.bata.com/in/bata-black-oxford-formal-shoes-for-men-500_202 | blocked | - | - | The page took too long to load, even without images. |

## Interaction check failed

| id | url | status | interactive diff % | static diff % | note |
|---|---|---|---|---|---|
| c19 | https://www.amazon.com/dp/B08N5WRWNW | ok | 0 | - | - |

## Proposed fixes

- Pages whose own scripts rebuild the layout (c16 woodenstreet, c14 sleepycat): wait for the store scripts to settle before taking the live screenshot, and compare after a fixed settle time on both sides.
- Slow pages (c17 bata): allow a longer render budget for the first load, or capture with a network-idle wait that ignores long-polling.
- Animated hero images (c18, c20): freeze animations in both screenshots at the same moment.
- Marketplaces (c19): expected to be blocked; the HTML-paste fallback is the supported path.
