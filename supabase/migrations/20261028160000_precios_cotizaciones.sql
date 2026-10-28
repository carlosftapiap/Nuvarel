-- AMURA · Fase 1 ventas: parqueo, propuestas de precio con aprobación y cotizaciones.
-- Ejecutar después de 20261028120000_inventario.sql.

alter table public.inventory_units add column if not exists parqueo text check (parqueo is null or char_length(parqueo) <= 20);

-- Sólo el administrador cambia precios oficiales de forma directa; gerencia propone.
create or replace function public.inventario_assert_aprobador() returns public.app_role
language plpgsql stable security definer set search_path = public as $$
declare v_rol public.app_role := public.current_app_role();
begin
  if v_rol is distinct from 'administrador' then raise exception 'Solo administración aprueba precios' using errcode = '42501'; end if;
  return v_rol;
end $$;

create table public.price_proposals (
  id uuid primary key default gen_random_uuid(),
  fecha timestamptz not null default now(),
  user_id uuid not null references auth.users (id),
  rol public.app_role not null,
  modo text not null check (modo in ('fijar', 'porcentaje')),
  valor numeric(10,2) not null,
  p_codigos text[],
  p_edificio smallint,
  p_piso text,
  p_tipologia text,
  motivo text not null check (char_length(motivo) >= 5),
  descripcion text not null,
  cambios jsonb not null,
  total_antes numeric(14,2) not null,
  total_despues numeric(14,2) not null,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  resuelta_por uuid references auth.users (id),
  resuelta_en timestamptz,
  comentario text
);
alter table public.price_proposals enable row level security;
create policy "leer propuestas" on public.price_proposals for select to authenticated
  using (public.current_app_role() in ('administrador', 'gerencia'));
create policy "gerencia propone" on public.price_proposals for insert to authenticated
  with check (public.current_app_role() in ('administrador', 'gerencia') and user_id = auth.uid() and estado = 'pendiente');

create or replace function public.precios_resolver_propuesta(p_id uuid, p_aprobar boolean, p_comentario text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rol public.app_role := public.inventario_assert_aprobador();
  p public.price_proposals;
begin
  select * into p from price_proposals where id = p_id for update;
  if not found then raise exception 'Propuesta inexistente'; end if;
  if p.estado <> 'pendiente' then raise exception 'La propuesta ya fue resuelta'; end if;
  if not p_aprobar and char_length(coalesce(trim(p_comentario), '')) < 5 then raise exception 'Motivo de rechazo obligatorio'; end if;
  if p_aprobar then
    perform public.inventario_ajustar_precio(p.modo, p.valor, p.motivo || ' (propuesta aprobada)', p.p_codigos, p.p_edificio, p.p_piso, p.p_tipologia);
  end if;
  update price_proposals set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
    resuelta_por = auth.uid(), resuelta_en = now(), comentario = nullif(trim(p_comentario), '')
  where id = p_id;
end $$;
revoke all on function public.precios_resolver_propuesta(uuid, boolean, text) from public, anon;
grant execute on function public.precios_resolver_propuesta(uuid, boolean, text) to authenticated;

-- Ajuste directo: ahora exige rol administrador (se recompila la verificación de rol).
do $$
declare
  v_def text := pg_get_functiondef('public.inventario_ajustar_precio(text, numeric, text, text[], smallint, text, text)'::regprocedure);
  v_new text := replace(v_def, 'v_rol not in (''administrador'', ''gerencia'')', 'v_rol <> ''administrador''');
begin
  if v_new = v_def then raise exception 'No se encontró la verificación de rol esperada en inventario_ajustar_precio'; end if;
  execute v_new;
end $$;

-- Cotizaciones emitidas
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique,
  fecha date not null,
  valida_hasta date not null,
  codigo text not null references public.inventory_units (codigo),
  cliente jsonb not null,
  asesor jsonb not null,
  descuento_pct numeric(5,2) not null default 0 check (descuento_pct between 0 and 50),
  precio_lista numeric(14,2) not null,
  precio_final numeric(14,2) not null,
  plan jsonb not null,
  observaciones text not null default '',
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.quotes enable row level security;
-- Cada asesor/corredor ve sus cotizaciones; administración y gerencia ven todas.
create policy "leer cotizaciones" on public.quotes for select to authenticated
  using (created_by = auth.uid() or public.current_app_role() in ('administrador', 'gerencia'));
create policy "crear cotizaciones" on public.quotes for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.current_app_role() is not null
    and (descuento_pct = 0 or public.current_app_role() in ('administrador', 'gerencia'))
    and exists (select 1 from public.inventory_units u where u.codigo = quotes.codigo and u.estado in ('disponible', 'por_confirmar'))
  );
