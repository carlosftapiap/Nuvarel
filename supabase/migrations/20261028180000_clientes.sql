-- AMURA · Clientes y gestión comercial.
-- Ejecutar después de 20261028160000_precios_cotizaciones.sql.

create type public.etapa_cliente as enum ('nuevo', 'contactado', 'calificado', 'visita', 'cotizacion', 'negociacion', 'reserva', 'perdido', 'seguimiento');

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) >= 3),
  telefono text not null default '',
  email text not null default '',
  origen text not null check (origen in ('instagram', 'whatsapp', 'referido', 'corredor', 'visita')),
  origen_detalle text not null default '',
  unidades_interes text[] not null default '{}',
  presupuesto numeric(14,2) check (presupuesto is null or presupuesto > 0),
  proposito text check (proposito in ('vivir', 'invertir')),
  forma_pago text check (forma_pago in ('contado', 'banco', 'biess')),
  asesor_id uuid not null references auth.users (id),
  etapa public.etapa_cliente not null default 'nuevo',
  motivo_perdida text not null default '',
  fecha_retomar date,
  proxima_tipo text check (proxima_tipo in ('llamada', 'mensaje', 'visita', 'nota')),
  proxima_descripcion text,
  proxima_fecha date,
  created_by uuid not null references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (telefono <> '' or email <> ''),
  check (etapa <> 'perdido' or char_length(motivo_perdida) >= 5),
  check (etapa <> 'seguimiento' or fecha_retomar is not null)
);
create unique index clients_telefono_uk on public.clients ((right(regexp_replace(telefono, '\D', '', 'g'), 9))) where telefono <> '';
create unique index clients_email_uk on public.clients (lower(email)) where email <> '';

create table public.client_activities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  tipo text not null check (tipo in ('llamada', 'mensaje', 'visita', 'cotizacion', 'nota', 'etapa')),
  fecha date not null,
  descripcion text not null,
  user_id uuid not null references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

-- Visibilidad: administración, gerencia y asesores ven todo; un corredor solo sus clientes.
create or replace function public.puede_ver_cliente(p_asesor uuid, p_creador uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.current_app_role() in ('administrador', 'gerencia', 'asesor')
      or (public.current_app_role() = 'corredor' and auth.uid() in (p_asesor, p_creador))
$$;

alter table public.clients enable row level security;
alter table public.client_activities enable row level security;

create policy "ver clientes" on public.clients for select to authenticated
  using (public.puede_ver_cliente(asesor_id, created_by));
create policy "crear clientes" on public.clients for insert to authenticated
  with check (
    public.current_app_role() is not null and created_by = auth.uid()
    and (asesor_id = auth.uid() or public.current_app_role() in ('administrador', 'gerencia'))
  );
create policy "editar clientes" on public.clients for update to authenticated
  using (public.puede_ver_cliente(asesor_id, created_by))
  with check (public.puede_ver_cliente(asesor_id, created_by));

-- Solo gerencia o administración reasignan el asesor.
create or replace function public.clients_proteger_asesor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asesor_id is distinct from old.asesor_id and public.current_app_role() not in ('administrador', 'gerencia') then
    raise exception 'Solo gerencia puede reasignar el asesor' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger clients_proteger_asesor before update on public.clients for each row execute function public.clients_proteger_asesor();

create policy "ver actividades" on public.client_activities for select to authenticated
  using (exists (select 1 from public.clients c where c.id = client_id and public.puede_ver_cliente(c.asesor_id, c.created_by)));
create policy "registrar actividades" on public.client_activities for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.clients c where c.id = client_id and public.puede_ver_cliente(c.asesor_id, c.created_by)));

-- Las cotizaciones pueden vincularse a un cliente.
alter table public.quotes add column if not exists client_id uuid references public.clients (id);
