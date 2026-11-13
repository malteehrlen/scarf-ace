import { jsPDF } from 'jspdf'
import { paginate } from './paginate'
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

export async function buildPdf(script: Script): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' })
  await registerFonts(doc)
  doc.setFont(FONT, 'normal')
  doc.setFontSize(FONT_SIZE)
  doc.setDocumentProperties({ title: script.titlePage.title || 'Untitled', author: script.titlePage.author })

  const hasTitlePage = Boolean(script.titlePage.title.trim())
  if (hasTitlePage) drawTitlePage(doc, script.titlePage)

  const { pages } = paginate(script.elements)
  pages.forEach((page, i) => {
    if (hasTitlePage || i > 0) doc.addPage('letter', 'portrait')
    if (page.number > 1) {
      doc.text(`${page.number}.`, PAGE.widthIn - 1, 0.5 + BASELINE_IN, { align: 'right' })
    }
    page.rows.forEach((row, line) => {
      if (row.text) doc.text(row.text, PAGE.leftIn + row.indent * PAGE.charIn, lineY(line))
    })
  })
  return doc
}

export async function exportPdf(script: Script) {
  const doc = await buildPdf(script)
  doc.save(`${scriptFileName(script)}.pdf`)
}
