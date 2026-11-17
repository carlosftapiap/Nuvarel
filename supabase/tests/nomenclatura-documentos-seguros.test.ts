// @vitest-environment node
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { aCotizacion } from '@/features/cotizaciones/remoto'
import { construirPdfCotizacion } from '@/features/cotizaciones/pdf'
import { numeroComercial } from '@/features/inventario/nomenclatura'
import { cedulaPrueba, celularPrueba, como, crearDb, crearUsuario } from './db'
import { prepararReservasParaPago } from './db'

const migracion = fs.readFileSync(path.resolve(__dirname, '../migrations/20261125000000_nomenclatura_documentos_seguros.sql'), 'utf8')
let db: PGlite, vendedor: string, finanzas: string, legal: string
let legado: { q: string; r: string }, quoteAnterior: Record<string, unknown>, inventario: unknown[], relaciones: unknown[]
let n = 991700000
const uno = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]
const rpc = (usuario: string, sql: string, params: unknown[] = []) => como(db, usuario, () => uno<{ id: string }>(sql, params))
const archivo = (r: string) => JSON.stringify({ ruta: `reservas/${r}/banco.pdf`, nombre: 'banco.pdf', mime: 'application/pdf', tamano: 100, hash: 'abc' })
async function operacion(codigo: string) {
  const cl = (await rpc(vendedor, 'select public.clientes_crear(null,$1::jsonb,$2) id', [JSON.stringify({ nombre: `Comprador ${++n}`, telefono: celularPrueba(n), documento: cedulaPrueba(n), origen: 'instagram' }), vendedor])).id
  const op = (await rpc(vendedor, 'select public.oportunidades_crear($1,$2,null) id', [cl,codigo])).id
  const q = (await rpc(vendedor, "select public.cotizaciones_emitir($1,0,30,'') id", [op])).id
  const r = (await rpc(vendedor, 'select public.reservas_solicitar_acordada($1,600) id', [q])).id
  return { cl,op,q,r }
}

beforeAll(async () => {
  db = await crearDb({ hasta: '20261123000000_captacion_leads.sql' })
  const admin = await crearUsuario(db,'Admin','administrador')
  vendedor = await crearUsuario(db,'Vendedor','asesor')
  finanzas = await crearUsuario(db,'Finanzas','finanzas',{ alcance: 'empresa' })
  legal = await crearUsuario(db,'Legal','legal',{ alcance: 'empresa' })
  await rpc(admin,"select public.config_definir_receptor('NUVAREL','Prueba de nomenclatura')")
  legado = await operacion('E1-PB-A1')
  quoteAnterior = await uno('select * from public.quotes where id=$1',[legado.q])
  inventario = (await db.query<{ fila: { codigo: string; dpt: string } }>('select to_jsonb(u) fila from public.inventory_units u order by codigo')).rows.map((r)=>({ ...r.fila,dpt:numeroComercial(r.fila.codigo) }))
  relaciones = (await db.query("select conname,pg_get_constraintdef(oid) definicion from pg_constraint where contype='f' and confrelid='public.inventory_units'::regclass order by conname")).rows
  await db.exec(migracion)
},120_000)

describe('equivalencias e integridad', () => {
  it('conserva todos los datos de las 72 unidades y las siete FK exactamente',async () => {
    expect((await db.query("select to_jsonb(u)-'dpt_anterior' fila from public.inventory_units u order by codigo")).rows.map((r) => r.fila)).toEqual(inventario)
    expect((await db.query("select conname,pg_get_constraintdef(oid) definicion from pg_constraint where contype='f' and confrelid='public.inventory_units'::regclass order by conname")).rows).toEqual(relaciones)
    expect(relaciones).toHaveLength(7)
    const filas=(await db.query<{ codigo: string; dpt: string; dpt_anterior: string }>('select codigo,dpt,dpt_anterior from inventory_units')).rows
    expect(filas).toHaveLength(72)
    expect(new Set(filas.map((r)=>r.dpt)).size).toBe(72)
    for(const r of filas) {
      for(const alias of [r.codigo,r.dpt,r.dpt_anterior]) expect((await uno('select inventario_resolver_codigo($1) codigo',[` ${alias.toLowerCase()} `])).codigo).toBe(r.codigo)
    }
    for(const valor of ['A006','B008','E1-PB-A6','E2-P6-A1','inventado']) expect((await uno('select inventario_resolver_codigo($1) codigo',[valor])).codigo).toBeNull()
  })
  it('el control de producción es de solo lectura y comprueba las siete relaciones con datos reales',async()=>{
    const antes=(await db.query('select to_jsonb(u) fila from inventory_units u order by codigo')).rows
    const consulta=fs.readFileSync(path.resolve(__dirname,'../sql_produccion/verificacion/verificar_nomenclatura_documentos.sql'),'utf8')
    const resultados=await db.exec(consulta)
    expect(resultados[0].rows).toHaveLength(72)
    expect(resultados[2].rows).toHaveLength(7)
    expect(resultados[2].rows.every((r)=>Number(r.huerfanas)===0)).toBe(true)
    expect((await db.query('select to_jsonb(u) fila from inventory_units u order by codigo')).rows).toEqual(antes)
  })

  it('una oportunidad comercial y su reserva mantienen la clave técnica y el mismo cliente',async () => {
    const o=await operacion('B001')
    const fila=await uno('select codigo_unidad,client_id from reservations where id=$1',[o.r])
    expect(fila).toMatchObject({ codigo_unidad:'E2-PB-A1',client_id:o.cl })
    expect((await uno('select unidades_interes from clients where id=$1',[o.cl])).unidades_interes).toEqual(['E2-PB-A1'])
    const datos=await uno('select clientes_datos($1::jsonb) d',[JSON.stringify({ nombre:'Otro cliente',telefono:celularPrueba(++n),origen:'instagram',unidades_interes:['2101','B101','E2-P1-A1'] })])
    expect((datos.d as { unidades_interes: string[] }).unidades_interes).toEqual(['E2-P1-A1'])
    const avisos=(await db.query<{ asunto: string }>('select asunto from cobranza_alertas')).rows
    expect(avisos.every((a)=>!a.asunto.includes('E1-') && !a.asunto.includes('E2-'))).toBe(true)
  })
  it('las funciones privadas de documentos no amplían el acceso de los perfiles',async()=>{
    expect((await uno("select has_function_privilege('authenticated','public.documento_unidad_snapshot(text)','EXECUTE') permite")).permite).toBe(false)
    expect((await uno("select has_function_privilege('anon','public.inventario_resolver_codigo(text)','EXECUTE') permite")).permite).toBe(false)
  })
})

