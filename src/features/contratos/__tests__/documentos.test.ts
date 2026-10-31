// @vitest-environment jsdom
import PizZip from 'pizzip'
import { describe, expect, it } from 'vitest'
import { bloquesDeDocx, documentoDeDocx, formatoNumero, type Bloque, type Parrafo } from '../bloques'
import { datosParaPlantilla } from '../datos'
import { construirDocxDesdeTexto, VARIABLES_FIRMAS } from '../docxTexto'
import { sha256, sha256Puro } from '../hash'
import { dinero, fechaCorta, fechaLarga, montoALetras, numeroALetras } from '../letras'
import type { InstantaneaDocumento } from '../model'
import { construirPdf, pdfABytes } from '../pdf'
import { extraerEtiquetas, llenarPlantilla, variablesSugeridas } from '../plantilla'

const snapshot = (): InstantaneaDocumento => ({
  contrato: { codigo: 'CON-2026-0001', fecha: '2026-10-30' },
  vendedora: { razon_social: 'Inmobiliaria Jarval S.A.', ruc: '1791234567001', domicilio: 'Quito', representante_nombre: 'Ana Representante', representante_cargo: 'Gerente general', representante_documento: '', email: '', telefono: '' },
  comprador: { nombre: 'Carlos Andrés Mora Ruiz', documento: '1710034065', nacionalidad: 'ecuatoriana', estado_civil: 'casado', domicilio: 'Av. Amazonas N21-45', ciudad: 'Quito', telefono: '0991234567', email: 'carlos@correo.com', es_principal: true },
  compradores: [
    { nombre: 'Carlos Andrés Mora Ruiz', documento: '1710034065', nacionalidad: 'ecuatoriana', estado_civil: 'casado', domicilio: 'Av. Amazonas N21-45', ciudad: 'Quito', telefono: '', email: '', es_principal: true },
    { nombre: 'María Elena Salazar Ruiz', documento: '1712345678', nacionalidad: 'ecuatoriana', estado_civil: 'casado', domicilio: 'Av. Amazonas N21-45', ciudad: 'Quito', telefono: '', email: '', es_principal: false, porcentaje: 50 },
  ],
  compradores_adicionales: [{ nombre: 'María Elena Salazar Ruiz', documento: '1712345678', nacionalidad: 'ecuatoriana', estado_civil: 'casado', domicilio: 'Av. Amazonas N21-45', ciudad: 'Quito', telefono: '', email: '', es_principal: false, porcentaje: 50 }],
  apoderados: [{ nombre: 'Pablo Andrade Mora', documento: '1798765432', nacionalidad: '', estado_civil: '', domicilio: '', ciudad: '', telefono: '', email: '', poder_detalle: 'Notaría 12 de Quito', representa_a: 'Carlos Andrés Mora Ruiz' }],
  unidad: { codigo: 'E1-P1-A1', departamento: '1101', edificio: 1, piso: '1', tipologia: '2 hab', ubicacion: 'Inferior izquierda', area_m2: 70.47, bodega_codigo: '11A', bodega_m2: 1.98, patio_m2: 0, parqueo: '' },
  precio: { total: 161831, lista: 161831, descuento_pct: 0 },
  pago: {
    reserva: 500, firma: 9209.86, num_cuotas: 2, cuota_mensual: 1155.94, total_cuotas: 2311.88, saldo: 129464.8,
    cuotas: [{ numero: 2, concepto: 'Cuota 1 de 2', vencimiento: '2026-11-30', monto: 1155.94 }, { numero: 3, concepto: 'Cuota 2 de 2', vencimiento: '2026-12-30', monto: 1155.94 }],
    cronograma: [],
  },
  manual: { lugar_firma: 'Quito' },
})

const textoPlantilla = [
  '# CONTRATO DE COMPRAVENTA',
  'Código {contrato.codigo}, suscrito en {lugar_firma} el {contrato.fecha_larga}.',
  'Comprador: {comprador.nombre}, documento {comprador.documento}.',
  'Departamento {unidad.departamento} del Edificio {unidad.edificio}. Precio: USD {precio.total} ({precio.total_letras}).',
  '{#pago.cuotas}',
  'Cuota {numero}: {concepto} vence el {vencimiento} por USD {monto}',
  '{/pago.cuotas}',
].join('\n')

