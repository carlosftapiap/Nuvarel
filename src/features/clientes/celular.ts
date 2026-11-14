/**
 * Celular del cliente, con las mismas reglas que la base (celular_normalizado): un número, una sola ficha.
 * Ecuador: 10 dígitos que empiezan por 09, o +593 9…; otro país: + y el código del país (8 a 15 dígitos).
 */
export function normalizarCelular(v: string): string | null {
  const d = v.replace(/\D/g, '')
  if (/^09\d{8}$/.test(d)) return `+593${d.slice(1)}`
  if (/^5939\d{8}$/.test(d)) return `+${d}`
  if (d.startsWith('593')) return null
  if (v.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(d)) return `+${d}`
  return null
}

/** Error del celular, o null si es válido. */
export function errorCelular(v: string): string | null {
  if (!v.trim()) return 'Ingresa el celular del cliente.'
  return normalizarCelular(v) ? null : 'Celular no válido: en Ecuador, 10 dígitos que empiezan por 09 (o +593 9…); de otro país, con + y el código del país.'
}

export const MENSAJE_CELULAR_REPETIDO = 'Este celular ya se encuentra registrado en AMURA.'

/** Para mostrar y buscar: un celular ecuatoriano guardado como +5939XXXXXXXX se ve como 09XXXXXXXX. */
export const celularLocal = (t: string) => (/^\+5939\d{8}$/.test(t) ? `0${t.slice(4)}` : t)
