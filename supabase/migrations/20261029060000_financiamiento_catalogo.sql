-- AMURA · Catálogo de productos hipotecarios y simulaciones guardadas.
-- Ejecutar después de 20261029050000_cobranza_cronograma.sql y volver a ejecutar supabase/seed_roles.sql (permiso financiamiento.catalogo).
-- ESTADO: probado en base local. NO aplicado en producción.
-- El catálogo empieza vacío: las tasas se cargan desde la app con fuente y fecha verificadas. No se incluyen tasas inventadas.
-- Cada cambio crea una versión nueva; una simulación guarda la versión y las condiciones usadas, así una actualización no altera cotizaciones anteriores.

do $$ begin
  if to_regprocedure('public.tiene_permiso(text)') is null or to_regprocedure('public.auditar(text, text, text, text, jsonb, jsonb, text)') is null then
    raise exception 'Faltan dependencias: instala antes usuarios, permisos y el flujo comercial';
  end if;
end $$;

create table if not exists public.bank_products (
  id uuid primary key default gen_random_uuid(),
  clave text not null check (clave ~ '^[A-Z0-9][A-Z0-9_-]{1,40}$'),
  version int not null,
  entidad text not null check (char_length(trim(entidad)) >= 2),
  producto text not null check (char_length(trim(producto)) >= 2),
  tipo_tasa text not null check (tipo_tasa in ('fija', 'variable')),
  tasa_nominal numeric(7,4) check (tasa_nominal is null or tasa_nominal between 0 and 50),
  tramos jsonb not null default '[]'::jsonb,
  plazo_min_meses int not null check (plazo_min_meses between 1 and 600),
  plazo_max_meses int not null check (plazo_max_meses between 1 and 600),
  financiamiento_max_pct numeric(5,2) check (financiamiento_max_pct is null or financiamiento_max_pct between 1 and 100),
  monto_max numeric(14,2) check (monto_max is null or monto_max > 0),
  desgravamen_pct_mensual numeric(7,4) check (desgravamen_pct_mensual is null or desgravamen_pct_mensual between 0 and 5),
  incendio_pct_anual numeric(7,4) check (incendio_pct_anual is null or incendio_pct_anual between 0 and 5),
  gastos_fijos numeric(14,2) check (gastos_fijos is null or gastos_fijos >= 0),
  avaluo numeric(14,2) check (avaluo is null or avaluo >= 0),
  fuente text not null check (char_length(trim(fuente)) >= 5),
  fecha_fuente date not null,
  vigente boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  unique (clave, version),
  check (plazo_max_meses >= plazo_min_meses),
  check (tasa_nominal is not null or jsonb_array_length(tramos) > 0)
);
create unique index if not exists bank_products_una_vigente on public.bank_products (clave) where vigente;