describe('números, fechas y huellas', () => {
  it('pasa cantidades a letras con apócope y centavos', () => {
    expect(numeroALetras(0)).toBe('cero')
    expect(numeroALetras(21)).toBe('veintiuno')
    expect(numeroALetras(100)).toBe('cien')
    expect(numeroALetras(101)).toBe('ciento uno')
    expect(numeroALetras(1000)).toBe('mil')
    expect(numeroALetras(21_000)).toBe('veintiún mil')
    expect(numeroALetras(31_001)).toBe('treinta y un mil uno')
    expect(numeroALetras(1_000_000)).toBe('un millón')
    expect(numeroALetras(2_500_000)).toBe('dos millones quinientos mil')
    expect(montoALetras(161831)).toBe('ciento sesenta y un mil ochocientos treinta y un dólares con 00/100')
    expect(montoALetras(1)).toBe('un dólar con 00/100')
    expect(montoALetras(500.5)).toBe('quinientos dólares con 50/100')
    expect(montoALetras(2_000_000)).toBe('dos millones de dólares con 00/100')
    expect(() => montoALetras(-1)).toThrow()
  })

  it('da formato a fechas y dinero', () => {
    expect(fechaLarga('2026-10-30')).toBe('30 de octubre de 2026')
    expect(fechaCorta('2026-03-04')).toBe('04/03/2026')
    expect(fechaLarga(null)).toBe('')
    expect(dinero(161831)).toBe('161.831,00')
    expect(dinero(1155.9)).toBe('1.155,90')
  })

  it('la huella SHA-256 coincide con la de referencia, con Web Crypto y con la implementación propia', async () => {
    const abc = new TextEncoder().encode('abc')
    const esperado = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(await sha256(abc)).toBe(esperado)
    expect(sha256Puro(abc)).toBe(esperado)
    expect(sha256Puro(new Uint8Array(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    const largo = new Uint8Array(1000).fill(97)
    expect(sha256Puro(largo)).toBe(await sha256(largo))
  })
})

describe('plantilla de texto → Word → llenado → PDF', () => {
  it('genera un Word con encabezado y numeración, lo llena con datos reales y conserva el contenido', async () => {
    const base = await construirDocxDesdeTexto(textoPlantilla, { conFirmas: true })
    const zip = new PizZip(base)
    expect(Object.keys(zip.files).some((f) => /word\/header\d*\.xml/.test(f))).toBe(true)
    expect(zip.file('word/footer1.xml')!.asText()).toMatch(/PAGE/)
    const et = extraerEtiquetas(base)
    expect(et.variables).toEqual(expect.arrayContaining(['contrato.codigo', 'lugar_firma', 'comprador.nombre', 'precio.total_letras', 'vendedora.razon_social']))
    expect(et.bucles).toEqual(expect.arrayContaining(['pago.cuotas', 'compradores', 'apoderados']))
    expect(et.variables).not.toContain('numero') // los campos de un elemento del bucle no son variables sueltas
    const { docx, texto } = llenarPlantilla(base, datosParaPlantilla(snapshot()))
    expect(texto).toMatch(/Código CON-2026-0001, suscrito en Quito el 30 de octubre de 2026\./)
    expect(texto).toContain('Comprador: Carlos Andrés Mora Ruiz, documento 1710034065.')
    expect(texto).toContain('USD 161.831,00 (ciento sesenta y un mil ochocientos treinta y un dólares con 00/100)')
    expect(texto).toContain('Cuota 1: Cuota 1 de 2 vence el 30/11/2026 por USD 1.155,94')
    expect(texto).toContain('Cuota 2: Cuota 2 de 2 vence el 30/12/2026 por USD 1.155,94')
    expect(texto).not.toMatch(/\{|undefined/)
    // Firmas: la vendedora, ambos compradores y el apoderado.
    expect(texto).toContain('Inmobiliaria Jarval S.A.')
    expect(texto).toContain('María Elena Salazar Ruiz')
    expect(texto).toContain('APODERADO(A) DE Carlos Andrés Mora Ruiz')
    // El resultado vuelve a abrirse como Word.
    const bloques = bloquesDeDocx(docx)
    expect(bloques[0]).toMatchObject({ tipo: 'parrafo', nivel: 1, alinear: 'centro', texto: 'CONTRATO DE COMPRAVENTA' })
    expect(bloques.some((b) => b.tipo === 'salto')).toBe(true)
    expect(VARIABLES_FIRMAS).toContain('vendedora.representante_cargo')
  })

  it('el PDF resultante es un PDF válido con encabezado, pie y total de páginas', async () => {
    const base = await construirDocxDesdeTexto(textoPlantilla, { conFirmas: true })
    const { docx } = llenarPlantilla(base, datosParaPlantilla(snapshot()))
    const doc = construirPdf(documentoDeDocx(docx), { titulo: 'Contrato de compraventa', codigo: 'CON-2026-0001', version: 1 })
    const bytes = pdfABytes(doc)
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-')
    expect(doc.getNumberOfPages()).toBe(2)
    const contenido = new TextDecoder('latin1').decode(bytes)
    expect(contenido).toContain('/Count 2')
    expect(bytes.length).toBeGreaterThan(2500)
    // Una huella distinta para un contenido distinto.
    const otro = pdfABytes(construirPdf(documentoDeDocx(docx), { titulo: 'Contrato de compraventa', codigo: 'CON-2026-0002', version: 1 }))
    expect(await sha256(bytes)).not.toBe(await sha256(otro))
  })

  it('las tablas del Word se conservan y se dibujan en el PDF', async () => {
    const zip = new PizZip(await construirDocxDesdeTexto('# Anexo\nTexto', { conFirmas: false }))
    const xml = zip.file('word/document.xml')!.asText().replace('</w:body>',
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Concepto</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Monto</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Reserva</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>500,00</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body>')
    zip.file('word/document.xml', xml)
    const bloques = bloquesDeDocx(zip.generate({ type: 'uint8array' }))
    expect(bloques.at(-1)).toMatchObject({ tipo: 'tabla', filas: [['Concepto', 'Monto'], ['Reserva', '500,00']] })
    expect(pdfABytes(construirPdf(documentoDeDocx(zip.generate({ type: 'uint8array' })), { titulo: 'Anexo', codigo: 'X', version: 1 })).length).toBeGreaterThan(1500)
  })
})

describe('el PDF conserva lo definido en el Word', () => {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
  const nivel = (i: number, formato: string, texto: string, izq: number, colgar: number, extra = '') => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${formato}"/>${extra}<w:lvlText w:val="${texto}"/><w:pPr><w:ind w:left="${izq}" w:hanging="${colgar}"/></w:pPr></w:lvl>`
  const num = (n: number, l: number) => `<w:numPr><w:ilvl w:val="${l}"/><w:numId w:val="${n}"/></w:numPr>`
  const campo = (n: string) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> ${n} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
  const word = () => {
    const zip = new PizZip()
    zip.file('word/document.xml', `<w:document ${W}><w:body>
      <w:p><w:pPr><w:pStyle w:val="Clausula"/></w:pPr><w:r><w:t>Objeto</w:t></w:r></w:p>
      <w:p><w:pPr>${num(1, 1)}<w:jc w:val="both"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Parte en negrita. </w:t></w:r><w:r><w:t>Resto normal.</w:t></w:r></w:p>
      <w:p><w:pPr>${num(1, 2)}</w:pPr><w:r><w:t>literal</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="Clausula"/></w:pPr><w:r><w:t>Precio</w:t></w:r></w:p>
      <w:p><w:pPr>${num(1, 1)}</w:pPr><w:r><w:t>Segundo numeral</w:t></w:r></w:p>
      <w:p><w:pPr>${num(2, 0)}</w:pPr><w:r><w:t>viñeta</w:t></w:r></w:p>
      <w:p><w:r><w:t>Antes</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>Después</w:t></w:r></w:p>
      <w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="4000"/></w:tblGrid>
        <w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="D9E2F3"/></w:tcPr><w:p><w:r><w:t>Título</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:sectPr><w:footerReference w:type="default" r:id="rId1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1000" w:right="1100" w:bottom="1200" w:left="1300" w:header="400" w:footer="500"/></w:sectPr>
    </w:body></w:document>`)
    zip.file('word/numbering.xml', `<w:numbering ${W}><w:abstractNum w:abstractNumId="0">${nivel(0, 'ordinalText', 'CLÁUSULA %1.-', 0, 0, '<w:pStyle w:val="Clausula"/><w:suff w:val="space"/>')}${nivel(1, 'decimal', '%1.%2.', 567, 567, '<w:isLgl/>')}${nivel(2, 'lowerLetter', '%3)', 1134, 567)}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#xF0B7;"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`)
    zip.file('word/styles.xml', `<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Clausula"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:before="240"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>`)
    zip.file('word/footer1.xml', `<w:ftr ${W}><w:p><w:r><w:t xml:space="preserve">Página </w:t></w:r>${campo('PAGE')}<w:r><w:t xml:space="preserve"> de </w:t></w:r>${campo('NUMPAGES')}</w:p></w:ftr>`)
    zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="x" Target="footer1.xml"/></Relationships>`)
    return zip.generate({ type: 'uint8array' })
  }
  const parrafos = (b: Bloque[]) => b.filter((x): x is Parrafo => x.tipo === 'parrafo')

  it('resuelve la numeración automática del Word, con sus niveles y reinicios', () => {
    const p = parrafos(documentoDeDocx(word()).bloques)
    expect(p.map((x) => x.etiqueta?.texto ?? null)).toEqual(['CLÁUSULA Primero.-', '1.1.', 'a)', 'CLÁUSULA Segundo.-', '2.1.', '•', null, null])
    expect(p[0]).toMatchObject({ sufijo: 'espacio', negrita: true })
    expect(p[1]).toMatchObject({ izq: 28.35, primera: -28.35, alinear: 'justificado', sufijo: 'tab' })
  })

  it('conserva negritas parciales, tamaño y fuente de cada tramo', () => {
    const p = parrafos(documentoDeDocx(word()).bloques)[1]
    expect(p.negrita).toBe(false)
    expect(p.tramos.map((t) => [t.texto, t.negrita, t.tamano, t.fuente])).toEqual([['Parte en negrita. ', true, 11, 'helvetica'], ['Resto normal.', false, 11, 'helvetica']])
  })

  it('conserva página, márgenes, tablas combinadas y campos de página del pie', () => {
    const d = documentoDeDocx(word())
    expect(d.secciones[0].pagina).toMatchObject({ ancho: 612, alto: 792, arriba: 50, abajo: 60, izq: 65, der: 55, pie: 25 })
    expect(d.secciones[0].pies.default).toBeDefined()
    const tabla = d.bloques.find((x) => x.tipo === 'tabla')
    expect(tabla).toMatchObject({ columnas: [100, 200], filas: [['Título'], ['A', 'B']] })
    if (tabla?.tipo !== 'tabla') throw new Error('sin tabla')
    expect(tabla.detalle[0].celdas[0]).toMatchObject({ span: 2, fondo: [217, 226, 243] })
    expect(tabla.detalle[1].celdas[0].bordes.der).toMatchObject({ ancho: 0.5 })
    const pdf = construirPdf(d, { titulo: 'Contrato', codigo: 'C', version: 1 })
    expect(pdf.getNumberOfPages()).toBe(2)
    expect(pdf.internal.pageSize.getWidth()).toBeCloseTo(612, 0)
    const texto = new TextDecoder('latin1').decode(pdfABytes(pdf))
    expect(texto).toContain('(2)')
    expect(texto).toContain('(literal)')
  })

  it('un salto de página divide el párrafo y conserva las cifras en texto', () => {
    const d = documentoDeDocx(word())
    const i = d.bloques.findIndex((x) => x.tipo === 'salto')
    expect(d.bloques[i - 1]).toMatchObject({ texto: 'Antes' })
    expect(d.bloques[i + 1]).toMatchObject({ texto: 'Después' })
    expect(formatoNumero(4, 'upperRoman')).toBe('IV')
    expect(formatoNumero(3, 'ordinalText')).toBe('Tercero')
  })
})

describe('plantillas Word subidas por Legal', () => {
  it('detecta las etiquetas y propone vincularlas al catálogo o pedirlas al generar', async () => {
    const base = await construirDocxDesdeTexto('Hola {comprador.nombre}, en {lugar_firma}. {#compradores}{nombre}{/compradores}', { conFirmas: false })
    const sug = variablesSugeridas(extraerEtiquetas(base), [
      { clave: 'comprador.nombre', grupo: 'Comprador', etiqueta: 'Nombres y apellidos', tipo: 'texto', derivaDe: null, descripcion: '' },
      { clave: 'compradores', grupo: 'Compradores', etiqueta: 'Todos los compradores', tipo: 'lista', derivaDe: null, descripcion: '' },
    ])
    expect(sug).toEqual(expect.arrayContaining([
      { clave: 'comprador.nombre', etiqueta: 'Nombres y apellidos', origen: 'catalogo', obligatorio: true },
      { clave: 'lugar_firma', etiqueta: 'lugar firma', origen: 'manual', obligatorio: true },
      { clave: 'compradores', etiqueta: 'Todos los compradores', origen: 'catalogo', obligatorio: true },
    ]))
  })

  it('rechaza archivos que no son Word y etiquetas mal escritas con un mensaje claro', async () => {
    expect(() => extraerEtiquetas(new TextEncoder().encode('no soy un docx'))).toThrow(/no es un documento de Word/)
    const mal = await construirDocxDesdeTexto('Falta cerrar {#pago.cuotas} el bucle', { conFirmas: false })
    expect(() => llenarPlantilla(mal, {})).toThrow(/etiquetas mal escritas/)
  })

  it('conserva un Word con estilo propio: reemplaza etiquetas partidas en varias partes de texto', async () => {
    const zip = new PizZip(await construirDocxDesdeTexto('Comprador: PLACEHOLDER', { conFirmas: false }))
    // Word suele partir una etiqueta en varios runs con formato distinto.
    const xml = zip.file('word/document.xml')!.asText().replace(/<w:r>(?:(?!<w:r>).)*?PLACEHOLDER.*?<\/w:r>/s,
      '<w:r><w:t xml:space="preserve">Comprador: {comp</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>rador.nom</w:t></w:r><w:r><w:t>bre}</w:t></w:r>')
    zip.file('word/document.xml', xml)
    const { texto } = llenarPlantilla(zip.generate({ type: 'uint8array' }), datosParaPlantilla(snapshot()))
    expect(texto).toContain('Comprador: Carlos Andrés Mora Ruiz')
  })
})
