-- AMURA · SQL de producción 0005. Copia exacta de supabase/migrations/20261117000000_clientes_unicos_reasignacion.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Clientes únicos por documento, solicitudes de reasignación y trazabilidad del responsable.
--   · Documento de identidad normalizado: cédula (10 dígitos, dígito verificador), RUC (13 dígitos) o pasaporte. El RUC de una
--     persona natural (cédula + 001) es la misma persona que su cédula. Un documento solo puede estar en un cliente.
--   · Antes de crear o editar, un disparador detiene el duplicado por documento, teléfono o correo con un mensaje claro. El nombre del
--     cliente y del vendedor responsable solo se muestran a quien ya puede ver ese cliente.
--   · Otro vendedor no se apropia del cliente: pide la reasignación y la resuelve un Supervisor o Gerencia que tenga a ambos vendedores
--     en su alcance. Cada cambio de responsable queda en client_assignment_history (antes, después, quién, cuándo, motivo).
--   · Cotizaciones, reservas y contratos conservan a quien los generó. Las comisiones no se transfieren al cambiar el responsable.
-- No borra ni reescribe datos: agrega columnas (sin documento explícito, el tipo se deduce del formato), tablas, funciones,
--   disparadores, políticas y un índice único. Antes de aplicar no debe haber dos clientes con el mismo documento (verificado: ninguno).
-- Revertir: borrar el índice clients_documento_uk, los disparadores clients_unicos, clients_historial_responsable y
--   clients_historial_responsable_alta con sus funciones, las funciones cedula_valida, clientes_*_documento, clientes_existente,
--   clientes_mensaje_existente, clientes_*_reasignacion, clientes_reasignaciones y clientes_trazabilidad, las tablas client_reassignment_requests y
--   client_assignment_history y las columnas tipo_documento y documento_clave de clients.
-- Ejecutar después de 20261116000000_notificaciones.sql.

do $$
begin
  if to_regprocedure('public.clientes_asignar(uuid, integer, uuid, text, boolean)') is null or to_regprocedure('public.cliente_en_alcance(uuid)') is null then
    raise exception 'Faltan dependencias: instala antes Clientes (CRM)';
  end if;
end $$;

/* --------------------------------------------------------- documento único */

-- Cédula ecuatoriana: provincia 01-24 (o 30), tercer dígito menor que 6 y dígito verificador (módulo 10).
create or replace function public.cedula_valida(p text) returns boolean
language plpgsql immutable set search_path = public as $$
declare s int := 0; d int;
begin
  if p is null or p !~ '^[0-9]{10}$' then return false; end if;
  if substr(p, 3, 1)::int >= 6 or (substr(p, 1, 2)::int not between 1 and 24 and substr(p, 1, 2) <> '30') then return false; end if;
  for i in 1..9 loop
    d := substr(p, i, 1)::int * case when i % 2 = 1 then 2 else 1 end;
    s := s + case when d > 9 then d - 9 else d end;
  end loop;
  return (10 - s % 10) % 10 = substr(p, 10, 1)::int;
end $$;

-- Tipo a partir del formato. Sin documento: null.
create or replace function public.clientes_tipo_documento(p_doc text) returns text
language sql immutable set search_path = public as $$
  select case
    when coalesce(btrim(p_doc), '') = '' then null
    when regexp_replace(p_doc, '[\s.-]', '', 'g') ~ '^[0-9]{10}$' then 'cedula'
    when regexp_replace(p_doc, '[\s.-]', '', 'g') ~ '^[0-9]{13}$' then 'ruc'
    else 'pasaporte' end
$$;

-- Clave de identidad: el mismo documento escrito con espacios, puntos o guiones da la misma clave.
create or replace function public.clientes_clave_documento(p_tipo text, p_doc text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_tipo is null or coalesce(btrim(p_doc), '') = '' then null
    when p_tipo = 'cedula' then 'CI:' || regexp_replace(p_doc, '\D', '', 'g')
    when p_tipo = 'ruc' and substr(regexp_replace(p_doc, '\D', '', 'g'), 3, 1) < '6' then 'CI:' || left(regexp_replace(p_doc, '\D', '', 'g'), 10)
    when p_tipo = 'ruc' then 'RUC:' || regexp_replace(p_doc, '\D', '', 'g')
    else 'PAS:' || upper(regexp_replace(p_doc, '[^0-9A-Za-z]', '', 'g')) end
$$;

alter table public.clients add column if not exists tipo_documento text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'clients_tipo_documento_valido') then
    alter table public.clients add constraint clients_tipo_documento_valido check (tipo_documento is null or tipo_documento in ('cedula', 'ruc', 'pasaporte'));
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'documento_clave') then
    alter table public.clients add column documento_clave text generated always as (public.clientes_clave_documento(coalesce(tipo_documento, public.clientes_tipo_documento(documento)), documento)) stored;
  end if;
