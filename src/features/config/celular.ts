/**
 * Celular en formato internacional (E.164), con las mismas reglas que la base (celular_normalizado):
 * 09XXXXXXXX → +5939XXXXXXXX (Ecuador por defecto); otros países con «+» y su código.
 * Devuelve null si no es válido. Vacío no es un error: el celular es opcional.
 */
export function normalizarCelular(texto: string): string | null {
  const d = texto.replace(/\D/g, '')
  const mas = texto.trim().startsWith('+')
  if (/^09\d{8}$/.test(d)) return `+593${d.slice(1)}`
  if (/^5939\d{8}$/.test(d)) return `+${d}`
  if (/^593/.test(d)) return null
  if (mas && /^[1-9]\d{7,14}$/.test(d)) return `+${d}`
  return null
}

/** Mensaje de validación para el formulario; null si está vacío o es válido. */
export function errorCelular(texto: string): string | null {
  if (!texto.trim()) return null
  return normalizarCelular(texto) ? null : 'Escribe 09XXXXXXXX (Ecuador) o el número internacional con «+» y el código del país.'
}
