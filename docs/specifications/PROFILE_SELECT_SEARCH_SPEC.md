# Saved-connection selector — search inside the dropdown

> **Scope**: `src/ui-kit/components/ProfileSelect.tsx` (shared by DbConnectionForm — shapefile, CSV,
> db-db and viewer tools — and by the address-dedup and coverage-loads connection forms).
> **Status**: Spec v1.

## 1. Goal

The list of saved connection profiles can be long and hard to scan. The open dropdown gets a search
field that filters the list as the user types, so the right profile is found without scrolling.

## 2. Decisions

1. The search field lives INSIDE the open dropdown (top, always visible while the list scrolls),
   autofocused on open. The trigger button stays a button (no editable text in the trigger).
2. Reuse the ui-kit `SearchInput`; extend it only with optional props (e.g. `autoFocus`,
   `onKeyDown`, `ariaLabel`) so its look and behaviour for existing users do not change.
3. Matching: case-insensitive and diacritic-insensitive (`conexion` finds `Conexión`), substring on
   the profile name, whitespace trimmed. The matching logic is a pure function in `src/core/`
   (headless, unit-tested), not inline in the component.
4. "Nueva conexión (ingresar datos vacíos)..." is always shown (pinned above the results), never
   filtered out.
5. Keyboard: typing filters; ArrowDown/ArrowUp move a visible highlight through the visible options
   (including "Nueva conexión"); Enter selects the highlighted option; with nothing highlighted it
   does nothing; opening starts with nothing highlighted; typing a query with matches highlights the first match; Escape closes and returns focus to the trigger.
6. Closing the dropdown (select, Escape, click outside) clears the query; reopening starts empty.
7. No result: the list shows a Spanish empty message ("Sin resultados para «<query>»"); "Nueva
   conexión" stays visible.
8. No API change for ProfileSelect (`profiles`, `activeProfileId`, `onSelectProfile`), so no caller
   changes. No change to profile storage.
9. UI rules: CSS modules, no inline styles, Lucide icons only, Spanish text, accessible
   (`role="listbox"`/`option`, `aria-activedescendant` or equivalent for the highlight, labelled
   search input).

## 3. Out of scope

Editing/renaming/deleting profiles from the dropdown, grouping/sorting profiles, fuzzy matching,
searching other fields (host, database), changing where profiles are stored.

## 4. Acceptance criteria

- **AC-1** Opening the dropdown shows a search field, focused, above the options.
- **AC-2** Typing filters profiles by name, case- and diacritic-insensitively; surrounding
  whitespace ignored; empty query shows all profiles.
- **AC-3** "Nueva conexión" is always visible regardless of the query.
- **AC-4** With no match, the empty message is shown and "Nueva conexión" remains.
- **AC-5** ArrowDown/ArrowUp move the highlight across visible options; Enter selects the
  highlighted option (nothing highlighted: does nothing; opening starts with nothing highlighted; typing a query with matches highlights the first match); Escape closes the dropdown.
- **AC-6** Closing the dropdown by any means clears the query; selecting an option calls
  `onSelectProfile` exactly as before (empty string for "Nueva conexión").
- **AC-7** The matching function is pure, lives in `src/core/`, and is unit-tested (accents, case,
  whitespace, no match, empty query, order preserved).
- **AC-8** Existing consumers (DbConnectionForm, DedupConnectionForm, CoverageConnectionForm) work
  unchanged; `SearchInput` renders identically for its existing users.
- **AC-9** Gauntlet green: `modules:routes:check`, `lint`, `test`, `build`, `doctor` (zero
  findings), `fallow` (zero findings).