end $$;
create unique index if not exists clients_documento_uk on public.clients (documento_clave) where documento_clave is not null;

/** Cliente que ya usa ese documento, teléfono o correo (sin contar p_excluir). */
create or replace function public.clientes_existente(p_documento text, p_telefono text, p_email text, p_excluir uuid) returns public.clients
language sql stable security definer set search_path = public as $$
  select c.* from clients c
  where c.id is distinct from p_excluir and (
    (public.clientes_clave_documento(public.clientes_tipo_documento(p_documento), p_documento) is not null
      and c.documento_clave = public.clientes_clave_documento(public.clientes_tipo_documento(p_documento), p_documento))
    or (coalesce(right(regexp_replace(p_telefono, '\D', '', 'g'), 9), '') <> '' and c.telefono <> ''
      and right(regexp_replace(c.telefono, '\D', '', 'g'), 9) = right(regexp_replace(p_telefono, '\D', '', 'g'), 9))
    or (coalesce(btrim(p_email), '') <> '' and c.email <> '' and lower(c.email) = lower(btrim(p_email))))
  order by c.created_at limit 1
$$;

/** Mensaje para quien intenta registrar un cliente que ya existe. Nombres solo si puede ver ese cliente. */
create or replace function public.clientes_mensaje_existente(c public.clients) returns text
language sql stable security definer set search_path = public as $$
  select case when public.cliente_en_alcance(c.id)
    then 'Este cliente ya se encuentra registrado en AMURA (' || c.nombre || ') y está asignado al vendedor ' || coalesce((select p.nombre from profiles p where p.id = c.asesor_id), 'sin nombre') || '.'
    else 'Este cliente ya se encuentra registrado en AMURA y lo atiende otro vendedor. Puedes solicitar su revisión o reasignación.' end
$$;

