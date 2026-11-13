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
- **Dark mode.** Follows the system setting by default; pick System / Light / Dark in the ⚙ settings
  menu, and the choice is remembered.
- **Flexible scene sidebar.** Drag its edge to resize (double-click to reset), hide it with the button in
  its header (a small button brings it back) or Ctrl+\\. On screens too narrow for the sidebar and a full page, it becomes a drawer over the page.
- **Zoom.** Fit width (the page fills the writing area, edge to edge) or 75–200%, from the status bar. Line and page breaks
  never change, only the size.
- **Focus mode.** Ctrl+Shift+F (⌘⇧F) hides everything but the page; Esc returns (double Esc with Vim on).
- **Built-in help.** The ? menu (or F1 / Ctrl+/) explains everything; every control has a tooltip.
- **Backup reminders.** localStorage is easy to lose, so after you add a page or write for 30 active
  minutes, a card nudges you to download a Fountain backup (can be turned off in ⚙ Settings). Ctrl/⌘+S downloads one any time.

## Keyboard

| Key | Action |
| --- | --- |
| Enter | New element: Scene → Action, Character → Dialogue, Dialogue → Character, Transition → Scene… |
| Enter on an empty element | Turns it into Action |
| Tab | Action ⇄ Character, Dialogue ⇄ Parenthetical |
| Shift+Tab | Cycle element type backwards |
| Ctrl+Alt+1…7 (⌘⌥ on Mac) | Scene, Action, Character, Parenthetical, Dialogue, Transition, Shot |
| Ctrl+S / ⌘S | Download a Fountain backup |
| Ctrl+\\ / ⌘\\ | Show or hide the scenes sidebar |
| Ctrl+Shift+F / ⌘⇧F | Focus mode (Esc to leave; double Esc with Vim on) |
| `(` in empty dialogue | Starts a parenthetical; `)` at its end returns to dialogue |

Typing `INT.` / `EXT.` in an action line makes it a scene heading; `CUT TO:` makes a transition.

## Vim mode

Optional; turn on **Vim keybindings** in the ⚙ settings menu (remembered per browser). Each screenplay element is a
"line", so `j`/`k`, `dd`, `yy`/`p` work on whole elements and keep their types.

- Modes: normal, insert, visual (`v`), visual-line (`V`); mode and pending keys show in the status bar
- Motions: `h j k l w b e W B E 0 ^ $ gg G f F t T ; ,` with counts; `[[` / `]]` jump between scenes
- Screen rows (wrapped lines): `gj gk`, `gh gl` (row start/end, Helix-style) and `g0 g^ g$`;
  `H M L` for the top, middle and bottom visible rows
- Operators `d c y` with motions, `dd cc yy`, text objects `iw aw i" a" i' a' i( a( i[ a[ i{ a{`
- `x X s S D C Y p P J r ~ u Ctrl-r . o O i a I A`, `Ctrl-d Ctrl-u zz`
- `o` opens the next element in screenplay order (on a character name it opens dialogue)
- Search: `/` `?` with incremental highlighting, `n N * #`, `:noh`. Smartcase (case-insensitive
  unless the pattern has a capital); patterns are JS regexes, with `\<` `\>` as word boundaries
- `:w` downloads a Fountain backup
- Tab and Ctrl+Alt+1…7 still change the element type in any mode

Not supported: named registers, macros, marks, `:s` substitution, `d/pattern`, and most ex commands.

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
