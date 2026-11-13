// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FDX_EXPORT,
  defaultImportOptions,
  fdxExportIssues,
  fdxImportIssues,
  fromFdx,
  looksLikeFdx,
  parseFdx,
  toFdx,
  type FdxImportOptions,
} from '../src/lib/fdx'
import { emptyTitlePage, type ScriptElement } from '../src/lib/screenplay'

const tp = { ...emptyTitlePage(), title: 'The Scarf', author: 'Jo Writer', contact: 'jo@example.com\n555-0100', draftDate: 'First Draft' }
const IMPORT_ALL: FdxImportOptions = { general: 'action', acts: 'section', notes: 'note', summaries: 'synopsis', sceneNumbers: 'keep', titlePage: 'guess' }
const roundTrip = (els: ScriptElement[], exp = DEFAULT_FDX_EXPORT, imp = IMPORT_ALL) => fromFdx(parseFdx(toFdx(els, tp, exp)), imp)

describe('Final Draft export → import', () => {
  it('round-trips everything that maps directly', () => {
    const els: ScriptElement[] = [
      { type: 'scene', text: 'INT. LAUNDROMAT - NIGHT #1A#' },
      { type: 'action', text: 'Rain. **Hard** rain, *very* _loud_ & <wet>.' },
      { type: 'character', text: 'MAYA' },
      { type: 'parenthetical', text: 'quietly' },
      { type: 'dialogue', text: "Who's there?" },
      { type: 'character', text: 'THEO' },
      { type: 'dialogue', text: 'Me.' },
      { type: 'character', text: 'MAYA', dual: true },
      { type: 'dialogue', text: 'Again.' },
      { type: 'transition', text: 'CUT TO:' },
      { type: 'shot', text: 'CLOSE ON THE SCARF' },
      { type: 'centered', text: 'THE END' },
      { type: 'pagebreak', text: '' },
      { type: 'scene', text: 'EXT. ROAD - DAY' },
    ]
    expect(roundTrip(els).elements).toEqual(els)
  })

  it('uppercases cues and headings on export, as Final Draft expects', () => {
    const xml = toFdx([{ type: 'character', text: 'Maya' }], tp)
    expect(xml).toContain('<Paragraph Type="Character"><Text>MAYA</Text></Paragraph>')
  })

  it('reports what would not map one-to-one', () => {
    expect(
      fdxExportIssues([
        { type: 'section', text: '# Act One' },
        { type: 'synopsis', text: 'She stays.' },
        { type: 'scene', text: 'INT. A' },
        { type: 'action', text: 'A [[note]] and [[another]].' },
      ]),
    ).toEqual({ sections: 1, synopses: 1, notes: 2, scenes: 1 })
  })

  const outline: ScriptElement[] = [
    { type: 'section', text: '# Act One' },
    { type: 'scene', text: 'INT. A' },
    { type: 'synopsis', text: 'Maya arrives.' },
    { type: 'action', text: 'Rain. [[slower?]]' },
  ]

  it('sections and synopses: General paragraphs and scene summaries by default', () => {
    const xml = toFdx(outline, tp)
    expect(xml).toContain('<Paragraph Type="General"><Text>Act One</Text></Paragraph>')
    expect(xml).toContain('<SceneProperties><Summary><Paragraph><Text>Maya arrives.</Text></Paragraph></Summary></SceneProperties>')
    expect(roundTrip(outline).elements).toEqual([
      { type: 'action', text: 'Act One' },
      { type: 'scene', text: 'INT. A' },
      { type: 'synopsis', text: 'Maya arrives.' },
      { type: 'action', text: 'Rain. [[slower?]]' },
    ])
  })

  it('never silently drops a synopsis that has no scene to attach to', () => {
    const xml = toFdx([{ type: 'scene', text: 'INT. A' }, { type: 'action', text: 'x' }, { type: 'synopsis', text: 'Coda.' }], tp)
    expect(xml).toContain('<Paragraph Type="General"><Text>Coda.</Text></Paragraph>')
  })

  it('honours "leave out" choices', () => {
    const xml = toFdx(outline, tp, { sections: 'omit', synopses: 'omit', notes: 'omit', sceneNumbers: 'custom' })
    expect(xml).not.toContain('Act One')
    expect(xml).not.toContain('Maya arrives')
    expect(xml).toContain('<Text>Rain.</Text>')
  })

  it('numbers every scene only when asked', () => {
    const els: ScriptElement[] = [{ type: 'scene', text: 'INT. A' }, { type: 'scene', text: 'INT. B #7#' }]
    expect(toFdx(els, tp)).not.toContain('Number="1"')
    expect(toFdx(els, tp, { ...DEFAULT_FDX_EXPORT, sceneNumbers: 'all' })).toContain('Number="1"')
    expect(toFdx(els, tp)).toContain('Number="7"')
  })

  it('round-trips the title page', () => {
    const { titlePage } = roundTrip([{ type: 'action', text: 'x' }])
    expect(titlePage).toMatchObject({ title: 'THE SCARF', credit: 'Written by', author: 'Jo Writer', contact: 'jo@example.com\n555-0100', draftDate: 'First Draft' })
  })
})