-- Consulta previa desde la ficha (antes de guardar). Devuelve lo mínimo; los datos personales, solo dentro del alcance.
create or replace function public.clientes_verificar_documento(p_documento text, p_telefono text, p_email text, p_excluir uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clients; v_tipo text := public.clientes_tipo_documento(p_documento); v_digitos text := regexp_replace(coalesce(p_documento, ''), '\D', '', 'g');
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para registrar clientes' using errcode = '42501'; end if;
  c := public.clientes_existente(p_documento, p_telefono, p_email, p_excluir);
  return jsonb_build_object(
    'tipo', v_tipo,
    'valido', case when v_tipo = 'cedula' then public.cedula_valida(v_digitos)
                   when v_tipo = 'ruc' then v_digitos ~ '001$' and (substr(v_digitos, 3, 1) >= '6' or public.cedula_valida(left(v_digitos, 10)))
                   else true end,
    'existe', c.id is not null,
    'visible', c.id is not null and public.cliente_en_alcance(c.id),
    'cliente_id', case when c.id is not null and public.cliente_en_alcance(c.id) then c.id end,
    'mensaje', case when c.id is not null then public.clientes_mensaje_existente(c) end);
end $$;

-- Valida el documento nuevo o cambiado y detiene el duplicado con un mensaje claro (la base lo garantiza aunque la pantalla falle).
create or replace function public.clientes_unicos() returns trigger
language plpgsql security definer set search_path = public as $$
declare c clients; v_digitos text;
begin
  new.documento := btrim(coalesce(new.documento, ''));
  if tg_op = 'INSERT' or new.documento is distinct from old.documento or new.tipo_documento is distinct from old.tipo_documento then
    if tg_op = 'UPDATE' and new.tipo_documento is not distinct from old.tipo_documento then new.tipo_documento := null; end if;
    new.tipo_documento := coalesce(new.tipo_documento, public.clientes_tipo_documento(new.documento));
    v_digitos := regexp_replace(new.documento, '\D', '', 'g');
    if new.tipo_documento = 'cedula' and not public.cedula_valida(v_digitos) then raise exception 'La cédula % no es válida: revisa los dígitos', new.documento; end if;
    if new.tipo_documento = 'ruc' and (v_digitos !~ '^[0-9]{10}001$' or (substr(v_digitos, 3, 1) < '6' and not public.cedula_valida(left(v_digitos, 10)))) then
      raise exception 'El RUC % no es válido: revisa los dígitos', new.documento;
    end if;
    if new.tipo_documento = 'pasaporte' and upper(regexp_replace(new.documento, '[^0-9A-Za-z]', '', 'g')) !~ '^[0-9A-Z]{5,20}$' then
      raise exception 'El pasaporte % no es válido', new.documento;
    end if;
  end if;
  if tg_op = 'INSERT' or new.documento is distinct from old.documento or new.telefono is distinct from old.telefono or new.email is distinct from old.email then
    c := public.clientes_existente(
      case when tg_op = 'INSERT' or new.documento is distinct from old.documento then new.documento end,
      case when tg_op = 'INSERT' or new.telefono is distinct from old.telefono then new.telefono end,
      case when tg_op = 'INSERT' or new.email is distinct from old.email then new.email end, new.id);
    if c.id is not null then raise exception '%', public.clientes_mensaje_existente(c) using errcode = '23505', hint = 'cliente_existente'; end if;
  end if;
  return new;
end $$;

drop trigger if exists clients_unicos on public.clients;
create trigger clients_unicos before insert or update of documento, tipo_documento, telefono, email on public.clients
  for each row execute function public.clientes_unicos();

/* ------------------------------------------------- historial del responsable */

create table if not exists public.client_assignment_history (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  asesor_anterior uuid references auth.users (id),
  asesor_nuevo uuid not null references auth.users (id),
  motivo text,
  solicitud_id uuid,
  registrado_por uuid references auth.users (id),
  registrado_en timestamptz not null default clock_timestamp()
);
create index if not exists client_assignment_history_cliente on public.client_assignment_history (client_id, registrado_en);
alter table public.client_assignment_history enable row level security;
drop policy if exists "ver historial de responsable" on public.client_assignment_history;
create policy "ver historial de responsable" on public.client_assignment_history for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(client_id));
grant select on public.client_assignment_history to authenticated;

-- Cualquier cambio de responsable queda registrado, venga de la ficha, de una reasignación o de administración.
create or replace function public.clientes_historial_responsable() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into client_assignment_history (client_id, asesor_anterior, asesor_nuevo, motivo, solicitud_id, registrado_por)
  values (new.id, case when tg_op = 'UPDATE' then old.asesor_id end, new.asesor_id,
          coalesce(nullif(current_setting('app.motivo', true), ''), case when tg_op = 'INSERT' then 'Cliente registrado' end),
          nullif(current_setting('app.solicitud', true), '')::uuid, auth.uid());
  return null;
end $$;
drop trigger if exists clients_historial_responsable on public.clients;
drop trigger if exists clients_historial_responsable_alta on public.clients;
create trigger clients_historial_responsable_alta after insert on public.clients
  for each row execute function public.clientes_historial_responsable();
create trigger clients_historial_responsable after update of asesor_id on public.clients
  for each row when (old.asesor_id is distinct from new.asesor_id) execute function public.clientes_historial_responsable();

/* ------------------------------------------------- solicitudes de reasignación */

create table if not exists public.client_reassignment_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id),
  solicitante_id uuid not null references auth.users (id),
  asesor_actual uuid not null references auth.users (id),
  motivo text not null check (char_length(btrim(motivo)) >= 10),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  resolucion text,
  resuelto_por uuid references auth.users (id),
  resuelto_en timestamptz,
  creado_en timestamptz not null default now()
);
create unique index if not exists client_reassignment_una_pendiente on public.client_reassignment_requests (client_id, solicitante_id) where estado = 'pendiente';
alter table public.client_reassignment_requests enable row level security;
-- Quien la pidió ve el estado de su solicitud; quien puede reasignar ve las de su alcance.
drop policy if exists "ver solicitudes de reasignacion" on public.client_reassignment_requests;
create policy "ver solicitudes de reasignacion" on public.client_reassignment_requests for select to authenticated
  using (solicitante_id = auth.uid() or (public.tiene_permiso('clientes.asignar') and (public.cliente_en_alcance(client_id) or public.en_alcance(solicitante_id))));
