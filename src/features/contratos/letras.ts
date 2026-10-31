/** Cantidades y fechas en letras para los documentos. Solo formato: no agrega ningún texto jurídico. */

const U = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
  'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve']
const D = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const C = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos']

/** 1–999. Con apócope, «uno» → «un» y «veintiuno» → «veintiún» (delante de «mil» o de un sustantivo). */
function hasta999(n: number, apocope: boolean): string {
  if (n === 0) return ''
  if (n === 100) return 'cien'
  const c = Math.floor(n / 100)
  const r = n % 100
  const partes: string[] = []
  if (c) partes.push(C[c])
  if (r) {
    if (r < 30) {
      let t = U[r]
      if (apocope && r === 1) t = 'un'
      if (apocope && r === 21) t = 'veintiún'
      partes.push(t)
    } else {
      const d = Math.floor(r / 10)
      const u = r % 10
      partes.push(D[d] + (u ? ` y ${apocope && u === 1 ? 'un' : U[u]}` : ''))
    }
  }
  return partes.join(' ')
}

function menorMillon(n: number, apocope: boolean): string {
  const miles = Math.floor(n / 1000)
  const resto = n % 1000
  const m = miles === 0 ? '' : miles === 1 ? 'mil' : `${hasta999(miles, true)} mil`
  return [m, hasta999(resto, apocope)].filter(Boolean).join(' ')
}

export function numeroALetras(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999_999) throw new Error('Cantidad fuera de rango')
  if (n === 0) return 'cero'
  const millones = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000
  const m = millones === 0 ? '' : millones === 1 ? 'un millón' : `${menorMillon(millones, true)} millones`
  return [m, menorMillon(resto, false)].filter(Boolean).join(' ')
}

/** «ciento sesenta y un mil ochocientos treinta y uno dólares con 00/100» */
export function montoALetras(monto: number): string {
  if (!Number.isFinite(monto) || monto < 0) throw new Error('Monto no válido')
  let enteros = Math.floor(monto)
  let centavos = Math.round((monto - enteros) * 100)
  if (centavos === 100) { enteros += 1; centavos = 0 }
  const palabras = enteros === 1 ? 'un dólar' : `${numeroALetras(enteros).replace(/ uno$/, ' un').replace(/^uno$/, 'un')}${enteros >= 1_000_000 && enteros % 1_000_000 === 0 ? ' de' : ''} dólares`
  return `${palabras} con ${String(centavos).padStart(2, '0')}/100`
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «2026-10-30» → «30 de octubre de 2026» */
export function fechaLarga(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return ''
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}`
}

export const fechaCorta = (iso: string | null | undefined) => {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

export const dinero = (v: number | null | undefined) => (v === null || v === undefined ? '' : Number(v).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
export const decimal = (v: number | null | undefined) => (v === null || v === undefined ? '' : Number(v).toLocaleString('es-EC', { minimumFractionDigits: 0, maximumFractionDigits: 2 }))
