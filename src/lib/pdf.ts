import { jsPDF } from 'jspdf'
import { paginate, type Row } from './paginate'
import { PAGE, scriptFileName, type Script, type TitlePage } from './screenplay'

const FONT = 'CourierPrime'
const FONT_SIZE = 12
// Distance from the top of a line box to the text baseline.
const BASELINE_IN = 0.13

const fontCache = new Map<string, Promise<string>>()

function loadFont(file: string): Promise<string> {
  let p = fontCache.get(file)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load font ${file}`)
        return r.arrayBuffer()
      })
      .then(toBase64)
    fontCache.set(file, p)
  }
  return p
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

async function registerFonts(doc: jsPDF) {
  const styles: [string, string][] = [
    ['CourierPrime-Regular.ttf', 'normal'],
    ['CourierPrime-Bold.ttf', 'bold'],
    ['CourierPrime-Italic.ttf', 'italic'],
    ['CourierPrime-BoldItalic.ttf', 'bolditalic'],
  ]
  for (const [file, style] of styles) {
    doc.addFileToVFS(file, await loadFont(file))
    doc.addFont(file, FONT, style)
  }
}

const lineY = (line: number) => PAGE.topIn + line * PAGE.lineIn + BASELINE_IN

function drawTitlePage(doc: jsPDF, tp: TitlePage) {
  const center = PAGE.widthIn / 2
  let line = 20 // roughly a third of the way down
  doc.setFont(FONT, 'bold')
  for (const l of tp.title.toUpperCase().split('\n')) doc.text(l, center, lineY(line++), { align: 'center' })
  doc.setFont(FONT, 'normal')
  line += 1
  for (const block of [tp.credit, tp.author, tp.source]) {
    if (!block.trim()) continue
    line += 1
    for (const l of block.split('\n')) doc.text(l, center, lineY(line++), { align: 'center' })
  }

  const contact = tp.contact.split('\n').filter((l) => l.trim())
  contact.forEach((l, i) => doc.text(l, PAGE.leftIn, lineY(PAGE.linesPerPage - contact.length + i)))
  if (tp.draftDate.trim()) {
    doc.text(tp.draftDate, PAGE.widthIn - 1, lineY(PAGE.linesPerPage - 1), { align: 'right' })
  }
}

export interface PdfOptions {
  /** Add (CONT'D) when a character speaks again after action in the same scene. */
  autoContd: boolean
  /** Print scene numbers in both margins (for shooting scripts; spec scripts leave them off). */
  sceneNumbers: boolean
}

const UNDERLINE_OFFSET_IN = 0.025

/** Draws one line, with its bold/italic/underlined pieces in the matching Courier Prime style. */
function drawRow(doc: jsPDF, row: Row, y: number) {
  let x = PAGE.leftIn + row.indent * PAGE.charIn
  for (const run of row.runs ?? [{ text: row.text, bold: false, italic: false, underline: false }]) {
    if (!run.text) continue
    doc.setFont(FONT, run.bold && run.italic ? 'bolditalic' : run.bold ? 'bold' : run.italic ? 'italic' : 'normal')
    doc.text(run.text, x, y)
    const width = run.text.length * PAGE.charIn
    if (run.underline) {
      doc.setLineWidth(0.01)
      doc.line(x, y + UNDERLINE_OFFSET_IN, x + width, y + UNDERLINE_OFFSET_IN)
    }
    x += width
  }
  doc.setFont(FONT, 'normal')
}

export async function buildPdf(script: Script, options: PdfOptions): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' })
  await registerFonts(doc)
  doc.setFont(FONT, 'normal')
  doc.setFontSize(FONT_SIZE)
  doc.setDocumentProperties({ title: script.titlePage.title || 'Untitled', author: script.titlePage.author })

  const hasTitlePage = Boolean(script.titlePage.title.trim())
  if (hasTitlePage) drawTitlePage(doc, script.titlePage)

  const { pages } = paginate(script.elements, { autoContd: options.autoContd })
  pages.forEach((page, i) => {
    if (hasTitlePage || i > 0) doc.addPage('letter', 'portrait')
    if (page.number > 1) {
      doc.text(`${page.number}.`, PAGE.widthIn - 1, 0.5 + BASELINE_IN, { align: 'right' })
    }
    page.rows.forEach((row, line) => {
      const y = lineY(line)
      if (row.text) drawRow(doc, row, y)
      if (row.right?.text) drawRow(doc, row.right, y)
      if (options.sceneNumbers && row.sceneNumber) {
        doc.text(row.sceneNumber, PAGE.leftIn - 0.3, y, { align: 'right' })
        doc.text(row.sceneNumber, PAGE.leftIn + PAGE.textWidth * PAGE.charIn + 0.3, y)
      }
    })
  })
  return doc
}

export async function exportPdf(script: Script, options: PdfOptions) {
  const doc = await buildPdf(script, options)
  doc.save(`${scriptFileName(script)}.pdf`)
}
