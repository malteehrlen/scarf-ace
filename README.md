# Scarf Ace

A free, browser-based screenplay editor. No account, no server — scripts live in your browser.

- **Formatting you can't get wrong.** You choose an element type (Scene Heading, Action, Character,
  Parenthetical, Dialogue, Transition, Shot); margins, capitalization and spacing follow industry
  standard automatically.
- **Real pagination.** 54 lines per page in 12pt Courier, with scene headings never orphaned, action
  split only with ≥2 lines per page, and dialogue split with `(MORE)` / `(CONT'D)`. Page breaks are
  shown live in the editor and match the PDF.
- **PDF export** with an optional title page, using the embedded Courier Prime font. Exporting
  first shows options: scene numbers (for shooting scripts) and automatic (CONT'D).
- **Fountain import/export** for interoperability with Trelby, Highland, Fade In, etc., without losing
  anything: notes `[[…]]` (boneyard `/* */` becomes notes), sections `#`, synopses `=`, forced page
  breaks `===`, centered text `> <`, dual dialogue `^` and scene numbers `#12A#` all round-trip.
  Copy/paste also speaks Fountain.
- **Final Draft (.fdx) import and export.** Anything that doesn't map one-to-one (sections, synopses,
  notes, act breaks, General paragraphs, scene numbers, the free-form title page) is listed in a
  dialog where you choose what happens to it; defaults keep content.
- **Bold, italic, underline** (Ctrl/⌘+B / I / U), stored as Fountain emphasis and printed in the PDF.
- **Autocomplete** for character names and extensions, scene headings (INT./EXT., known locations,
  times of day) and transitions. In action and dialogue, character names complete inline: type `Ma`
  and press Tab for `Maya` (or `MA` → `MAYA` for a first appearance).
- **Dual dialogue** side by side, on screen and in the PDF.
- **Automatic (CONT'D)** when a character speaks again after action in the same scene (setting).
- **Find & replace** (Ctrl/⌘+F, Ctrl+H / ⌘⌥F) that keeps capitalization: renaming Maya → Mia also
  turns the cue `MAYA` into `MIA`. Replace all is one undo.
- **Script report:** pages, estimated runtime, scene lengths in eighths of a page, and per-character
  speeches, words and scenes.
- **Autosave** to localStorage, with multiple scripts. If the same script is open in two tabs, the
  other tab pauses saving and asks which version to keep instead of silently overwriting.
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
| Ctrl+B / I / U (⌘ on Mac) | Bold / italic / underline |
| Ctrl+F / ⌘F, Ctrl+H / ⌘⌥F | Find, find & replace |
| Ctrl+S / ⌘S | Download a Fountain backup |
| Ctrl+\\ / ⌘\\ | Show or hide the scenes sidebar |
| Ctrl+Shift+F / ⌘⇧F | Focus mode (Esc to leave; double Esc with Vim on) |
| `(` in empty dialogue | Starts a parenthetical; `)` at its end returns to dialogue |

Typing `INT.` / `EXT.` in an action line makes it a scene heading; `CUT TO:` makes a transition.
Fountain shortcuts work too: `===` (page break), `# ` (section), `= ` (synopsis), `> text <`
(centered), and `^` after a character name (dual dialogue).

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
  unless the pattern has a capital; `\c` / `\C` force it either way, and `*` `#` always ignore case);
  patterns are JS regexes, with `\<` `\>` as word boundaries
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

## Deployment

The app is static files only. `.github/workflows/deploy.yml` tests, builds and publishes it to
GitHub Pages on every push to `main` (one-time setup: repository Settings → Pages → Source:
"GitHub Actions"). The build uses relative paths (`base: './'` in `vite.config.ts`), so it works at
`https://<user>.github.io/<repo>/` or on a custom domain without changes.

Scripts live in the browser's localStorage for the site's origin. Moving the app to another address
(e.g. adding a custom domain later) starts with an empty library there, so users would need to
re-import their Fountain backups.

## Privacy

Scarf Ace collects no data: no analytics, no cookies, no third-party requests. Scripts and settings stay
in the browser's localStorage and are never sent anywhere. The hosted version runs on GitHub Pages,
which logs visitors' IP addresses for security
([GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement)).
Feedback and bug reports: [GitHub issues](https://github.com/malteehrlen/scarf-ace/issues).

## License

[MIT](LICENSE) © 2026 Malte Ehrlen.

The Courier Prime font in `public/fonts` is © The Courier Prime Project Authors, licensed under the
SIL Open Font License ([`public/fonts/OFL.txt`](public/fonts/OFL.txt)).

Third-party libraries keep their own licenses (all permissive: MIT, plus Apache-2.0 for DOMPurify and
MIT/Zlib for pako). Every build writes `third-party-licenses.txt` with the license text of each
package in the bundle; the deployed app links to it from Help › About.

Final Draft is a trademark of its owner; Scarf Ace is not affiliated with or endorsed by it and only
reads and writes the `.fdx` file format for compatibility.
