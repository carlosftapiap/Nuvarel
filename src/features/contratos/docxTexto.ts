import { AlignmentType, Document, Footer, Header, HeadingLevel, ImageRun, Packer, PageBreak, PageNumber, Paragraph, TextRun } from 'docx'

/**
 * Plantilla de texto → archivo Word base, con el logotipo de AMURA en el encabezado y numeración de páginas en el pie.
 * El resultado conserva las etiquetas {campo} y pasa por el mismo llenado que un Word subido por Legal.
 *
 * Marcas del texto: «# Título», «## Subtítulo», «[[SALTO]]» para nueva página; una línea = un párrafo.
 * Para repetir una lista: {#compradores} en una línea, el contenido en las siguientes y {/compradores} en otra.
 */

export interface LogoDocx { bytes: Uint8Array; ancho: number; alto: number }

/** Bloque de firmas con etiquetas. No agrega cláusulas: solo los espacios para firmar de las partes. */
export const BLOQUE_FIRMAS = [
  '[[SALTO]]',
  '## Firmas',
  'PARTE VENDEDORA',
  '{vendedora.razon_social}',
  '______________________________',
  '{vendedora.representante_nombre}',
  '{vendedora.representante_cargo}',
  '',
  '{#compradores}',
  'PARTE COMPRADORA',
  '______________________________',
  '{nombre}',
  'Documento: {documento}',
  '',
  '{/compradores}',
  '{#apoderados}',
  'APODERADO(A) DE {representa_a}',
  '______________________________',
  '{nombre}',
  'Documento: {documento}',
  '',
  '{/apoderados}',
].join('\n')

/** Variables que usa el bloque de firmas: la plantilla las exige para poder emitirse. */
export const VARIABLES_FIRMAS = ['vendedora.razon_social', 'vendedora.representante_nombre', 'vendedora.representante_cargo', 'comprador.nombre', 'comprador.documento']

export async function construirDocxDesdeTexto(cuerpo: string, op: { conFirmas: boolean; logo?: LogoDocx }): Promise<Uint8Array> {
  const texto = op.conFirmas ? `${cuerpo.replace(/\s+$/, '')}\n\n${BLOQUE_FIRMAS}` : cuerpo
  const parrafos: Paragraph[] = []
  for (const linea of texto.replace(/\r\n/g, '\n').split('\n')) {
    const t = linea.replace(/\s+$/, '')
    if (t === '[[SALTO]]') { parrafos.push(new Paragraph({ children: [new PageBreak()] })); continue }
    if (t.startsWith('## ')) { parrafos.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t.slice(3), bold: true, size: 23 })] })); continue }
    if (t.startsWith('# ')) { parrafos.push(new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 200 }, children: [new TextRun({ text: t.slice(2), bold: true, size: 26 })] })); continue }
    parrafos.push(new Paragraph({ spacing: { after: 120 }, alignment: AlignmentType.LEFT, children: t ? [new TextRun({ text: t, size: 21 })] : [] }))
  }
  const encabezado = new Paragraph({
    spacing: { after: 120 },
    children: op.logo
      ? [new ImageRun({ type: 'png', data: op.logo.bytes, transformation: { width: Math.round(op.logo.ancho * (36 / op.logo.alto)), height: 36 } })]
      : [new TextRun({ text: 'AMURA', bold: true, size: 28 })],
  })
  const pie = new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [new TextRun({ children: ['Página ', PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16 })],
  })
  const doc = new Document({
    creator: 'AMURA',
    styles: { default: { document: { run: { font: 'Arial', size: 21 } } } },
    sections: [{
      properties: { page: { margin: { top: 1500, bottom: 1300, left: 1400, right: 1400 } } },
      headers: { default: new Header({ children: [encabezado] }) },
      footers: { default: new Footer({ children: [pie] }) },
      children: parrafos,
    }],
  })
  return new Uint8Array(await Packer.toArrayBuffer(doc))
}
