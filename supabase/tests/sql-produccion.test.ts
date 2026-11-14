// @vitest-environment node
// Cada SQL numerado de supabase/sql_produccion/ es una copia exacta de su migración, con un encabezado de control.
// Así el SQL Editor y las herramientas usan el mismo contenido. Regenerar: REGENERAR=1 npx vitest run supabase/tests/sql-produccion.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const RAIZ = path.resolve(__dirname, '..')
const CARPETA = path.join(RAIZ, 'sql_produccion')

/** Número → migración de origen. Nunca se reutiliza un número; uno nuevo va al final. */
export const SQL_PRODUCCION: [string, string, string][] = [
  ['0001', 'correo_destinatario_efectivo', '20261112010000_correo_destinatario_efectivo.sql'],
  ['0002', 'pagos_anticipados', '20261113000000_pagos_anticipados.sql'],
  ['0003', 'cumplimiento', '20261114000000_cumplimiento.sql'],
  ['0004', 'notificaciones', '20261116000000_notificaciones.sql'],
  ['0005', 'clientes_unicos_reasignacion', '20261117000000_clientes_unicos_reasignacion.sql'],
  ['0006', 'precios_lista_oficial', '20261118000000_precios_lista_oficial.sql'],
  ['0007', 'inventario_tres_estados', '20261118010000_inventario_tres_estados.sql'],
  ['0008', 'reserva_confirmacion_automatica', '20261119000000_reserva_confirmacion_automatica.sql'],
  ['0009', 'celular_unico_identificacion', '20261120000000_celular_unico_identificacion.sql'],
  ['0011', 'supervisor_vende', '20261121000000_supervisor_vende.sql'],
  ['0012', 'comisiones_vendedor', '20261122000000_comisiones_vendedor.sql'],
  ['0013', 'captacion_leads', '20261123000000_captacion_leads.sql'],
]

// Script de una sola vez (no es migración): va numerado y en el control, pero no es copia de ninguna migración.
const SCRIPTS_UNICOS = ['0010_limpieza_datos_prueba.sql', '0014_programar_leads_pendientes.sql']

const encabezado = (n: string, origen: string) =>
  `-- AMURA · SQL de producción ${n}. Copia exacta de supabase/migrations/${origen}: no editar aquí.\n` +
  `-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.\n\n`
const esperado = (n: string, origen: string) => encabezado(n, origen) + fs.readFileSync(path.join(RAIZ, 'migrations', origen), 'utf8').replace(/\r/g, '')

describe('SQL de producción numerados', () => {
  it('números consecutivos, únicos y sin reutilizar', () => {
    // Los scripts de una sola vez también ocupan su número.
    const numeros = [...SQL_PRODUCCION.map(([n]) => n), ...SCRIPTS_UNICOS.map((f) => f.slice(0, 4))].sort()
    numeros.forEach((n, i) => expect(n).toBe(String(i + 1).padStart(4, '0')))
  })

  it('cada archivo es la copia exacta de su migración', () => {
    for (const [n, nombre, origen] of SQL_PRODUCCION) {
      const archivo = path.join(CARPETA, `${n}_${nombre}.sql`)
      if (process.env.REGENERAR || !fs.existsSync(archivo)) fs.writeFileSync(archivo, esperado(n, origen))
      expect(fs.readFileSync(archivo, 'utf8').replace(/\r/g, '')).toBe(esperado(n, origen))
    }
  })

  it('no hay archivos numerados fuera de la lista', () => {
    const numerados = fs.readdirSync(CARPETA).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()
    expect(numerados).toEqual([...SQL_PRODUCCION.map(([n, nombre]) => `${n}_${nombre}.sql`), ...SCRIPTS_UNICOS].sort())
  })

  it('el control registra cada número', () => {
    const control = fs.readFileSync(path.join(CARPETA, 'CONTROL_EJECUCION.md'), 'utf8')
    for (const [n, nombre] of SQL_PRODUCCION) expect(control).toContain(`${n}_${nombre}.sql`)
  })
})