-- Simulación guardada para la cotización integral: congela el producto (versión) y los resultados.
create table if not exists public.mortgage_simulations (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  codigo_unidad text not null references public.inventory_units (codigo),
  client_id uuid references public.clients (id),
  cliente_nombre text not null,
  bank_product_id uuid references public.bank_products (id),
  escenario text not null check (escenario in ('catalogo', 'manual')),
  condiciones jsonb not null,
  resultado jsonb not null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

alter table public.bank_products enable row level security;
alter table public.mortgage_simulations enable row level security;
drop policy if exists "ver productos bancarios" on public.bank_products;
drop policy if exists "ver simulaciones" on public.mortgage_simulations;
create policy "ver productos bancarios" on public.bank_products for select to authenticated
  using (public.tiene_permiso('financiamiento.simular') or public.tiene_permiso('financiamiento.catalogo'));
create policy "ver simulaciones" on public.mortgage_simulations for select to authenticated
  using (public.tiene_permiso('financiamiento.simular') and public.en_alcance(created_by));
-- Sin políticas de escritura: solo las funciones siguientes.

-- Crea la versión siguiente de un producto (o la primera). La anterior queda en el historial, no vigente.
create or replace function public.financiamiento_guardar_producto(p_clave text, p_datos jsonb, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_clave text := upper(trim(p_clave)); v_version int; v_id uuid; v_antes jsonb;
begin
  if not public.tiene_permiso('financiamiento.catalogo') then raise exception 'Sin permiso para administrar el catálogo bancario' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if char_length(trim(coalesce(p_datos ->> 'fuente', ''))) < 5 then raise exception 'Indica la fuente verificada de la tasa'; end if;
  if nullif(p_datos ->> 'fecha_fuente', '') is null then raise exception 'Indica la fecha de la fuente'; end if;
  select to_jsonb(b) into v_antes from bank_products b where clave = v_clave and vigente;
  select coalesce(max(version), 0) + 1 into v_version from bank_products where clave = v_clave;
  update bank_products set vigente = false where clave = v_clave and vigente;
  insert into bank_products (clave, version, entidad, producto, tipo_tasa, tasa_nominal, tramos, plazo_min_meses, plazo_max_meses,
    financiamiento_max_pct, monto_max, desgravamen_pct_mensual, incendio_pct_anual, gastos_fijos, avaluo, fuente, fecha_fuente)
  values (v_clave, v_version, trim(p_datos ->> 'entidad'), trim(p_datos ->> 'producto'), p_datos ->> 'tipo_tasa',
    nullif(p_datos ->> 'tasa_nominal', '')::numeric, coalesce(p_datos -> 'tramos', '[]'::jsonb),
    (p_datos ->> 'plazo_min_meses')::int, (p_datos ->> 'plazo_max_meses')::int,
    nullif(p_datos ->> 'financiamiento_max_pct', '')::numeric, nullif(p_datos ->> 'monto_max', '')::numeric,
    nullif(p_datos ->> 'desgravamen_pct_mensual', '')::numeric, nullif(p_datos ->> 'incendio_pct_anual', '')::numeric,
    nullif(p_datos ->> 'gastos_fijos', '')::numeric, nullif(p_datos ->> 'avaluo', '')::numeric,
    trim(p_datos ->> 'fuente'), (p_datos ->> 'fecha_fuente')::date)
  returning id into v_id;
  perform public.auditar('Producto bancario v' || v_version, 'producto_bancario', v_clave, trim(p_motivo), v_antes,
    (select to_jsonb(b) from bank_products b where b.id = v_id));
  return v_id;
end $$;

create or replace function public.financiamiento_retirar_producto(p_clave text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_permiso('financiamiento.catalogo') then raise exception 'Sin permiso para administrar el catálogo bancario' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  update bank_products set vigente = false where clave = upper(trim(p_clave)) and vigente;
  if not found then raise exception 'El producto no está vigente'; end if;
  perform public.auditar('Retirar producto bancario', 'producto_bancario', upper(trim(p_clave)), trim(p_motivo), null, null);
end $$;

-- Guarda la simulación con la versión exacta del producto (copiada desde la base, no desde el navegador).
create or replace function public.financiamiento_guardar_simulacion(p_unidad text, p_cliente uuid, p_cliente_nombre text, p_producto uuid, p_condiciones jsonb, p_resultado jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_numero text; v_prefijo text := 'SIM-' || to_char(now() at time zone 'America/Guayaquil', 'YYYY') || '-'; v_cond jsonb := p_condiciones;
begin
  if not public.tiene_permiso('financiamiento.simular') then raise exception 'Sin permiso para simular' using errcode = '42501'; end if;
  if not exists (select 1 from inventory_units where codigo = p_unidad) then raise exception 'Unidad inexistente'; end if;
  if char_length(trim(coalesce(p_cliente_nombre, ''))) < 3 then raise exception 'Indica el nombre del cliente'; end if;
  if p_cliente is not null and not public.cliente_en_alcance(p_cliente) then raise exception 'Cliente fuera de tu alcance' using errcode = '42501'; end if;
  if p_producto is not null then
    if not exists (select 1 from bank_products where id = p_producto) then raise exception 'Producto bancario inexistente'; end if;
    v_cond := v_cond || jsonb_build_object('producto', (select to_jsonb(b) - 'created_by' from bank_products b where b.id = p_producto));
  end if;
  v_numero := v_prefijo || lpad((coalesce((select max(substring(numero from char_length(v_prefijo) + 1)::int) from mortgage_simulations
                                            where numero ~ ('^' || v_prefijo || '[0-9]+$')), 0) + 1)::text, 4, '0');
  insert into mortgage_simulations (numero, codigo_unidad, client_id, cliente_nombre, bank_product_id, escenario, condiciones, resultado)
  values (v_numero, p_unidad, p_cliente, trim(p_cliente_nombre), p_producto, case when p_producto is null then 'manual' else 'catalogo' end, v_cond, p_resultado)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'condiciones', v_cond);
end $$;

revoke all on function public.financiamiento_guardar_producto(text, jsonb, text) from public, anon;
revoke all on function public.financiamiento_retirar_producto(text, text) from public, anon;
revoke all on function public.financiamiento_guardar_simulacion(text, uuid, text, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.financiamiento_guardar_producto(text, jsonb, text) to authenticated;
grant execute on function public.financiamiento_retirar_producto(text, text) to authenticated;
grant execute on function public.financiamiento_guardar_simulacion(text, uuid, text, uuid, jsonb, jsonb) to authenticated;
