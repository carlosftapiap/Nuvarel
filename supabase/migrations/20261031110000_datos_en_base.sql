-- AMURA · Datos de negocio en la base: precio de referencia, lista base de precios y competencia FRATELLI.
-- Antes estaban dentro de la aplicación. Ahora la aplicación no contiene datos de inventario ni de competencia.
-- Generada desde los datos actuales de la aplicación. Se puede repetir sin efecto.
-- NO APLICAR en producción sin respaldo verificado y autorización. Ejecutar después de 20261031100000_perfiles_permisos.sql.

begin;

-- 1. Precio de referencia y lista base por unidad.
alter table public.inventory_units add column if not exists precio_referencia numeric(14,2);
alter table public.inventory_units add column if not exists usd_m2_lista numeric(10,2);

update public.inventory_units u set precio_referencia = r.precio, usd_m2_lista = r.usd_m2
from (values
  ('E1-PB-A1', 2230, 161831),
  ('E1-PB-A2', 2230, 172147.2),
  ('E1-PB-A3', 2230, 128549.5),
  ('E1-PB-A4', 2230, 171188.2),
  ('E1-PB-A5', 2230, 160493),
  ('E1-P1-A1', 2260, 163737),
  ('E1-P1-A2', 2260, 163918),
  ('E1-P1-A3', 2260, 121339),
  ('E1-P1-A4', 2260, 162946),
  ('E1-P1-A5', 2260, 179421),
  ('E1-P2-A1', 2260, 163737),
  ('E1-P2-A2', 2260, 163918),
  ('E1-P2-A3', 2260, 121339),
  ('E1-P2-A4', 2260, 162946),
  ('E1-P2-A5', 2260, 179421),
  ('E1-P3-A1', 2260, 163737),
  ('E1-P3-A2', 2260, 163918),
  ('E1-P3-A3', 2260, 121339),
  ('E1-P3-A4', 2260, 162946),
  ('E1-P3-A5', 2260, 179421),
  ('E1-P4-A1', 2270, 164462),
  ('E1-P4-A2', 2270, 164643),
  ('E1-P4-A3', 2220, 119192),
  ('E1-P4-A4', 2270, 163667),
  ('E1-P4-A5', 2270, 180215),
  ('E1-P5-A1', 2270, 164462),
  ('E1-P5-A2', 2270, 164643),
  ('E1-P5-A3', 2220, 119192),
  ('E1-P5-A4', 2270, 163667),
  ('E1-P5-A5', 2270, 180215),
  ('E2-PB-A1', 2330.35, 169113),
  ('E2-PB-A2', 2330.35, 179425.2),
  ('E2-PB-A3', 2330.35, 136444.3),
  ('E2-PB-A4', 2330.35, 136304.3),
  ('E2-PB-A5', 2330.35, 178423.2),
  ('E2-PB-A6', 2330.35, 167016),
  ('E2-PB-A7', 2330.35, 128892),
  ('E2-P1-A1', 2361.7, 171389),
  ('E2-P1-A2', 2361.7, 171294),
  ('E2-P1-A3', 2361.7, 129327),
  ('E2-P1-A4', 2361.7, 129185),
  ('E2-P1-A5', 2361.7, 170279),
  ('E2-P1-A6', 2361.7, 169263),
  ('E2-P1-A7', 2361.7, 130626),
  ('E2-P2-A1', 2361.7, 171389),
  ('E2-P2-A2', 2361.7, 171294),
  ('E2-P2-A3', 2361.7, 129327),
  ('E2-P2-A4', 2361.7, 129185),
  ('E2-P2-A5', 2361.7, 170279),
  ('E2-P2-A6', 2361.7, 169263),
  ('E2-P2-A7', 2361.7, 130626),
  ('E2-P3-A1', 2361.7, 171389),
  ('E2-P3-A2', 2361.7, 171294),
  ('E2-P3-A3', 2361.7, 129327),
  ('E2-P3-A4', 2361.7, 129185),
  ('E2-P3-A5', 2361.7, 170279),
  ('E2-P3-A6', 2361.7, 169263),
  ('E2-P3-A7', 2361.7, 130626),
  ('E2-P4-A1', 2372.15, 172147),
  ('E2-P4-A2', 2372.15, 172052),
  ('E2-P4-A3', 2319.9, 127038),
  ('E2-P4-A4', 2319.9, 126899),
  ('E2-P4-A5', 2372.15, 171032),
  ('E2-P4-A6', 2372.15, 170012),
  ('E2-P4-A7', 2319.9, 128314),
  ('E2-P5-A1', 2372.15, 172147),
  ('E2-P5-A2', 2372.15, 172052),
  ('E2-P5-A3', 2319.9, 127038),
  ('E2-P5-A4', 2319.9, 126899),
  ('E2-P5-A5', 2372.15, 171032),
  ('E2-P5-A6', 2372.15, 170012),
  ('E2-P5-A7', 2319.9, 128314)
) as r(codigo, usd_m2, precio)
where r.codigo = u.codigo and (u.precio_referencia is null or u.usd_m2_lista is null);

