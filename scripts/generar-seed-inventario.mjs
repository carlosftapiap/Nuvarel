// Genera supabase/seed.sql a partir de src/features/inventario/__tests__/datos/amura-units.ts (72 unidades verificadas).
// Uso: node scripts/generar-seed-inventario.mjs
import fs from 'node:fs'

const src = fs.readFileSync(new URL('../src/features/inventario/__tests__/datos/amura-units.ts', import.meta.url), 'utf8')
const rows = [...src.matchAll(/^ {2}\[(".*)\],$/gm)].map((m) => JSON.parse(`[${m[1]}]`))
if (rows.length !== 72) throw new Error(`Se esperaban 72 unidades y hay ${rows.length}`)

const q = (v) => (v === null ? 'null' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v))
const valores = rows.map((r) => `  (${r.slice(0, 12).map(q).join(', ')})`).join(',\n')
const sql = `-- Semilla de los 72 departamentos de AMURA (lista base 28/10/2026). Estado inicial: por_confirmar.
-- Generado por scripts/generar-seed-inventario.mjs; no editar a mano.
insert into public.inventory_units (codigo, dpt, edificio, piso, posicion, ubicacion, tipologia, area_m2, bodega_codigo, bodega_m2, patio_m2, usd_m2) values
${valores}
on conflict (codigo) do nothing;
`
fs.writeFileSync(new URL('../supabase/seed.sql', import.meta.url), sql)
console.log(`supabase/seed.sql: ${rows.length} unidades`)
