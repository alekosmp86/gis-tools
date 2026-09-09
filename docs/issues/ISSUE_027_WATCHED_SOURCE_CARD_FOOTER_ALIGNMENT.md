# Issue 027: Cartography Watcher cards had misaligned "Ver en el portal" buttons

## Problem Statement
In the Cartography Watcher dashboard (`/tools/m/cartography-watcher`), watched source cards displayed their bottom actions—such as the **"Ver en el portal"** anchor button and the optional **"Dejar de vigilar"** button—at uneven vertical heights across adjacent cards in the same grid row.

When comparing cards side-by-side:
- A card with a single-line title (e.g. *Ejes de vías de circulación*) and single-line metric value (*Sin novedades*) positioned its action row noticeably higher.
- Cards with multi-line wrapped titles (e.g. *Direcciones Geográficas del Uruguay*) or wrapped metric values (e.g. *3 archivos pendientes*) pushed their footers downward.

Because the action buttons floated immediately beneath the content of each individual card rather than anchoring to the bottom, the buttons formed an irregular, disjointed baseline across the row.

## Root Cause Analysis & Technical Details
The card grid `.sourceGrid` defines a standard CSS grid:

```css
.sourceGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 18px;
}
```

By default in CSS Grid, `align-items` is `stretch`, ensuring all grid items in a row expand to match the height of the tallest card in that row.

Each `.card` element is a column flex container:

```css
.card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border-radius: 16px;
}
```

Its children are ordered as:
1. `<header>` (title and status badge)
2. `<p className={styles.description}>`
3. `<dl className={styles.metrics}>`
4. Optional error message `<p className={styles.errorMessage}>`
5. `<footer>` (containing `.portalLink` and optional `.removeButton`)

Prior to this fix, `.footer` was styled as:

```css
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
```

Without an automatic margin on the main axis (`margin-top: auto`), the footer had no rule instructing it to absorb the surplus height created when the card stretched to match taller sibling cards in the row. As a result:
- The footer simply followed the preceding element (`.metrics`) at a fixed `gap: 14px`.
- Any excess vertical space accumulated at the bottom of the card below the footer, creating uneven button baselines.

## Implemented Solution
In a flex column container, applying `margin-top: auto` to a child element consumes all available remaining vertical space and pins the element to the bottom of the container.

Applying `margin-top: auto` to `.footer` causes the footer in each card to sit flush against the card's inner bottom padding (`20px`), establishing an identical vertical baseline for the **"Ver en el portal"** button across all cards in every grid row.

## Code Examples & Diff Snippets

```diff
 .footer {
   display: flex;
   align-items: center;
   justify-content: space-between;
   gap: 12px;
   flex-wrap: wrap;
+  margin-top: auto;
 }
```

## Verification & Testing

Layout behavior verified on `/tools/m/cartography-watcher` across varying card content lengths (single-line vs. multi-line titles and pending counts).

Automated quality gauntlet verified:
- `npm run modules:routes:check`: 6 route files verified up to date.
- `npm run lint`: 0 errors, 0 warnings.
- `npm test`: 28 files, 286 tests passed.
- `npm run build`: Clean Turbopack production build.
- `npm run doctor`: Score 100 / 100, no issues found.
