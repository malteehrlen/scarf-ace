# Scarf Ace

A free, browser-based screenplay editor. No account, no server — scripts live in your browser.

- **Formatting you can't get wrong.** You choose an element type (Scene Heading, Action, Character,
  Parenthetical, Dialogue, Transition, Shot); margins, capitalization and spacing follow industry
  standard automatically.
- **Real pagination.** 54 lines per page in 12pt Courier, with scene headings never orphaned, action
  split only with ≥2 lines per page, and dialogue split with `(MORE)` / `(CONT'D)`. Page breaks are
  shown live in the editor and match the PDF.
- **PDF export** with an optional title page, using the embedded Courier Prime font.
- **Fountain import/export** for interoperability with Trelby, Highland, Fade In, etc. Copy/paste
  also speaks Fountain.
- **Autosave** to localStorage, with multiple scripts.

## Keyboard

| Key | Action |
| --- | --- |
| Enter | New element: Scene → Action, Character → Dialogue, Dialogue → Character, Transition → Scene… |
| Enter on an empty element | Turns it into Action |
| Tab | Action ⇄ Character, Dialogue ⇄ Parenthetical |
| Shift+Tab | Cycle element type backwards |
| Ctrl+Alt+1…7 (⌘⌥ on Mac) | Scene, Action, Character, Parenthetical, Dialogue, Transition, Shot |
| `(` in empty dialogue | Starts a parenthetical; `)` at its end returns to dialogue |

Typing `INT.` / `EXT.` in an action line makes it a scene heading; `CUT TO:` makes a transition.

## Development

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # vitest: pagination, Fountain, editor commands
npm run build
```

Stack: Vue 3 + Vite + TypeScript, ProseMirror for editing, jsPDF for PDF.

## Fonts

Courier Prime (`public/fonts`) is © Quote-Unquote Apps, licensed under the SIL Open Font License
(`public/fonts/OFL.txt`).