do $$
begin
  if exists (select 1 from public.inventory_units where precio_referencia is null or usd_m2_lista is null) then
    raise exception 'Hay unidades sin precio de referencia o lista base: no se completa la migración';
  end if;
end $$;

alter table public.inventory_units alter column precio_referencia set not null;
alter table public.inventory_units alter column usd_m2_lista set not null;
alter table public.inventory_units drop constraint if exists inventory_units_precio_referencia_positivo;
alter table public.inventory_units add constraint inventory_units_precio_referencia_positivo check (precio_referencia > 0);

-- 2. Lista base de parámetros de precio (lo que restablece "Restablecer lista base").
alter table public.pricing_params add column if not exists lista_base jsonb;
update public.pricing_params set lista_base = jsonb_build_object(
  'patio_usd_m2', 230, 'reserva_pct', 6, 'cuotas_pct', 14, 'meses_e1', 30, 'meses_e2', 42)
where id = 1 and lista_base is null;
alter table public.pricing_params alter column lista_base set not null;

-- 3. Competencia FRATELLI: solo la ve quien tiene precios.competencia.
create table if not exists public.competencia_unidades (
  torre text not null,
  depto text not null,
  planta text not null,
  modelo text not null,
  dpto_m2 numeric(8,2) not null check (dpto_m2 > 0),
  bodega_m2 numeric(8,2) not null default 0,
  patio_m2 numeric(8,2) not null default 0,
  precio_base numeric(14,2) not null,
  precio_total numeric(14,2) not null,
  estado text not null,
  plazo_meses smallint not null,
  entrega_estimada text not null,
  patio_balcon text not null,
  fuente text not null default 'INVENTARIOS - LISTA DE PRECIOS INCIIAL.xlsx (FRATELLI, recibido el 26/10/2026)',
  primary key (torre, depto)
);
alter table public.competencia_unidades enable row level security;
drop policy if exists "competencia legible con permiso" on public.competencia_unidades;
create policy "competencia legible con permiso" on public.competencia_unidades for select to authenticated
  using (public.tiene_permiso('precios.competencia'));
grant select on public.competencia_unidades to authenticated;

