# Scarf Ace — project notes

Browser screenplay editor (Vue 3 + Vite + TS, ProseMirror, jsPDF). See README for features.

## Architecture
- `src/lib/screenplay.ts` — element types, `LAYOUT` (indent/width in Courier chars, 1 char = 0.1in),
  Enter/Tab transition tables, word wrap. **Single source of truth for formatting.**
- `src/lib/paginate.ts` — turns elements into pages of rows. Used by both the PDF and the live
  page-break markers in the editor. Blocks carry legal break points + (MORE)/(CONT'D) adornments.
- `src/lib/editor.ts` — ProseMirror schema (flat list of `element` nodes with a `type` attr),
  commands, smart typing, page-break/orphan decorations, Fountain clipboard.
- `src/lib/outline.ts` — scene tree model for the sidebar (`SceneTree.vue`); dialogue nests under its cue.
- `src/lib/vim.ts` — optional Vim mode as a ProseMirror plugin. Works on a linear text model
  (elements joined by '\n'); tests drive it via `vimFeed()` without a DOM.
- `src/components/MenuButton.vue` — accessible dropdown menu (keyboard nav, focus return); File and
  ⚙ Settings menus are built on it. Items are `.menu-item` elements with menu roles.
- Tooltips: give every interactive element `data-tip="…"` (optional `data-tip-kbd`, `data-tip-side`),
  rendered by `AppTooltip.vue`. Don't use `title` attributes.
- `src/lib/about.ts` — app name/version, `CREATOR_EMAIL` and `FEEDBACK_URL` (TODO: set once the GitHub repo is public).
- `src/lib/markup.ts` — inline Fountain markup in element text: emphasis (shown as ProseMirror marks,
  serialized back to `**`/`*`/`_`), `[[notes]]` and `#scene numbers#` (kept as text, decorated, never
  printed). `printable()` in `screenplay.ts` turns an element into what prints (plus style spans).
- `src/lib/fdx.ts` — Final Draft XML. `fdxExportIssues`/`fdxImportIssues` report what doesn't map
  one-to-one; `FdxDialog.vue` asks only about those (never assume: the writer chooses, defaults keep
  content). Import parsing uses `DOMParser`, so its tests run with `// @vitest-environment jsdom`.
  We don't write Final Draft ScriptNotes (format unverified); notes export as `[[…]]` text.
- `src/lib/find.ts`, `src/lib/autocomplete.ts` + `completion.ts` (popup plugin), `src/lib/report.ts`.
- Performance: pagination runs on every keystroke. `printable()` and per-element row layout are
  memoized by content, and `elementsFromDoc` caches by node identity; keep new per-keystroke work
  incremental too. Benchmark: ~2000 elements / 105 pages, keystrokes should stay ≈1 frame.
- `src/lib/backup.ts` — when to remind about Fountain backups (state lives on `Script.backup`).
- `src/lib/fountain.ts`, `src/lib/pdf.ts` (lazy-loaded), `src/lib/storage.ts` (localStorage).
- `src/style.css` editor element CSS must stay in sync with `LAYOUT`. Column indents/widths are in
  `ch`, not inches: browsers may round Courier's 9.6px advance to 10px (Linux), and only `ch` keeps
  the editor's line breaks identical to the PDF at every zoom.
- `wrap()` in `screenplay.ts` mirrors the browser's break opportunities (spaces, after hyphens inside
  words, after em dashes). If you change either side, re-check editor vs. paginator line breaks in a
  real browser with long, punctuation-heavy lines; unit tests alone can't catch a mismatch.
- `src/lib/zoom.ts` — page zoom (CSS `zoom` on `.paper`): fixed levels or "fit" to the writing area.
- All colors are theme tokens at the top of `src/style.css` (light + `[data-theme='dark']`). Don't
  hardcode colors in rules; derive tints with `color-mix` from a token. Theme logic: `src/lib/theme.ts`,
  mirrored by the inline script in `index.html` (keep them in sync).

## Conventions
- Element text is stored as typed: no forced caps, parentheticals without parens (case/parens are
  applied at display/export time), plus Fountain inline markup (emphasis, notes, scene numbers).
- Outline elements (`section`, `synopsis`) and `pagebreak` never print; `printable()` returns ''.
- Empty elements are ignored by pagination/export.

## Testing
- `npm test` (vitest) for pure logic. `npx vue-tsc --noEmit` for types.
- When driving the editor with Playwright, wait ~50ms after a click before pressing keys:
  ProseMirror syncs DOM selection changes on a deferred flush, so instant keypresses use the
  previous selection.
  Playwright's fake clock (`page.clock.install()`) also freezes that flush, so don't mix the fake
  clock with click-then-type sequences.
