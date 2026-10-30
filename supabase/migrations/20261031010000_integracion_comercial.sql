-- AMURA · Cotizaciones, reservas y contratos sobre el mismo cliente.
-- Los permisos pasan del creador del documento al alcance sobre el cliente, y cada contrato guarda quién intervino en la venta.
-- Ejecutar después de 20261031000000_clientes_crm.sql. Aditiva: no borra ni modifica datos existentes.

do $$ begin
  if to_regprocedure('public.clientes_crear(uuid, jsonb, uuid)') is null or to_regclass('public.contracts') is null then
    raise exception 'Falta Clientes: ejecuta antes 20261031000000_clientes_crm.sql';
  end if;
end $$;

create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

/* ---------------------------------------- lectura según el cliente, no el creador */

-- Al reasignar un cliente, sus cotizaciones y reservas pasan con él: el asesor anterior deja de verlas y el nuevo las hereda.
drop policy if exists "leer cotizaciones" on public.quotes;
create policy "leer cotizaciones" on public.quotes for select to authenticated
  using (public.tiene_permiso('cotizaciones.ver') and case when client_id is null then public.en_alcance(created_by) else public.cliente_en_alcance(client_id) end);

drop policy if exists "ver reservas" on public.reservations;
create policy "ver reservas" on public.reservations for select to authenticated
  using (public.tiene_permiso('reservas.ver') and public.cliente_en_alcance(client_id));

/* ----------------------------- el flujo sigue a quien tiene hoy acceso al cliente */

select pg_temp.parchar('public.cotizaciones_aceptar(uuid, text)',
  'if not found or not public.en_alcance(q.created_by) then', 'if not found or not public.cliente_en_alcance(q.client_id) then');
select pg_temp.parchar('public.reservas_solicitar(uuid)',
  'if not found or not public.en_alcance(q.created_by) then', 'if not found or not public.cliente_en_alcance(q.client_id) then');
select pg_temp.parchar('public.reservas_adjuntar_comprobante(uuid, text, text)',
  'not (public.en_alcance(r.created_by) or public.cliente_en_alcance(r.client_id))', 'not public.cliente_en_alcance(r.client_id)');
select pg_temp.parchar('public.reservas_fijar_monto(uuid, numeric, text)',
  'not (public.en_alcance(r.created_by) or public.cliente_en_alcance(r.client_id))', 'not public.cliente_en_alcance(r.client_id)');

-- La cédula vive en la ficha del cliente: la cotización la toma de ahí.
select pg_temp.parchar('public.cotizaciones_emitir(uuid, numeric, integer, text)',
  'jsonb_build_object(''nombre'', c.nombre, ''email'', c.email, ''telefono'', c.telefono)',
  'jsonb_build_object(''nombre'', c.nombre, ''documento'', c.documento, ''email'', c.email, ''telefono'', c.telefono)');

/* ----------------------------------------- cotización en el historial del cliente */

create or replace function public.cotizacion_en_historial() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_id is not null then
    insert into client_activities (client_id, tipo, fecha, descripcion, user_id, referencia)
    values (new.client_id, 'cotizacion', new.fecha, new.numero || ' · ' || new.codigo || ' · USD ' || to_char(new.precio_final, 'FM999G999G999'), new.created_by, new.numero);
  end if;
  return new;
end $$;
drop trigger if exists cotizacion_en_historial on public.quotes;
create trigger cotizacion_en_historial after insert on public.quotes for each row execute function public.cotizacion_en_historial();
revoke all on function public.cotizacion_en_historial() from public, anon, authenticated;

/* ---------------------------------------- datos de la venta para Comisiones */

-- Se guardan al generar el contrato y no cambian con una reasignación posterior. No calculan ni crean ninguna comisión.
alter table public.contracts add column if not exists asesor_id uuid references auth.users (id);
alter table public.contracts add column if not exists responsable_id uuid references auth.users (id);
alter table public.contracts add column if not exists atribucion_usuario_id uuid references auth.users (id);
alter table public.contracts add column if not exists corredor_origen_id uuid references auth.users (id);
alter table public.contracts add column if not exists origen text;

create or replace function public.contrato_datos_venta() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients; v_responsable uuid;
begin
  select * into c from clients where id = new.client_id;
  select responsable_id into v_responsable from opportunities where id = new.opportunity_id;
  new.asesor_id := c.asesor_id;
  new.responsable_id := coalesce(v_responsable, c.asesor_id);
  new.atribucion_usuario_id := c.atribucion_usuario_id;
  new.corredor_origen_id := c.corredor_origen_id;
  new.origen := c.origen;
  return new;
end $$;
drop trigger if exists contrato_datos_venta on public.contracts;
create trigger contrato_datos_venta before insert on public.contracts for each row execute function public.contrato_datos_venta();
revoke all on function public.contrato_datos_venta() from public, anon, authenticated;