insert into public.competencia_unidades (torre, depto, planta, modelo, dpto_m2, bodega_m2, patio_m2, precio_base, precio_total, estado, plazo_meses, entrega_estimada, patio_balcon) values
  ('A', '1-1', 'PB', 'C', 79, 1.44, 0, 175800, 172121.44, 'En negociacion', 30, '04/03/2029', 'PB sin patio*'),
  ('A', '1-2', 'PB', 'C', 79, 1.44, 0, 175800, 172121.44, 'En negociacion', 30, '04/03/2029', 'PB sin patio*'),
  ('A', '1-3', 'PB', 'A', 79, 1.5, 73.86, 175800, 188042.77, 'En negociacion', 30, '04/03/2029', 'Patio privado'),
  ('A', '1-4', 'PB', 'B', 79, 1.45, 53.75, 175800, 177927.94, 'En negociacion', 30, '04/03/2029', 'Patio privado'),
  ('A', '1-5', 'PB', 'A', 79, 1.5, 100.36, 175800, 194667.77, 'Disponible', 30, '04/03/2029', 'Patio privado'),
  ('A', '1-6', '1', 'C', 79, 1.44, 0, 170800, 174742.58, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-7', '1', 'C', 79, 1.44, 0, 170800, 174742.58, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-8', '1', 'A', 79, 1.5, 0, 170800, 172160.17, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-9', '1', 'B', 79, 1.45, 0, 170800, 166995.37, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-10', '1', 'A', 79, 1.5, 0, 170800, 172160.17, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('A', '1-11', '2', 'C', 79, 1.44, 0, 165800, 177363.71, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('A', '1-12', '2', 'C', 79, 1.44, 0, 165800, 177363.71, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('A', '1-13', '2', 'A', 79, 1.5, 0, 165800, 174742.58, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-14', '2', 'B', 79, 1.45, 0, 165800, 169500.3, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-15', '2', 'A', 79, 1.5, 0, 165800, 174742.58, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-16', '3', 'C', 79, 1.44, 0, 160800, 179984.85, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('A', '1-17', '3', 'C', 79, 1.44, 0, 160800, 179984.85, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('A', '1-18', '3', 'A', 79, 1.5, 0, 160800, 177324.98, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('A', '1-19', '3', 'B', 79, 1.45, 0, 160800, 172005.23, 'En negociacion', 30, '04/03/2029', 'Balcon'),
  ('A', '1-20', '3', 'A', 79, 1.5, 0, 160800, 177324.98, 'Disponible', 30, '04/03/2029', 'Balcon'),
  ('B', '2-1', 'PB', 'C', 79, 1.44, 0, 183800, 177135.85, 'Disponible', 36, '04/09/2029', 'PB sin patio*'),
  ('B', '2-2', 'PB', 'C', 79, 1.44, 0, 183800, 177135.85, 'Disponible', 36, '04/09/2029', 'PB sin patio*'),
  ('B', '2-3', 'PB', 'A', 79, 1.5, 90.38, 183800, 197113.08, 'Disponible', 36, '04/09/2029', 'Patio privado'),
  ('B', '2-4', 'PB', 'B', 79, 1.45, 53.57, 183800, 182675.03, 'Disponible', 36, '04/09/2029', 'Patio privado'),
  ('B', '2-5', 'PB', 'A', 79, 1.5, 102.89, 183800, 200240.58, 'Disponible', 36, '04/09/2029', 'Patio privado'),
  ('B', '2-6', '1', 'C', 79, 1.44, 0, 178800, 179833.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-7', '1', 'C', 79, 1.44, 0, 178800, 179833.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-8', '1', 'A', 79, 1.5, 0, 178800, 177175.71, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-9', '1', 'B', 79, 1.45, 0, 178800, 171860.44, 'En negociacion', 36, '04/09/2029', 'Balcon'),
  ('B', '2-10', '1', 'A', 79, 1.5, 0, 178800, 177175.71, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-11', '2', 'C', 79, 1.44, 0, 173800, 182530.85, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-12', '2', 'C', 79, 1.44, 0, 173800, 182530.85, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-13', '2', 'A', 79, 1.5, 0, 173800, 179833.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-14', '2', 'B', 79, 1.45, 0, 173800, 174438.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-15', '2', 'A', 79, 1.5, 0, 173800, 179833.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-16', '3', 'C', 79, 1.44, 0, 168800, 185228.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-17', '3', 'C', 79, 1.44, 0, 168800, 185228.35, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-18', '3', 'A', 79, 1.5, 0, 168800, 182490.98, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-19', '3', 'B', 79, 1.45, 0, 168800, 177016.25, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('B', '2-20', '3', 'A', 79, 1.5, 0, 168800, 182490.98, 'Disponible', 36, '04/09/2029', 'Balcon'),
  ('C', '3-1', 'PB', 'C', 79, 1.44, 0, 191860, 182541.65, 'Disponible', 42, '04/03/2030', 'PB sin patio*'),
  ('C', '3-2', 'PB', 'C', 79, 1.44, 0, 191800, 182541.65, 'Disponible', 42, '04/03/2030', 'PB sin patio*'),
  ('C', '3-3', 'PB', 'A', 79, 1.5, 102.89, 191800, 205566.49, 'Disponible', 42, '04/03/2030', 'Patio privado'),
  ('C', '3-4', 'PB', 'B', 79, 1.45, 53.57, 191800, 187841.17, 'Disponible', 42, '04/03/2030', 'Patio privado'),
  ('C', '3-5', 'PB', 'A', 79, 1.5, 90.39, 191800, 202441.49, 'Disponible', 42, '04/03/2030', 'Patio privado'),
  ('C', '3-6', '1', 'C', 79, 1.44, 0, 186800, 185321.48, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-7', '1', 'C', 79, 1.44, 0, 186800, 185321.48, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-8', '1', 'A', 79, 1.5, 0, 186800, 182582.74, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-9', '1', 'B', 79, 1.45, 0, 186800, 177105.25, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-10', '1', 'A', 79, 1.5, 0, 186800, 182582.74, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-11', '2', 'C', 79, 1.44, 0, 181800, 188101.3, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-12', '2', 'C', 79, 1.44, 0, 181800, 188101.3, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-13', '2', 'A', 79, 1.5, 0, 181800, 185321.48, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-14', '2', 'B', 79, 1.45, 0, 181800, 179761.83, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-15', '2', 'A', 79, 1.5, 0, 181800, 185321.48, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-16', '3', 'C', 79, 1.44, 0, 176800, 190881.12, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-17', '3', 'C', 79, 1.44, 0, 176800, 190881.12, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-18', '3', 'A', 79, 1.5, 0, 176800, 188060.22, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-19', '3', 'B', 79, 1.45, 0, 176800, 182418.41, 'Disponible', 42, '04/03/2030', 'Balcon'),
  ('C', '3-20', '3', 'A', 79, 1.5, 0, 176800, 188060.22, 'Disponible', 42, '04/03/2030', 'Balcon')
on conflict (torre, depto) do nothing;

commit;