// Shaped like Final Draft's own files: extra element types, notes, summaries, odd styles.
const FINAL_DRAFT = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="New Act"><Text>ACT ONE</Text></Paragraph>
    <Paragraph Number="1" Type="Scene Heading">
      <SceneProperties Length="1/8" Page="1" Title=""><Summary><Paragraph><Text>Maya waits.</Text></Paragraph></Summary></SceneProperties>
      <Text>INT. DINER - NIGHT</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <ScriptNote ID="1"><Paragraph><Text>Too long?</Text></Paragraph></ScriptNote>
      <Text>Neon </Text><Text Style="Bold+Strikeout">buzzes</Text><Text>.</Text>
    </Paragraph>
    <Paragraph Type="General"><Text>A general note line.</Text></Paragraph>
    <Paragraph>
      <DualDialogue>
        <Paragraph Type="Character"><Text>MAYA</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>Coffee?</Text></Paragraph>
        <Paragraph Type="Character"><Text>THEO</Text></Paragraph>
        <Paragraph Type="Parenthetical"><Text>(at once)</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>Tea.</Text></Paragraph>
      </DualDialogue>
    </Paragraph>
    <Paragraph Number="2" StartsNewPage="Yes" Type="Scene Heading"><Text>EXT. LOT - DAY</Text></Paragraph>
    <Paragraph Type="Cast List"><Text>MAYA, THEO</Text></Paragraph>
  </Content>
  <TitlePage><Content>
    <Paragraph Alignment="Center"><Text></Text></Paragraph>
    <Paragraph Alignment="Center"><Text>DINER</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Written by</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Sam Lee</Text></Paragraph>
    <Paragraph Alignment="Left"><Text>sam@example.com</Text></Paragraph>
    <Paragraph Alignment="Right"><Text>Draft 2</Text></Paragraph>
  </Content></TitlePage>
</FinalDraft>`

describe('Final Draft import', () => {
  const parsed = parseFdx(FINAL_DRAFT)

  it('reports what needs a decision', () => {
    expect(fdxImportIssues(parsed)).toEqual({
      general: 1,
      acts: 1,
      notes: 1,
      summaries: 1,
      sceneNumbers: 2,
      customNumbers: false,
      titlePage: true,
      otherTypes: ['Cast List'],
      droppedStyles: 1,
    })
  })

  it('imports with the defaults', () => {
    const { elements, titlePage } = fromFdx(parsed, defaultImportOptions(fdxImportIssues(parsed)))
    expect(elements).toEqual([
      { type: 'section', text: '# ACT ONE' },
      { type: 'scene', text: 'INT. DINER - NIGHT' },
      { type: 'synopsis', text: 'Maya waits.' },
      { type: 'action', text: 'Neon **buzzes**. [[Too long?]]' },
      { type: 'action', text: 'A general note line.' },
      { type: 'character', text: 'MAYA' },
      { type: 'dialogue', text: 'Coffee?' },
      { type: 'character', text: 'THEO', dual: true },
      { type: 'parenthetical', text: 'at once' },
      { type: 'dialogue', text: 'Tea.' },
      { type: 'pagebreak', text: '' },
      { type: 'scene', text: 'EXT. LOT - DAY' },
      { type: 'action', text: 'MAYA, THEO' },
    ])
    expect(titlePage).toMatchObject({ title: 'DINER', credit: 'Written by', author: 'Sam Lee', contact: 'sam@example.com', draftDate: 'Draft 2' })
  })

  it('honours the other choices', () => {
    const { elements, titlePage } = fromFdx(parsed, { general: 'omit', acts: 'centered', notes: 'omit', summaries: 'omit', sceneNumbers: 'keep', titlePage: 'ignore' })
    expect(elements.slice(0, 4)).toEqual([
      { type: 'centered', text: 'ACT ONE' },
      { type: 'scene', text: 'INT. DINER - NIGHT #1#' },
      { type: 'action', text: 'Neon **buzzes**.' },
      { type: 'character', text: 'MAYA' },
    ])
    expect(titlePage.title).toBe('')
  })

  it('rejects files that are not Final Draft', () => {
    expect(() => parseFdx('<html></html>')).toThrow(/Final Draft/)
    expect(looksLikeFdx('a.fountain', 'INT. A')).toBe(false)
    expect(looksLikeFdx('a.txt', '<?xml version="1.0"?>\n<FinalDraft Version="5">')).toBe(true)
  })
})
