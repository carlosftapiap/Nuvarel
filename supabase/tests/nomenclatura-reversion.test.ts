// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { crearDb, crearUsuario } from './db'
const leer=(f: string)=>fs.readFileSync(path.resolve(__dirname,'..',f),'utf8')

describe('recuperación de nomenclatura', () => {
  it('0016 incorpora todo el bloque de 0015 dentro de una sola transacción',()=>{
    const anterior=leer('migrations/20261124000000_nomenclatura_comercial.sql').replace(/\r/g,'')
    const bloque=anterior.slice(anterior.indexOf('begin;\n')+7,anterior.lastIndexOf('commit;')).trim()
    const nueva=leer('migrations/20261125000000_nomenclatura_documentos_seguros.sql').replace(/\r/g,'')
    expect(nueva).toContain(`-- INICIO BLOQUE 0015\n${bloque}\n-- FIN BLOQUE 0015`)
    expect(nueva.match(/^begin;$/gm)).toHaveLength(1)
    expect(nueva.match(/^commit;$/gm)).toHaveLength(1)
  })
  it('revierte antes de emitir documentos, restaura textos exactos y mantiene las protecciones aditivas', async () => {
    const db=await crearDb({ hasta:'20261124000000_nomenclatura_comercial.sql' })
    await crearUsuario(db,'Admin','administrador')
    await db.exec(leer('carga/plan_amura_inicial.sql').replace('REEMPLAZAR@correo.com','admin@prueba.local'))
    await db.exec(leer('migrations/20261125000000_nomenclatura_documentos_seguros.sql'))
    await db.exec(leer('sql_produccion/reversion/0016_revertir_nomenclatura_documentos.sql'))
    await db.exec(leer('sql_produccion/reversion/0015_revertir_nomenclatura_comercial.sql'))
    expect((await db.query("select count(*)::int n from inventory_units where dpt ~ '^[12][0-5]0[1-7]$'")).rows[0].n).toBe(72)
    expect((await db.query("select nombre from obra_frentes where codigo='edificio1'")).rows[0].nombre).toBe('Edificio 1')
    expect((await db.query("select nombre from plan_activities where codigo='Z03'")).rows[0].nombre).toContain('edificio 1')
    expect((await db.query("select count(*)::int n from pg_trigger where tgname='quotes_unidad_snapshot'")).rows[0].n).toBe(1)
    await db.close()
  },120_000)
  it('cancela 0015 por una posición incoherente sin dejar actualizaciones parciales',async () => {
    const db=await crearDb({ hasta:'20261123000000_captacion_leads.sql' })
    await db.query("update inventory_units set posicion=6,dpt='1006' where codigo='E1-PB-A5'")
    const antes=(await db.query('select to_jsonb(u) fila from inventory_units u order by codigo')).rows
    await expect(db.exec(leer('migrations/20261124000000_nomenclatura_comercial.sql'))).rejects.toThrow(/mapeo aprobado/)
    await db.exec('rollback')
    expect((await db.query('select to_jsonb(u) fila from inventory_units u order by codigo')).rows).toEqual(antes)
    expect((await db.query("select to_regclass('public.nomenclatura_textos_respaldo') tabla")).rows[0].tabla).toBeNull()
    await db.close()
  },120_000)
})
