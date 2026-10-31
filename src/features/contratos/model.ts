export type TipoDocumentoContractual = 'contrato_compraventa' | 'promesa_compraventa' | 'contrato_reserva' | 'anexo' | 'adenda' | 'otro'
export type TipoOperacion = 'general' | 'contado' | 'financiamiento_bancario' | 'plan_directo'
export type FormatoPlantilla = 'docx' | 'texto'
export type EstadoPlantilla = 'borrador' | 'aprobada' | 'retirada'
export type EstadoDocumento = 'borrador' | 'pendiente_firma' | 'firmado' | 'anulado'
export type EstadoCivil = 'soltero' | 'casado' | 'divorciado' | 'viudo' | 'union_de_hecho'

export const TIPOS_DOCUMENTO_CONTRACTUAL: Record<TipoDocumentoContractual, string> = {
  contrato_compraventa: 'Contrato de compraventa', promesa_compraventa: 'Promesa de compraventa', contrato_reserva: 'Contrato de reserva', anexo: 'Anexo', adenda: 'Adenda', otro: 'Otro documento',
}
export const TIPOS_OPERACION: Record<TipoOperacion, string> = {
  general: 'Cualquier operación', contado: 'Pago de contado', financiamiento_bancario: 'Financiamiento bancario', plan_directo: 'Plan de pago directo',
}
export const ESTADO_PLANTILLA: Record<EstadoPlantilla, { label: string; tono: string }> = {
  borrador: { label: 'Borrador', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  aprobada: { label: 'Aprobada', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  retirada: { label: 'Retirada', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
export const ESTADO_DOCUMENTO: Record<EstadoDocumento, { label: string; tono: string }> = {
  borrador: { label: 'Borrador', tono: 'bg-amber-50 text-amber-800 ring-amber-200' },
  pendiente_firma: { label: 'Pendiente de firma', tono: 'bg-sky-50 text-sky-800 ring-sky-200' },
  firmado: { label: 'Firmado', tono: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  anulado: { label: 'Anulado', tono: 'bg-slate-100 text-slate-600 ring-slate-200' },
}
export const ESTADOS_CIVILES: Record<EstadoCivil, string> = {
  soltero: 'Soltero(a)', casado: 'Casado(a)', divorciado: 'Divorciado(a)', viudo: 'Viudo(a)', union_de_hecho: 'Unión de hecho',
}

export interface VariablePlantilla { clave: string; etiqueta: string; origen: 'catalogo' | 'manual'; obligatorio: boolean }

export interface CampoCatalogo { clave: string; grupo: string; etiqueta: string; tipo: 'texto' | 'numero' | 'fecha' | 'dinero' | 'lista'; derivaDe: string | null; descripcion: string }

export interface Plantilla {
  id: string
  familiaId: string
  version: number
  nombre: string
  tipoDocumento: TipoDocumentoContractual
  tipoOperacion: TipoOperacion
  formato: FormatoPlantilla
  cuerpo: string | null
  archivoRuta: string | null
  archivoNombre: string | null
  archivoHash: string | null
  archivoTamano: number | null
  variables: VariablePlantilla[]
  notas: string
  estado: EstadoPlantilla
  creadaNombre: string
  creadaEn: string
  aprobadaNombre: string | null
  aprobadaEn: string | null
  retiradaNombre: string | null
  retiradaEn: string | null
  retiradaMotivo: string | null
}

export interface EventoPlantilla { id: string; plantillaId: string; accion: string; usuario: string; motivo: string; fecha: string }

export interface EntidadVendedora {
  razonSocial: string
  ruc: string
  domicilio: string
  representanteNombre: string
  representanteCargo: string
  representanteDocumento: string
  email: string
  telefono: string
  actualizadoNombre: string | null
  actualizadoEn: string | null
}

export interface Comprador {
  id: string
  rol: 'comprador' | 'apoderado'
  nombre: string
  documento: string
  nacionalidad: string
  estadoCivil: EstadoCivil | null
  domicilio: string
  ciudad: string
  telefono: string
  email: string
  representaA: string | null
  poderDetalle: string
  porcentaje: number | null
  retiradoEn: string | null
}

/** Datos exactos con los que se generó un documento. Es lo que el servidor devuelve y vuelve a validar al registrar. */
export interface InstantaneaDocumento {
  contrato: { codigo: string; fecha: string }
  vendedora: Record<string, string>
  comprador: PersonaDoc
  compradores: PersonaDoc[]
  compradores_adicionales: PersonaDoc[]
  apoderados: (PersonaDoc & { poder_detalle: string; representa_a: string })[]
  unidad: Record<string, string | number | null>
  precio: { total: number; lista: number | null; descuento_pct: number | null }
  pago: { reserva: number | null; firma: number | null; num_cuotas: number; cuota_mensual: number | null; total_cuotas: number | null; saldo: number | null; cuotas: CuotaDoc[]; cronograma: CuotaDoc[]; extraordinarias?: CuotaDoc[] }
  manual: Record<string, string>
}
export interface PersonaDoc { primer_nombre?: string; segundo_nombre?: string; primer_apellido?: string; segundo_apellido?: string; nombre: string; documento: string; nacionalidad: string; estado_civil: string; domicilio: string; ciudad: string; telefono: string; email: string; es_principal?: boolean; porcentaje?: number | null }
export interface CuotaDoc { numero: number; concepto: string; vencimiento: string | null; monto: number }

export interface Faltante { clave: string; etiqueta: string; donde: string }

export interface VersionDocumento {
  id: string
  contratoId: string
  plantillaId: string
  plantillaNombre: string
  plantillaVersion: number
  tipoDocumento: string
  numero: number
  estado: EstadoDocumento
  pdfRuta: string
  pdfHash: string
  pdfTamano: number | null
  docxRuta: string | null
  docxHash: string | null
  docxTamano: number | null
  generadoNombre: string
  generadoEn: string
  generadoMotivo: string
  emitidoNombre: string | null
  emitidoEn: string | null
  firmadoRuta: string | null
  firmadoNombre: string | null
  firmadoHash: string | null
  firmadoFecha: string | null
  firmadoCargadoNombre: string | null
  firmadoCargadoEn: string | null
  firmaValidadaNombre: string | null
  firmaValidadaEn: string | null
  anuladoNombre: string | null
  anuladoEn: string | null
  anuladoMotivo: string | null
}

export interface EventoDocumento { id: string; versionId: string | null; accion: string; usuario: string; motivo: string; fecha: string }

export const BUCKET_PLANTILLAS = 'plantillas-contratos'
export const BUCKET_DOCUMENTOS = 'documentos-contratos'
export const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