describe('documentos originales', () => {
  it('no rellena un histórico con el inventario actual y bloquea su reconstrucción',async () => {
    const fila=await uno('select * from quotes where id=$1',[legado.q])
    const { unidad_snapshot, ...resto }=fila
    expect(unidad_snapshot).toBeNull()
    expect(resto).toEqual(quoteAnterior)
    const c=aCotizacion(fila,[{ codigo:'E1-PB-A1',dpt:'A001' } as never])!
    expect(c.documentoDisponible).toBe(false)
    expect(()=>construirPdfCotizacion(c)).toThrow(/histórico.*instantánea/)
  })

  it('una cotización nueva conserva su unidad y su PDF aunque cambie Inventario o no esté cargado',async () => {
    const { q }=await operacion('A002')
    const fila=await uno('select * from quotes where id=$1',[q])
    const antes=aCotizacion(fila,[])!
    const pdf=construirPdfCotizacion(antes).output()
    await db.query("update inventory_units set area_m2=area_m2+1,usd_m2=usd_m2+10,parqueo='NUEVO' where codigo='E1-PB-A2'")
    const despues=aCotizacion(await uno('select * from quotes where id=$1',[q]),[])!
    expect(despues.unidad).toEqual(antes.unidad)
    expect(despues.plan).toEqual(antes.plan)
    expect(pdf).toContain('Departamento A002')
    expect(construirPdfCotizacion(despues).output()).toContain('Edificio A')
    expect(despues.unidad.parqueo).not.toBe('NUEVO')
    await expect(db.query("update quotes set unidad_snapshot='{}' where id=$1",[q])).rejects.toThrow(/instantánea/)
  })

  it('congela la constancia con el medio correcto y el recibo con la unidad de emisión',async () => {
    const { r }=await operacion('A003')
    await rpc(vendedor,"select reservas_reportar_pago($1,600,(now() at time zone 'America/Guayaquil')::date,'Banco','CHQ-ORIGINAL',$2::jsonb,'cheque') id",[r,archivo(r)])
    const c=await uno('select * from comprobantes_pago where reservation_id=$1',[r])
    const snap=c.constancia_snapshot as { departamento: string; comprobante: { medio: string }; estadoEmision: string }
    expect(snap).toMatchObject({ departamento:'A003',estadoEmision:'reportado',comprobante:{ medio:'cheque' } })
    await prepararReservasParaPago(db)
    await rpc(finanzas,"select reservas_confirmar_pago($1,600,(now() at time zone 'America/Guayaquil')::date,'CHQ-ORIGINAL',true,'') id",[r])
    const recibo=await uno('select * from recibos_pago where reservation_id=$1',[r])
    expect(recibo.unidad_snapshot).toMatchObject({ dpt:'A003',edificioNombre:'Edificio A' })
    expect((await uno('select constancia_snapshot from comprobantes_pago where id=$1',[c.id])).constancia_snapshot).toEqual(snap)
    await expect(db.query("update comprobantes_pago set constancia_snapshot='{}' where id=$1",[c.id])).rejects.toThrow(/original/)
    await expect(db.query("update recibos_pago set unidad_snapshot='{}' where id=$1",[recibo.id])).rejects.toThrow(/instantánea/)
    const contrato=(await rpc(legal,"select contratos_crear($1,(now() at time zone 'America/Guayaquil')::date,'Prueba de documento') id",[r])).id
    const datos=await como(db,legal,()=>uno("select contratos_datos_documento($1,'{}') d",[contrato]))
    expect((datos.d as { unidad: unknown }).unidad).toMatchObject({ codigo:'A003',codigo_interno:'E1-PB-A3',numero_anterior:'1003',edificio:'A' })
    await expect(db.query('select nomenclatura_permitir_reversion()')).rejects.toThrow(/documentos emitidos/)
  })
})
