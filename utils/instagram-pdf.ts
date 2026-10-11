/**
 * Le PDF d'un post : le titre et l'image en première page, le texte ensuite.
 * Écrit à la main pour ne rien ajouter aux dépendances du jeu — la JPEG y
 * passe telle quelle (DCTDecode), le texte est en Helvetica, que tout lecteur
 * PDF possède, encodé en WinAnsi : les accents passent, les emojis tombent.
 * Côté navigateur seulement (la césure mesure le texte sur un canvas).
 */

export interface PdfBlock { label: string; text: string }

export interface PostPdf {
  title: string
  meta: string
  jpeg: Uint8Array
  width: number
  height: number
  blocks: PdfBlock[]
}

// A4 en points.
const PAGE_W = 595.28
const PAGE_H = 841.89
const MARGIN = 56

/** Ce que WinAnsi range hors de Latin-1. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
  ' ': 0xA0, ' ': 0x20, '\t': 0x20,
}

function winAnsi(text: string): string {
  let out = ''
  for (const ch of text) {
    const c = ch.codePointAt(0)!
    const code = (c >= 0x20 && c < 0x7F) || (c >= 0xA0 && c <= 0xFF) ? c : WIN_ANSI[ch]
    if (code !== undefined) out += String.fromCharCode(code)
  }
  return out
}

const hex = (s: string) => `<${[...s].map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}>`

interface Line { font: 'F1' | 'F2'; size: number; gray: number; text: string; lead: number }

export function postPdf(post: PostPdf): Blob {
  const ctx = document.createElement('canvas').getContext('2d')!
  const width = (text: string, line: Pick<Line, 'font' | 'size'>) => {
    ctx.font = `${line.font === 'F2' ? 700 : 400} ${line.size}px Helvetica, Arial, sans-serif`
    return ctx.measureText(text).width
  }
  const maxWidth = (PAGE_W - MARGIN * 2) * 0.98

  function wrap(text: string, style: Omit<Line, 'text'>): Line[] {
    const lines: Line[] = []
    for (const paragraph of text.split('\n')) {
      let line = ''
      for (const word of paragraph.split(/ +/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word
        if (line && width(next, style) > maxWidth) {
          lines.push({ ...style, text: line })
          line = word
        } else line = next
      }
      lines.push({ ...style, text: line })
    }
    return lines
  }

  // Page 1 : titre, ligne d'infos, puis l'image dans tout l'espace restant.
  const first: string[] = []
  let y = PAGE_H - MARGIN - 18
  for (const line of [
    ...wrap(post.title, { font: 'F2', size: 18, gray: 0, lead: 22 }),
    ...wrap(post.meta, { font: 'F1', size: 9, gray: 0.45, lead: 14 }),
  ]) {
    first.push(`BT /${line.font} ${line.size} Tf ${line.gray} g ${MARGIN} ${y.toFixed(2)} Td ${hex(winAnsi(line.text))} Tj ET`)
    y -= line.lead
  }
  const top = y - 6
  const scale = Math.min((PAGE_W - MARGIN * 2) / post.width, (top - MARGIN) / post.height)
  const w = post.width * scale
  const h = post.height * scale
  first.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${((PAGE_W - w) / 2).toFixed(2)} ${(top - h).toFixed(2)} cm /Im1 Do Q`)
  const pages: string[][] = [first]

  // Pages suivantes : chaque bloc, son intitulé puis son texte.
  const body: Line[] = []
  for (const block of post.blocks) {
    body.push({ font: 'F2', size: 9, gray: 0.45, text: block.label.toUpperCase(), lead: body.length ? 30 : 9 })
    const text = wrap(block.text.trim(), { font: 'F1', size: 11, gray: 0, lead: 15.5 })
    text[0]!.lead = 20
    body.push(...text)
  }
  let page: string[] | null = null
  for (const line of body) {
    y -= line.lead
    if (!page || y < MARGIN) {
      page = []
      pages.push(page)
      y = PAGE_H - MARGIN - line.size
    }
    if (line.text) page.push(`BT /${line.font} ${line.size} Tf ${line.gray} g ${MARGIN} ${y.toFixed(2)} Td ${hex(winAnsi(line.text))} Tj ET`)
  }

  // Les objets : 1 catalogue, 2 pages, 3-4 polices, 5 image, puis page + contenu.
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    [`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(' ')}] >>`],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'],
    [
      `<< /Type /XObject /Subtype /Image /Width ${post.width} /Height ${post.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${post.jpeg.length} >>\nstream\n`,
      post.jpeg,
      '\nendstream',
    ],
  ]
  pages.forEach((ops, i) => {
    const stream = ops.join('\n')
    objects.push([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /Im1 5 0 R >> >> /Contents ${7 + i * 2} 0 R >>`])
    objects.push([`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`])
  })

  // Tout ce qui est chaîne ici est ASCII : un caractère, un octet.
  const parts: BlobPart[] = []
  const offsets: number[] = []
  let size = 0
  const put = (part: string | Uint8Array) => {
    parts.push(part as BlobPart)
    size += part.length
  }
  put('%PDF-1.4\n')
  objects.forEach((chunks, i) => {
    offsets.push(size)
    put(`${i + 1} 0 obj\n`)
    chunks.forEach(put)
    put('\nendobj\n')
  })
  const xref = size
  put(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`)
  put(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}