grant select on public.client_reassignment_requests to authenticated;

-- El vendedor que encontró al cliente ya registrado pide la revisión. No necesita ver al cliente: lo identifica el documento, teléfono o correo.
create or replace function public.clientes_solicitar_reasignacion(p_documento text, p_telefono text, p_email text, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c clients; v_id uuid; v_m text := btrim(coalesce(p_motivo, ''));
begin
  if not public.tiene_permiso('clientes.editar') then raise exception 'Sin permiso para solicitar reasignaciones' using errcode = '42501'; end if;
  if char_length(v_m) < 10 then raise exception 'Explica el motivo de la solicitud (mínimo 10 caracteres)'; end if;
  c := public.clientes_existente(p_documento, p_telefono, p_email, null);
  if c.id is null then raise exception 'No hay un cliente registrado con esos datos'; end if;
  if c.asesor_id = auth.uid() then raise exception 'Ya eres el vendedor responsable de este cliente'; end if;
  if exists (select 1 from client_reassignment_requests where client_id = c.id and solicitante_id = auth.uid() and estado = 'pendiente') then
    raise exception 'Ya tienes una solicitud pendiente para este cliente';
  end if;
  insert into client_reassignment_requests (client_id, solicitante_id, asesor_actual, motivo) values (c.id, auth.uid(), c.asesor_id, v_m) returning id into v_id;
  perform public.auditar('Solicitar reasignación de cliente', 'cliente', c.id::text, v_m, null, jsonb_build_object('solicitud', v_id));
  return v_id;
end $$;

-- La resuelve quien puede reasignar y tiene en su alcance al cliente y al solicitante (Supervisor de ambos o Gerencia). Nunca el solicitante.
create or replace function public.clientes_resolver_reasignacion(p_id uuid, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s client_reassignment_requests; c clients; v_m text := btrim(coalesce(p_motivo, ''));
begin
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para reasignar clientes' using errcode = '42501'; end if;
  if char_length(v_m) < 5 then raise exception 'Indica el motivo de la decisión'; end if;
  select * into s from client_reassignment_requests where id = p_id for update;
  if not found or s.estado <> 'pendiente' then raise exception 'La solicitud no existe o ya fue resuelta'; end if;
  if s.solicitante_id = auth.uid() then raise exception 'Quien pide la reasignación no puede resolverla' using errcode = '42501'; end if;
  if not public.cliente_en_alcance(s.client_id) or not public.en_alcance(s.solicitante_id) then
    raise exception 'Resuelve esta solicitud un Supervisor que tenga a ambos vendedores en su equipo, o Gerencia' using errcode = '42501';
  end if;
  if p_aprobar then
    select * into c from clients where id = s.client_id;
    perform set_config('app.solicitud', s.id::text, true);
    perform public.clientes_asignar(s.client_id, c.version, s.solicitante_id, 'Reasignación aprobada: ' || v_m, false);
    perform set_config('app.solicitud', '', true);
  end if;
  update client_reassignment_requests set estado = case when p_aprobar then 'aprobada' else 'rechazada' end, resolucion = v_m, resuelto_por = auth.uid(), resuelto_en = now() where id = p_id;
  perform public.auditar(case when p_aprobar then 'Aprobar reasignación de cliente' else 'Rechazar reasignación de cliente' end, 'cliente', s.client_id::text, v_m, null, jsonb_build_object('solicitud', p_id));
end $$;

-- Lista para quien resuelve: nombres de cliente y vendedores aunque el cliente sea de otro equipo (Gerencia ve todo; el Supervisor, su alcance).
create or replace function public.clientes_reasignaciones() returns table (id uuid, client_id uuid, cliente text, solicitante text, asesor_actual text, motivo text, estado text, resolucion text, creado_en timestamptz, resuelto_en timestamptz, puede_resolver boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.client_id, case when public.cliente_en_alcance(s.client_id) then c.nombre else 'Cliente de otro equipo' end,
         ps.nombre, pa.nombre, s.motivo, s.estado, s.resolucion, s.creado_en, s.resuelto_en,
         s.estado = 'pendiente' and s.solicitante_id <> auth.uid() and public.tiene_permiso('clientes.asignar') and public.cliente_en_alcance(s.client_id) and public.en_alcance(s.solicitante_id)
  from client_reassignment_requests s join clients c on c.id = s.client_id
  left join profiles ps on ps.id = s.solicitante_id left join profiles pa on pa.id = s.asesor_actual
  where s.solicitante_id = auth.uid() or (public.tiene_permiso('clientes.asignar') and (public.cliente_en_alcance(s.client_id) or public.en_alcance(s.solicitante_id)))
  order by s.creado_en desc
$$;

/* ------------------------------------------------- trazabilidad comercial */

-- Quién creó al cliente, quién lo atiende, a qué equipo y supervisor pertenece, sus reasignaciones y quién generó cada cotización y reserva.
create or replace function public.clientes_trazabilidad(p_client uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c clients; v_nombre jsonb;
begin
  if not public.tiene_permiso('clientes.ver') or not public.cliente_en_alcance(p_client) then raise exception 'Cliente inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  select * into c from clients where id = p_client;
  return jsonb_build_object(
    'creado_por', (select nombre from profiles where id = c.created_by), 'creado_en', c.created_at,
    'responsable', (select nombre from profiles where id = c.asesor_id),
    'equipo', (select t.nombre from profiles p join teams t on t.id = p.equipo_id where p.id = c.asesor_id),
    'supervisor', coalesce((select ps.nombre from profiles p join teams t on t.id = p.equipo_id join profiles ps on ps.id = t.supervisor_id where p.id = c.asesor_id),
                           (select ps.nombre from profiles p join profiles ps on ps.id = p.supervisor_id where p.id = c.asesor_id)),
    'reasignaciones', coalesce((select jsonb_agg(jsonb_build_object('fecha', h.registrado_en, 'anterior', pa.nombre, 'nuevo', pn.nombre, 'por', pr.nombre, 'motivo', h.motivo) order by h.registrado_en)
        from client_assignment_history h left join profiles pa on pa.id = h.asesor_anterior left join profiles pn on pn.id = h.asesor_nuevo left join profiles pr on pr.id = h.registrado_por
        where h.client_id = p_client and h.asesor_anterior is not null), '[]'::jsonb),
    'cotizaciones', coalesce((select jsonb_agg(jsonb_build_object('numero', q.numero, 'fecha', q.fecha, 'vendedor', p.nombre) order by q.fecha)
        from quotes q left join profiles p on p.id = q.created_by where q.client_id = p_client), '[]'::jsonb),
    'reservas', coalesce((select jsonb_agg(jsonb_build_object('codigo', r.codigo, 'estado', r.estado, 'fecha', r.created_at, 'vendedor', p.nombre) order by r.created_at)
        from reservations r left join profiles p on p.id = r.created_by where r.client_id = p_client), '[]'::jsonb));
end $$;

revoke all on function public.cedula_valida(text) from public, anon;
revoke all on function public.clientes_existente(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.clientes_mensaje_existente(public.clients) from public, anon, authenticated;
revoke all on function public.clientes_unicos() from public, anon, authenticated;
revoke all on function public.clientes_historial_responsable() from public, anon, authenticated;
revoke all on function public.clientes_verificar_documento(text, text, text, uuid) from public, anon;
revoke all on function public.clientes_solicitar_reasignacion(text, text, text, text) from public, anon;
revoke all on function public.clientes_resolver_reasignacion(uuid, boolean, text) from public, anon;
revoke all on function public.clientes_reasignaciones() from public, anon;
revoke all on function public.clientes_trazabilidad(uuid) from public, anon;
grant execute on function public.cedula_valida(text) to authenticated;
grant execute on function public.clientes_verificar_documento(text, text, text, uuid) to authenticated;
grant execute on function public.clientes_solicitar_reasignacion(text, text, text, text) to authenticated;
grant execute on function public.clientes_resolver_reasignacion(uuid, boolean, text) to authenticated;
grant execute on function public.clientes_reasignaciones() to authenticated;
grant execute on function public.clientes_trazabilidad(uuid) to authenticated;
