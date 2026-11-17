// @vitest-environment node
// Configuración de cobros: cuentas bancarias oficiales (migración 20261203000000). Nunca cuentas personales.
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { como, crearDb, crearUsuario } from './db'

let db: PGlite
let admin: string, finanzas: string, vera: string

const rpc = <T = unknown>(quien: string, sql: string, params: unknown[] = []) => como(db, quien, () => db.query<T>(sql, params))
const registrar = (quien: string, ruc: string, numero: string, motivo = 'Certificado bancario de prueba') =>
  rpc<{ id: string }>(quien, `select public.config_cuenta_registrar('NUVAREL', 'Empresa de Prueba S.A.S.', $1, 'Banco Pichincha', 'corriente', $2, $3) as id`, [ruc, numero, motivo])

beforeAll(async () => {
  db = await crearDb()
  admin = await crearUsuario(db, 'Admin', 'administrador')
  finanzas = await crearUsuario(db, 'Fina', 'finanzas', { alcance: 'empresa' })
  vera = await crearUsuario(db, 'Vera', 'asesor')
})

describe('cuentas bancarias oficiales', () => {
  it('el administrador registra una cuenta de sociedad y queda en la auditoría', async () => {
    const r = await registrar(admin, '0990000001001', '2100123456')
    expect(r.rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
    const audit = await db.query(`select 1 from public.audit_log where accion = 'Registrar cuenta de cobro'`)
    expect(audit.rows.length).toBe(1)
  })

  it('rechaza una cuenta personal (RUC de persona natural)', async () => {
    await expect(registrar(admin, '0912345678001', '2100999999')).rejects.toThrow(/persona natural/)
  })

  it('rechaza un RUC mal formado, una cuenta repetida y la falta de motivo', async () => {
    await expect(registrar(admin, '099000000100', '2100555555')).rejects.toThrow(/13 dígitos/)
    await expect(registrar(admin, '0990000001001', '2100123456')).rejects.toThrow(/ya está registrada/)
    await expect(registrar(admin, '0990000001001', '2100777777', 'no')).rejects.toThrow(/motivo/)
  })

  it('ni Finanzas ni un vendedor registran cuentas; nadie escribe la tabla directamente', async () => {
    await expect(registrar(finanzas, '0990000001001', '2100888888')).rejects.toThrow(/Sin permiso/)
    await expect(registrar(vera, '0990000001001', '2100888888')).rejects.toThrow(/Sin permiso/)
    await expect(rpc(admin, `insert into public.cuentas_receptoras (receptor, titular, ruc, banco, tipo, numero) values ('NUVAREL', 'X S.A.', '0990000001001', 'B', 'corriente', '123456')`)).rejects.toThrow()
  })

  it('desactivar exige motivo, conserva la cuenta y la oculta a los vendedores', async () => {
    const id = (await registrar(admin, '1790000002001', '3300112233')).rows[0].id
    await expect(rpc(admin, `select public.config_cuenta_desactivar($1, '')`, [id])).rejects.toThrow(/motivo/)
    await rpc(admin, `select public.config_cuenta_desactivar($1, 'Cuenta cerrada por el banco')`, [id])
    const paraVendedor = await rpc<{ id: string }>(vera, `select id from public.cuentas_receptoras`)
    expect(paraVendedor.rows.map((r) => r.id)).not.toContain(id)
    const paraAdmin = await rpc<{ id: string; activa: boolean; motivo_baja: string }>(admin, `select id, activa, motivo_baja from public.cuentas_receptoras where id = $1`, [id])
    expect(paraAdmin.rows[0]).toMatchObject({ activa: false, motivo_baja: 'Cuenta cerrada por el banco' })
  })
})
