# Wiki de usuario final (`/wiki`)

> **Scope**: core (engine + pages + ui-kit renderer) + module manifest contract + home cards.
> **Status**: Spec v1. Feature only; NO real content yet (placeholder pages).

## 1. Goal

An in-app, read-only help section for end users (not developer docs). Today the only user is the
author; later the whole team. Content is added afterwards; this spec delivers the mechanism and an
"En construcción" placeholder page per tool.

## 2. Decisions

1. Read-only, Markdown files in the repo. Spanish only. Not editable in the app.
2. Module-owned pages: `src/modules/<id>/wiki/*.md`, registered via the module manifest
   (`wiki: { contentDir }`), so deleting a module removes its help. Core never imports modules; only
   `src/app/modules.registry.ts` may name a module.
3. Legacy tools (not modules; never migrate them) keep pages in core-owned `src/wiki/<tool>/`.
4. Rendering: `react-markdown` + `remark-gfm`, exact-pinned versions at least 2 weeks old, raw HTML
   NOT rendered. Renderer supports headings, lists, tables, images, callouts.
5. Routes: `/wiki` (index listing tools), `/wiki/<tool>` and `/wiki/<tool>/<page>`.
   Tool slug = the tool's route name: `db-shapefile-sync`, `db-db-sync`, `db-csv-sync`, `file-viewer`,
   `db-table-viewer`, `coverage-loads`, `address-dedup`, `cartography-watcher`.
6. Pages are server components reading `.md` with `fs`.
7. Page frontmatter: `title`, `order` (tiny parser, no new dependency).
8. UI rules: CSS modules, no inline styles, Lucide icons only, atomic UI components, text in Spanish.
9. Module manifest gets `wiki?: { contentDir: string }`, `contentDir` repo-relative (resolved against
   `process.cwd()`; the app always runs from the repo). The module registry exposes `wikiSources()`
   (`{ toolSlug: module id, title: module name, contentDir }`). Legacy sources are declared in the
   composition side (`src/app/wiki/`), titles/slugs from `src/data/toolsData.ts` (new explicit
   `wikiSlug` field on each legacy entry).
10. The engine reads files through an injectable file-system interface (tests use fakes / temp dirs).
11. Page slug = file name without `.md`; a tool's default page is its lowest `order` (ties: title).
    Duplicate tool slugs or duplicate page slugs within a tool fail loudly at index build.
12. Callouts use GitHub alert syntax (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`). Relative `.md` links
    between pages are rewritten to `/wiki/<tool>/<page>`; relative image paths are served by an asset
    route restricted to image extensions inside the tool's `contentDir` (path traversal rejected).
13. A shared ui-kit `HomeCardFrame` wraps every home card and renders the "?" link as a SIBLING of the
    card (anchors cannot nest); it is the only place that positions the "?".

## 3. Out of scope

Screenshot automation, search (index must allow adding it later), print/PDF, changelog, AGENTS.md /
CLAUDE.md "update the wiki" rule, real content.

## 4. Acceptance criteria

- **AC-1** Engine `src/core/wiki/` is headless: types, frontmatter parser (`title`, `order`), page
  index builder. No React, no module imports.
- **AC-2** Module manifest contract accepts `wiki: { contentDir }`; the registry aggregates module
  wiki sources; core resolves them without naming any module.
- **AC-3** Legacy tools' pages load from `src/wiki/<tool>/`.
- **AC-4** `/wiki` lists every tool with a wiki, linking to `/wiki/<tool>`; header shows a "Wiki"
  link to `/wiki`.
- **AC-5** `/wiki/<tool>/<page>` renders the page with sidebar (pages of that tool, ordered by
  `order` then title) and breadcrumbs; `/wiki/<tool>` shows the tool's first page.
- **AC-6** Unknown tool or page yields a 404.
- **AC-7** Renderer shows headings, lists, GFM tables, images and callouts; raw HTML is not rendered.
- **AC-8** Every one of the 8 tool cards on the home page shows a "?" icon linking to
  `/wiki/<tool slug>`. On every card (legacy `ToolCard`, a div with onClick, and the module cards, one
  big `<Link>`) the "?" is a SIBLING of the card, never inside it (anchors cannot nest, and a sibling
  needs no click propagation handling), positioned over the corner by `HomeCardFrame`.
- **AC-9** Each of the 8 tools has a placeholder page with title and an "En construcción" notice.
- **AC-10** A test fails the build if any page lacks a title, or any internal link or image does not
  resolve.
- **AC-11** Unit tests cover the parser (valid, missing, malformed frontmatter, ordering) and the
  index (module + legacy sources, duplicate slug handling).
- **AC-12** `docs/tools/WIKI.md` explains how to add a page and a tool's wiki.
- **AC-13** Boundaries preserved: `eslint.config.mjs` rules pass, `modules:routes:check` passes, no
  hand-edited generated routes.
- **AC-15** Image asset route serves only image extensions (png, jpg, jpeg, gif, webp, svg) from
  inside a registered tool's `contentDir`; unknown tool, non-image extension or any path escaping
  the directory (`..`, absolute, encoded) answers 404 and never reads the file.
- **AC-14** Gauntlet passes: `lint`, `test`, `build`, react-doctor zero findings, fallow only via the
  recorded baseline exception.

## 5. Phases

1. Engine (`src/core/wiki/`) + manifest contract.
2. Pages (`src/app/wiki/`) + ui-kit renderer + header link.
3. "?" icons on 5 legacy cards (`ToolCard.tsx`, `toolsData.ts`) and 3 module cards
   (`CoverageLoadsHomeCard`, `DedupHomeCard`, `WatcherHomeCard`).
4. Placeholder pages for the 8 tools + `docs/tools/WIKI.md`.
5. Tests (parser, index, link/image checker).

Each phase: implementer -> test-writer (separate run) -> fresh code-reviewer -> gauntlet.
