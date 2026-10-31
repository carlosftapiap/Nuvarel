-- AMURA · Comisión base sobre el valor total de cada venta firmada. Porcentaje inicial 2,60 %, editable por Gerencia y auditado.
-- Es solo un monto de referencia: no crea pagos, liquidaciones ni repartos entre personas. Eso queda pendiente de la política aprobada.
-- Ejecutar después de 20261031020000_ventas_contratos.sql.

do $$ begin
  if to_regclass('public.contracts') is null or to_regprocedure('public.clientes_motivo(text)') is null then
    raise exception 'Falta Ventas y contratos o Clientes: aplica antes 20261031000000_clientes_crm.sql y 20261031020000_ventas_contratos.sql';
  end if;
end $$;

insert into public.permissions (clave, modulo, descripcion) values
  ('comisiones.calcular', 'Comisiones', 'Consultar y cambiar el porcentaje base')
on conflict (clave) do nothing;

create table if not exists public.comision_parametros (
  id smallint primary key default 1 check (id = 1),
  porcentaje_base numeric(5,2) not null default 2.60 check (porcentaje_base >= 0 and porcentaje_base <= 100),
  definido_por uuid references auth.users (id),
  definido_nombre text,
  definido_en timestamptz,
  motivo text
);
insert into public.comision_parametros (id) values (1) on conflict (id) do nothing;
alter table public.comision_parametros enable row level security;
drop policy if exists "ver porcentaje de comision" on public.comision_parametros;
create policy "ver porcentaje de comision" on public.comision_parametros for select to authenticated
  using (public.tiene_permiso('comisiones.ver_propias') or public.tiene_permiso('comisiones.calcular'));
-- Sin políticas de escritura: solo la función siguiente.

create or replace function public.comisiones_porcentaje() returns numeric
language sql stable security definer set search_path = public as $$
  select porcentaje_base from comision_parametros where id = 1
$$;

create or replace function public.comisiones_definir_porcentaje(p_porcentaje numeric, p_motivo text) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); v_anterior numeric; v_nombre text; v_nuevo numeric := round(p_porcentaje, 2);
begin
  if not public.tiene_permiso('comisiones.calcular') then raise exception 'Sin permiso para cambiar el porcentaje de comisión' using errcode = '42501'; end if;
  if p_porcentaje is null or p_porcentaje < 0 or p_porcentaje > 100 then raise exception 'El porcentaje debe estar entre 0 y 100'; end if;
  select porcentaje_base into v_anterior from comision_parametros where id = 1 for update;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_parametros set porcentaje_base = v_nuevo, definido_por = auth.uid(), definido_nombre = v_nombre, definido_en = now(), motivo = v_m where id = 1;
  perform public.auditar('Cambiar porcentaje de comisión base', 'comisiones', 'base', v_m, jsonb_build_object('porcentaje', v_anterior), jsonb_build_object('porcentaje', v_nuevo));
  return v_nuevo;
end $$;

-- Ventas firmadas dentro del alcance de quien consulta. Una venta anulada deja de contar.
create or replace function public.comisiones_base_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_pct numeric := public.comisiones_porcentaje();
begin
  if not (public.tiene_permiso('comisiones.ver_propias') or public.tiene_permiso('comisiones.calcular')) then raise exception 'Sin permiso para ver comisiones' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('contrato', k.codigo, 'estado', k.estado, 'cliente', c.nombre, 'unidad', k.codigo_unidad,
      'fecha', k.fecha_contrato, 'precio', k.precio, 'porcentaje', v_pct, 'monto', round(k.precio * v_pct / 100, 2))
      order by k.fecha_contrato desc, k.codigo)
    from contracts k join clients c on c.id = k.client_id
    where k.estado = 'firmado' and public.cliente_en_alcance(k.client_id)
  ), '[]'::jsonb);
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['public.comisiones_porcentaje()', 'public.comisiones_definir_porcentaje(numeric, text)', 'public.comisiones_base_listar()'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
