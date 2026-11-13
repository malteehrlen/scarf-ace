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
- `src/lib/about.ts` — app name/version/author and `FEEDBACK_URL` (TODO: set once the GitHub repo is public).
- `src/lib/backup.ts` — when to remind about Fountain backups (state lives on `Script.backup`).
- `src/lib/fountain.ts`, `src/lib/pdf.ts` (lazy-loaded), `src/lib/storage.ts` (localStorage).
- `src/style.css` editor element CSS must stay in sync with `LAYOUT`.
- All colors are theme tokens at the top of `src/style.css` (light + `[data-theme='dark']`). Don't
  hardcode colors in rules; derive tints with `color-mix` from a token. Theme logic: `src/lib/theme.ts`,
  mirrored by the inline script in `index.html` (keep them in sync).

## Conventions
- Element text is stored without formatting: no forced caps, parentheticals without parens.
  Case/parens are applied at display/export time.
- Empty elements are ignored by pagination/export.

## Testing
- `npm test` (vitest) for pure logic. `npx vue-tsc --noEmit` for types.
- When driving the editor with Playwright, wait ~50ms after a click before pressing keys:
  ProseMirror syncs DOM selection changes on a deferred flush, so instant keypresses use the
  previous selection.
  Playwright's fake clock (`page.clock.install()`) also freezes that flush, so don't mix the fake
  clock with click-then-type sequences.
