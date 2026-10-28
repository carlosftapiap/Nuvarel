-- AMURA · Módulo de Inventario
-- Autorización efectiva en base de datos: lectura con RLS y escritura sólo mediante RPC con verificación de rol.
-- Pendiente de aplicar en el proyecto Supabase (requiere acceso de administrador al proyecto).

create type public.app_role as enum ('administrador', 'gerencia', 'asesor', 'corredor');
create type public.estado_comercial as enum ('por_confirmar', 'disponible', 'bloqueado', 'reservado', 'promesa', 'vendido', 'no_disponible');

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now()
);
alter table public.user_roles enable row level security;
create policy "cada usuario ve su rol" on public.user_roles for select to authenticated using (user_id = auth.uid());

create or replace function public.current_app_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.user_roles where user_id = auth.uid()
$$;

create table public.inventory_units (
  codigo text primary key check (codigo ~ '^E[12]-(PB|P[1-5])-A[1-7]$'),
  dpt text not null unique,
  edificio smallint not null check (edificio in (1, 2)),
  piso text not null check (piso in ('PB', '1', '2', '3', '4', '5')),
  posicion smallint not null check (posicion between 1 and 7),
  ubicacion text not null,
  tipologia text not null check (tipologia in ('1 hab', '2 hab', '2 hab + estudio')),
  area_m2 numeric(8,2) not null check (area_m2 > 0),
  bodega_codigo text,
  bodega_m2 numeric(6,2) not null default 0 check (bodega_m2 >= 0),
  patio_m2 numeric(8,2) not null default 0 check (patio_m2 >= 0),
  usd_m2 numeric(10,2) not null check (usd_m2 between 500 and 10000),
  estado public.estado_comercial not null default 'por_confirmar',
  reserva_id uuid,
  notas text not null default '' check (char_length(notas) <= 500),
  plano_path text,
  imagenes text[] not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create table public.pricing_params (
  id smallint primary key default 1 check (id = 1),
  patio_usd_m2 numeric(10,2) not null check (patio_usd_m2 between 0 and 5000),
  reserva_pct numeric(5,2) not null check (reserva_pct between 0 and 100),
  cuotas_pct numeric(5,2) not null check (cuotas_pct between 0 and 100),
  meses_e1 smallint not null check (meses_e1 between 1 and 120),
  meses_e2 smallint not null check (meses_e2 between 1 and 120),
  check (reserva_pct + cuotas_pct <= 100)
);
insert into public.pricing_params values (1, 230, 6, 14, 30, 42);

create table public.inventory_price_history (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  user_id uuid not null references auth.users (id),
  rol public.app_role not null,
  tipo text not null check (tipo in ('precio_m2', 'porcentaje', 'importacion', 'parametros', 'restablecer')),
  alcance text not null,
  motivo text not null check (char_length(motivo) >= 5),
  detalle text not null,
  cambios jsonb not null,
  total_antes numeric(14,2) not null,
  total_despues numeric(14,2) not null
);

create table public.inventory_status_history (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  user_id uuid not null references auth.users (id),
  rol public.app_role not null,
  codigo text not null references public.inventory_units (codigo),
  de public.estado_comercial not null,
  a public.estado_comercial not null,
  motivo text not null check (char_length(motivo) >= 5),
  reserva_id uuid
);

-- Lectura: usuarios con rol asignado. Sin políticas de escritura: sólo las RPC pueden modificar.
alter table public.inventory_units enable row level security;
alter table public.pricing_params enable row level security;
alter table public.inventory_price_history enable row level security;
alter table public.inventory_status_history enable row level security;
create policy "leer inventario" on public.inventory_units for select to authenticated using (public.current_app_role() is not null);
create policy "leer parametros" on public.pricing_params for select to authenticated using (public.current_app_role() is not null);
create policy "leer historial precios" on public.inventory_price_history for select to authenticated using (public.current_app_role() in ('administrador', 'gerencia', 'asesor'));
create policy "leer historial estados" on public.inventory_status_history for select to authenticated using (public.current_app_role() in ('administrador', 'gerencia', 'asesor'));

-- Misma regla que src/features/inventario/pricing.ts
create or replace function public.precio_venta(p_area numeric, p_bodega numeric, p_patio numeric, p_usd_m2 numeric, p_patio_usd numeric)
returns numeric language sql immutable as $$
  select round(p_usd_m2 * (p_area + p_bodega)) + round(p_patio * p_patio_usd, 2)
$$;

create or replace function public.inventario_ajustar_precio(
  p_modo text, p_valor numeric, p_motivo text,
  p_codigos text[] default null, p_edificio smallint default null, p_piso text default null, p_tipologia text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_rol public.app_role := public.current_app_role();
  v_patio numeric;
  v_cambios jsonb;
  v_id uuid;
begin
  if v_rol is null or v_rol not in ('administrador', 'gerencia') then
    raise exception 'Sin permiso para modificar precios' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Motivo obligatorio'; end if;
  if p_modo not in ('fijar', 'porcentaje') then raise exception 'Modo inválido'; end if;
  if p_modo = 'fijar' and (p_valor < 500 or p_valor > 10000) then raise exception 'USD/m2 fuera de rango'; end if;
  if p_modo = 'porcentaje' and (p_valor = 0 or abs(p_valor) > 50) then raise exception 'Porcentaje fuera de rango'; end if;
  select patio_usd_m2 into v_patio from pricing_params where id = 1;

  with objetivo as (
    select u.*, case when p_modo = 'fijar' then round(p_valor, 2) else round(u.usd_m2 * (1 + p_valor / 100), 2) end as nuevo
    from inventory_units u
    where (p_codigos is null or u.codigo = any (p_codigos))
      and (p_edificio is null or u.edificio = p_edificio)
      and (p_piso is null or u.piso = p_piso)
      and (p_tipologia is null or u.tipologia = p_tipologia)
      and u.estado not in ('reservado', 'promesa', 'vendido')
  ), upd as (
    update inventory_units u set usd_m2 = o.nuevo, updated_at = now(), updated_by = auth.uid()
    from objetivo o where u.codigo = o.codigo and o.nuevo <> o.usd_m2
    returning u.codigo, o.usd_m2 as antes, o.nuevo as despues, o.area_m2, o.bodega_m2, o.patio_m2
  )
  select jsonb_agg(jsonb_build_object(
    'codigo', codigo, 'antesUsdM2', antes, 'despuesUsdM2', despues,
    'antesPrecio', precio_venta(area_m2, bodega_m2, patio_m2, antes, v_patio),
    'despuesPrecio', precio_venta(area_m2, bodega_m2, patio_m2, despues, v_patio)))
  into v_cambios from upd;

  if v_cambios is null then raise exception 'El cambio no modifica ningún precio'; end if;
  insert into inventory_price_history (user_id, rol, tipo, alcance, motivo, detalle, cambios, total_antes, total_despues)
  values (
    auth.uid(), v_rol, case when p_modo = 'fijar' then 'precio_m2' else 'porcentaje' end,
    coalesce(nullif(concat_ws(' · ',
      case when p_codigos is not null then array_length(p_codigos, 1) || ' unidades' end,
      case when p_edificio is not null then 'Edificio ' || p_edificio end,
      case when p_piso is not null then 'Piso ' || p_piso end,
      p_tipologia), ''), 'Todo el proyecto'),
    trim(p_motivo), p_modo || ' ' || p_valor, v_cambios,
    (select sum((c ->> 'antesPrecio')::numeric) from jsonb_array_elements(v_cambios) c),
    (select sum((c ->> 'despuesPrecio')::numeric) from jsonb_array_elements(v_cambios) c))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.inventario_cambiar_estado(p_codigo text, p_estado public.estado_comercial, p_motivo text, p_reserva_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol public.app_role := public.current_app_role();
  v_actual public.estado_comercial;
  v_ok boolean;
begin
  if v_rol is null or v_rol not in ('administrador', 'gerencia') then
    raise exception 'Sin permiso para cambiar estados' using errcode = '42501';
  end if;
  if char_length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Motivo obligatorio'; end if;
  select estado into v_actual from inventory_units where codigo = p_codigo for update;
  if not found then raise exception 'Unidad inexistente'; end if;
  v_ok := case v_actual
    when 'por_confirmar' then p_estado <> 'por_confirmar'
    when 'disponible' then p_estado in ('bloqueado', 'reservado', 'no_disponible')
    when 'bloqueado' then p_estado in ('disponible', 'reservado', 'no_disponible')
    when 'reservado' then p_estado in ('disponible', 'promesa')
    when 'promesa' then p_estado in ('vendido', 'disponible')
    when 'no_disponible' then p_estado in ('disponible', 'bloqueado')
    else false end;
  if not v_ok then raise exception 'Transición no permitida: % -> %', v_actual, p_estado; end if;
  update inventory_units set
    estado = p_estado,
    reserva_id = case when p_estado in ('disponible', 'bloqueado', 'no_disponible') then null else coalesce(p_reserva_id, reserva_id) end,
    updated_at = now(), updated_by = auth.uid()
  where codigo = p_codigo;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), v_rol, p_codigo, v_actual, p_estado, trim(p_motivo), p_reserva_id);
end $$;

revoke all on function public.inventario_ajustar_precio(text, numeric, text, text[], smallint, text, text) from public, anon;
revoke all on function public.inventario_cambiar_estado(text, public.estado_comercial, text, uuid) from public, anon;
grant execute on function public.inventario_ajustar_precio(text, numeric, text, text[], smallint, text, text) to authenticated;
grant execute on function public.inventario_cambiar_estado(text, public.estado_comercial, text, uuid) to authenticated;
