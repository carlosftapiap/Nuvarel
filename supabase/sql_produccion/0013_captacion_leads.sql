-- AMURA · SQL de producción 0013. Copia exacta de supabase/migrations/20261123000000_captacion_leads.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Captación y distribución automática de leads (página web, Facebook e Instagram).
--   · Cada lead entra a una bandeja (leads) y, al asignarse, se registra en Clientes como prospecto en etapa «nuevo»,
--     con su vendedor responsable y la próxima acción «Primer contacto» para el día. No hay otro CRM ni otro embudo.
--   · Duplicados por celular (y correo): no se crea otro cliente ni cambia el vendedor; la consulta queda registrada
--     con su origen y se avisa al responsable.
--   · Rotación entre los participantes que el administrador habilita, con sus días, horario (Ecuador), vacaciones y pausa.
--     Se asigna a quien lleva más tiempo sin recibir. Un bloqueo en la base serializa los ingresos: dos leads simultáneos
--     nunca caen al mismo vendedor ni duplican un cliente.
--   · Sin vendedor disponible, el lead queda pendiente y se asigna por orden de llegada cuando hay disponibilidad
--     (al llegar otro lead, al cambiar la configuración y cada 5 minutos: 0014).
--   · El primer contacto se registra cuando el vendedor anota una llamada, mensaje o visita; asignar no es contactar.
--   · Ingreso solo desde el servidor (Edge Functions con clave de servicio). No crea comisiones ni toca el inventario.

do $$ begin
  if to_regprocedure('public.celular_normalizado(text)') is null or to_regprocedure('public.clientes_existente(text, text, text, uuid)') is null then
    raise exception 'Faltan dependencias: aplica antes 0005 (clientes únicos) y 0009 (celular único)';
  end if;
end $$;

/* --------------------------------------------------------------------- permiso */

insert into public.permissions (clave, modulo, descripcion) values
  ('config.leads', 'Configuración', 'Configurar la distribución automática de leads')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;
insert into public.role_permissions (role_id, permiso)
select 'administrador', 'config.leads' where exists (select 1 from public.roles where id = 'administrador')
on conflict do nothing;

/* --------------------------------------------------------------------- orígenes */

-- Facebook y página web se suman a los orígenes de un cliente.
alter table public.clients drop constraint if exists clients_origen_check;
alter table public.clients add constraint clients_origen_check check (origen in ('instagram', 'whatsapp', 'referido', 'corredor', 'visita', 'facebook', 'web'));

-- La ficha también los acepta: solo se amplía la lista de orígenes de clientes_datos, sin tocar el resto de la función
-- (conserva los nombres y apellidos que agregó 20261031160000_clientes_nombres.sql).
do $$
declare
  v_def text := pg_get_functiondef('public.clientes_datos(jsonb)'::regprocedure);
  v_antes text := $x$v_origen not in ('instagram', 'whatsapp', 'referido', 'corredor', 'visita')$x$;
  v_despues text := $x$v_origen not in ('instagram', 'whatsapp', 'referido', 'corredor', 'visita', 'facebook', 'web')$x$;
begin
  if position(v_despues in v_def) > 0 then return; end if;
  if position(v_antes in v_def) = 0 then raise exception 'clientes_datos no tiene la forma esperada: revisa 20261031000000_clientes_crm.sql'; end if;
  execute replace(v_def, v_antes, v_despues);
end $$;

/* --------------------------------------------------------------- participantes */

-- Quién recibe leads y cuándo. Solo el administrador lo cambia (config.leads); cada uno ve su propia fila.
-- El turno (secuencia) ordena la rotación: dos asignaciones en el mismo instante no empatan.
create sequence if not exists public.leads_turno_seq;
create table if not exists public.leads_participantes (
  user_id uuid primary key references auth.users (id),
  activo boolean not null default false,
  dias smallint[] not null default '{1,2,3,4,5}',
  hora_inicio time not null default '09:00',
  hora_fin time not null default '18:00',
  vacaciones_desde date,
  vacaciones_hasta date,
  pausado boolean not null default false,
  pausa_motivo text,
  ultimo_lead_en timestamptz,
  turno bigint,
  actualizado_por uuid references auth.users (id),
  actualizado_en timestamptz not null default now(),
  constraint leads_participantes_dias_ck check (dias <@ '{1,2,3,4,5,6,7}'::smallint[]),
  constraint leads_participantes_horario_ck check (hora_inicio < hora_fin),
  constraint leads_participantes_vacaciones_ck check ((vacaciones_desde is null) = (vacaciones_hasta is null) and (vacaciones_hasta is null or vacaciones_desde <= vacaciones_hasta)),
  constraint leads_participantes_pausa_ck check (not pausado or char_length(btrim(coalesce(pausa_motivo, ''))) >= 3)
);
alter table public.leads_participantes enable row level security;
drop policy if exists "ver participacion en leads" on public.leads_participantes;
create policy "ver participacion en leads" on public.leads_participantes for select to authenticated
  using (user_id = auth.uid() or public.tiene_permiso('config.leads'));

/* ---------------------------------------------------------------------- leads */

-- Cada solicitud recibida, con su procedencia, consentimiento, asignación y primer contacto. Nunca se borra.
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  fuente text not null check (fuente in ('web', 'facebook', 'instagram')),
  formulario text,
  externo_id text,
  nombre text not null,
  telefono text not null,
  email text not null default '',
  mensaje text not null default '',
  unidad_interes text,
  presupuesto numeric(14,2),
  campana text,
  anuncio text,
  conjunto text,
  pagina text,
  datos jsonb not null default '{}'::jsonb,
  consentimiento boolean not null check (consentimiento),
  consentimiento_version text not null,
  ip_hash text,
  recibido_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'asignado', 'duplicado')),
  client_id uuid references public.clients (id),
  asignado_a uuid references auth.users (id),
  asignado_en timestamptz,
  asignacion text check (asignacion in ('rotacion', 'responsable', 'manual')),
  primer_contacto_en timestamptz,
  primer_contacto_tipo text,
  constraint leads_externo_uk unique (fuente, externo_id),
  constraint leads_asignado_ck check (estado = 'pendiente' or (client_id is not null and asignado_a is not null and asignado_en is not null))
);
create index if not exists leads_pendientes_ix on public.leads (recibido_en) where estado = 'pendiente';
create index if not exists leads_cliente_ix on public.leads (client_id);
create index if not exists leads_ip_ix on public.leads (ip_hash, recibido_en) where ip_hash is not null;
create index if not exists leads_por_contactar_ix on public.leads (asignado_a) where primer_contacto_en is null;
alter table public.leads enable row level security;
-- Con las reglas de alcance de Clientes: el vendedor ve los suyos, el supervisor su equipo; los pendientes, solo administración.
drop policy if exists "ver leads" on public.leads;
create policy "ver leads" on public.leads for select to authenticated
  using (public.tiene_permiso('config.leads') or (client_id is not null and public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(client_id)));

-- Entradas que no se pudieron registrar (p. ej. un celular no válido en un formulario de Meta). Nada se pierde.
create table if not exists public.leads_errores (
  id uuid primary key default gen_random_uuid(),
  fuente text not null,
  externo_id text,
  detalle jsonb not null default '{}'::jsonb,
  error text not null,
  recibido_en timestamptz not null default now()
);
alter table public.leads_errores enable row level security;
drop policy if exists "ver errores de leads" on public.leads_errores;
create policy "ver errores de leads" on public.leads_errores for select to authenticated using (public.tiene_permiso('config.leads'));

/* -------------------------------------------------------------- disponibilidad */

-- Estado de un participante en un momento dado, con la fecha y la hora de Ecuador.
create or replace function public.leads_estado_participante(p public.leads_participantes, p_ahora timestamptz) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p.user_id is null or not p.activo then 'no_participa'
    when not exists (select 1 from profiles x where x.id = p.user_id and x.estado = 'activo' and x.rol_id in ('asesor', 'supervisor')) then 'no_habilitado'
    when p.pausado then 'pausado'
    when p.vacaciones_desde is not null and (p_ahora at time zone 'America/Guayaquil')::date between p.vacaciones_desde and p.vacaciones_hasta then 'vacaciones'
    when not (extract(isodow from (p_ahora at time zone 'America/Guayaquil'))::smallint = any (p.dias)) then 'fuera_de_horario'
    when (p_ahora at time zone 'America/Guayaquil')::time < p.hora_inicio or (p_ahora at time zone 'America/Guayaquil')::time >= p.hora_fin then 'fuera_de_horario'
    else 'disponible' end
$$;

-- Rotación: entre los disponibles, quien lleva más turnos sin recibir un lead (nunca recibido va primero).
create or replace function public.leads_siguiente_vendedor(p_ahora timestamptz) returns uuid
language sql stable security definer set search_path = public as $$
  select p.user_id from leads_participantes p join profiles x on x.id = p.user_id
  where public.leads_estado_participante(p, p_ahora) = 'disponible'
  order by p.turno nulls first, x.nombre, p.user_id
  limit 1
$$;

/* --------------------------------------------------------------------- avisos */

create or replace function public.leads_fuente_texto(p_fuente text) returns text
language sql immutable as $$ select case p_fuente when 'web' then 'Página web' when 'facebook' then 'Facebook' when 'instagram' then 'Instagram' else p_fuente end $$;

-- Aviso al responsable: prospecto nuevo o nueva consulta de un cliente suyo. Si el responsable ya no está activo, va a administración.
create or replace function public.leads_avisar(p_lead uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l leads; v_cliente text; v_destino uuid[];
begin
  select * into l from leads where id = p_lead;
  select nombre into v_cliente from clients where id = l.client_id;
  v_destino := case when exists (select 1 from profiles where id = l.asignado_a and estado = 'activo') then array[l.asignado_a] else public.notif_administradores() end;
  perform public.notif_seguro(case when l.estado = 'duplicado' then 'lead_consulta' else 'lead_asignado' end, 'lead', l.id::text, l.estado, null, v_destino,
    case when l.estado = 'duplicado' then 'Nueva consulta de tu cliente · ' else 'Nuevo prospecto asignado · ' end || coalesce(v_cliente, l.nombre),
    case when l.estado = 'duplicado' then 'Tu cliente volvió a escribir' else 'Tienes un prospecto nuevo para contactar' end,
    jsonb_build_array(jsonb_build_array('Prospecto', coalesce(v_cliente, l.nombre)), jsonb_build_array('Origen', public.leads_fuente_texto(l.fuente)),
      jsonb_build_array('Campaña', coalesce(nullif(l.campana, ''), 'Sin campaña')), jsonb_build_array('Mensaje', coalesce(nullif(l.mensaje, ''), '—'))),
    '/clientes?cliente=' || l.client_id::text, null);
end $$;

/* ------------------------------------------------------------------ asignación */

-- Procesa un lead pendiente. Quien llama debe tener el bloqueo de leads (pg_advisory_xact_lock(hashtext('amura.leads'))).
-- Cliente existente (por celular o correo): queda como consulta del responsable. Si no, se crea el prospecto con el vendedor de turno.
create or replace function public.leads_procesar(p_lead uuid, p_ahora timestamptz, p_forzar uuid default null, p_motivo text default null) returns text
language plpgsql security definer set search_path = public as $$
declare l leads; c clients; v_vend uuid; v_id uuid; v_hoy date := (p_ahora at time zone 'America/Guayaquil')::date; v_fuente text;
begin
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'Lead inexistente'; end if;
  if l.estado <> 'pendiente' then return l.estado; end if;
  v_fuente := public.leads_fuente_texto(l.fuente);
  c := public.clientes_existente(null, l.telefono, l.email, null);
  if c.id is null then
    v_vend := coalesce(p_forzar, public.leads_siguiente_vendedor(p_ahora));
    if v_vend is null then return 'pendiente'; end if;
    begin
      perform set_config('app.motivo', 'Lead de ' || v_fuente || case when p_forzar is null then ' asignado por rotación automática' else ' asignado manualmente: ' || coalesce(p_motivo, '') end, true);
      insert into clients (nombre, telefono, email, origen, origen_detalle, unidades_interes, presupuesto, asesor_id, created_by, proxima_tipo, proxima_descripcion, proxima_fecha)
      values (l.nombre, l.telefono, l.email, l.fuente, coalesce(l.campana, ''),
              case when exists (select 1 from inventory_units u where u.codigo = l.unidad_interes) then array[l.unidad_interes] else '{}'::text[] end,
              case when l.presupuesto > 0 then l.presupuesto end, v_vend, v_vend, 'llamada',
              'Primer contacto: prospecto de ' || v_fuente || coalesce(' · ' || nullif(l.campana, ''), ''), v_hoy)
      returning id into v_id;
      perform set_config('app.motivo', '', true);
    exception when unique_violation then
      -- Otro usuario lo registró al mismo tiempo: se trata como cliente existente.
      perform set_config('app.motivo', '', true);
      c := public.clientes_existente(null, l.telefono, l.email, null);
      if c.id is null then raise; end if;
    end;
  end if;
  if c.id is not null then
    update leads set estado = 'duplicado', client_id = c.id, asignado_a = c.asesor_id, asignado_en = p_ahora, asignacion = 'responsable' where id = l.id;
    perform public.auditar('Registrar consulta de cliente existente', 'lead', l.id::text,
      'Consulta de ' || v_fuente || ' de un cliente ya registrado: se mantiene su vendedor', null, jsonb_build_object('cliente', c.id, 'vendedor', c.asesor_id));
    perform public.leads_avisar(l.id);
    return 'duplicado';
  end if;
  update leads set estado = 'asignado', client_id = v_id, asignado_a = v_vend, asignado_en = p_ahora,
    asignacion = case when p_forzar is null then 'rotacion' else 'manual' end where id = l.id;
  if p_forzar is null then update leads_participantes set ultimo_lead_en = p_ahora, turno = nextval('leads_turno_seq') where user_id = v_vend; end if;
  perform public.auditar('Asignar lead', 'lead', l.id::text,
    'Lead de ' || v_fuente || case when p_forzar is null then ' asignado por rotación' else ' asignado manualmente: ' || coalesce(p_motivo, '') end, null,
    jsonb_build_object('cliente', v_id, 'vendedor', v_vend, 'asignacion', case when p_forzar is null then 'rotacion' else 'manual' end));
  perform public.leads_avisar(l.id);
  return 'asignado';
end $$;

-- Asigna los pendientes por orden de llegada. La usan el ingreso, la configuración y el programador (0014).
create or replace function public.leads_asignar_pendientes(p_ahora timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('amura.leads'));
  for r in select id from leads where estado = 'pendiente' order by recibido_en, id loop
    if public.leads_procesar(r.id, p_ahora) <> 'pendiente' then n := n + 1; end if;
  end loop;
  return n;
end $$;

/* ---------------------------------------------------------------------- ingreso */

-- Único ingreso de leads: lo llaman las Edge Functions con la clave de servicio. Valida todo en el servidor.
create or replace function public.leads_ingresar(p jsonb, p_ahora timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_fuente text := lower(btrim(coalesce(p ->> 'fuente', '')));
  v_externo text := nullif(btrim(coalesce(p ->> 'externo_id', '')), '');
  v_nombre text := btrim(regexp_replace(coalesce(p ->> 'nombre', ''), '\s+', ' ', 'g'));
  v_tel text := public.celular_normalizado(coalesce(p ->> 'telefono', ''));
  v_email text := lower(btrim(coalesce(p ->> 'email', '')));
  v_ip text := nullif(btrim(coalesce(p ->> 'ip_hash', '')), '');
  v_pres numeric;
  l leads; v_id uuid;
begin
  if v_fuente not in ('web', 'facebook', 'instagram') then raise exception 'Fuente de lead no válida'; end if;
  if char_length(v_nombre) < 3 or char_length(v_nombre) > 120 then raise exception 'Ingresa tu nombre completo'; end if;
  if v_tel is null then raise exception 'El celular no es válido: en Ecuador, 10 dígitos que empiezan por 09; de otro país, con + y el código del país'; end if;
  if v_email <> '' and (char_length(v_email) > 160 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$') then raise exception 'El correo no es válido'; end if;
  if coalesce(p ->> 'consentimiento', '') <> 'true' then raise exception 'Debes aceptar el tratamiento de tus datos personales'; end if;
  if char_length(btrim(coalesce(p ->> 'consentimiento_version', ''))) < 2 then raise exception 'Falta la versión del texto de consentimiento'; end if;
  begin v_pres := nullif(btrim(coalesce(p ->> 'presupuesto', '')), '')::numeric; exception when others then v_pres := null; end;

  perform pg_advisory_xact_lock(hashtext('amura.leads'));
  -- El mismo envío repetido (Meta reintenta) no se registra dos veces.
  if v_externo is not null then
    select * into l from leads where fuente = v_fuente and externo_id = v_externo;
    if found then return jsonb_build_object('lead', l.id, 'estado', l.estado, 'repetido', true); end if;
  end if;
  -- Contra envíos masivos desde el formulario web: hasta 5 cada 10 minutos por origen de red.
  if v_ip is not null and (select count(*) from leads where ip_hash = v_ip and recibido_en > p_ahora - interval '10 minutes') >= 5 then
    raise exception 'Demasiados envíos seguidos. Intenta de nuevo en unos minutos.';
  end if;
  insert into leads (fuente, formulario, externo_id, nombre, telefono, email, mensaje, unidad_interes, presupuesto, campana, anuncio, conjunto, pagina, datos,
                     consentimiento, consentimiento_version, ip_hash, recibido_en)
  values (v_fuente, left(nullif(btrim(coalesce(p ->> 'formulario', '')), ''), 120), v_externo, v_nombre, v_tel, v_email, left(btrim(coalesce(p ->> 'mensaje', '')), 2000),
          left(nullif(btrim(coalesce(p ->> 'unidad_interes', '')), ''), 60), case when v_pres > 0 then round(v_pres, 2) end,
          left(nullif(btrim(coalesce(p ->> 'campana', '')), ''), 200), left(nullif(btrim(coalesce(p ->> 'anuncio', '')), ''), 200),
          left(nullif(btrim(coalesce(p ->> 'conjunto', '')), ''), 200), left(nullif(btrim(coalesce(p ->> 'pagina', '')), ''), 300),
          coalesce(p -> 'datos', '{}'::jsonb), true, left(btrim(p ->> 'consentimiento_version'), 60), v_ip, p_ahora)
  returning id into v_id;
  perform public.leads_asignar_pendientes(p_ahora);
  select * into l from leads where id = v_id;
  return jsonb_build_object('lead', l.id, 'estado', l.estado, 'repetido', false);
end $$;

-- Lo que no se pudo registrar queda a la vista del administrador.
create or replace function public.leads_registrar_error(p_fuente text, p_externo text, p_detalle jsonb, p_error text) returns uuid
language sql security definer set search_path = public as $$
  insert into leads_errores (fuente, externo_id, detalle, error) values (left(coalesce(p_fuente, 'desconocida'), 30), left(p_externo, 120), coalesce(p_detalle, '{}'::jsonb), left(coalesce(p_error, 'Sin detalle'), 1000))
  returning id
$$;

/* -------------------------------------------------------------- primer contacto */

-- Asignar no es contactar: el primer contacto es la primera llamada, mensaje o visita que se registra con el lead ya asignado.
create or replace function public.leads_primer_contacto() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tipo in ('llamada', 'mensaje', 'visita') then
    update leads set primer_contacto_en = new.created_at, primer_contacto_tipo = new.tipo
    where client_id = new.client_id and primer_contacto_en is null and estado in ('asignado', 'duplicado');
  end if;
  return null;
end $$;
drop trigger if exists leads_primer_contacto on public.client_activities;
create trigger leads_primer_contacto after insert on public.client_activities for each row execute function public.leads_primer_contacto();

/* ------------------------------------------------------------- administración */

create or replace function public.leads_exigir_configuracion() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.tiene_permiso('config.leads') then raise exception 'Solo el administrador configura la distribución de leads' using errcode = '42501'; end if;
end $$;

-- Vendedores y supervisores activos, con su participación y su disponibilidad ahora.
create or replace function public.leads_disponibilidad(p_ahora timestamptz default now())
returns table (user_id uuid, nombre text, rol text, equipo text, activo boolean, dias smallint[], hora_inicio time, hora_fin time,
               vacaciones_desde date, vacaciones_hasta date, pausado boolean, pausa_motivo text, ultimo_lead_en timestamptz, estado text,
               leads_asignados bigint, por_contactar bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.leads_exigir_configuracion();
  return query
    select x.id, x.nombre, x.rol_id, t.nombre, coalesce(p.activo, false), coalesce(p.dias, '{1,2,3,4,5}'::smallint[]), coalesce(p.hora_inicio, '09:00'::time),
           coalesce(p.hora_fin, '18:00'::time), p.vacaciones_desde, p.vacaciones_hasta, coalesce(p.pausado, false), p.pausa_motivo, p.ultimo_lead_en,
           case when p.user_id is null then 'no_participa' else public.leads_estado_participante(p, p_ahora) end,
           (select count(*) from leads l where l.asignado_a = x.id and l.estado = 'asignado'),
           (select count(*) from leads l where l.asignado_a = x.id and l.primer_contacto_en is null and l.estado in ('asignado', 'duplicado'))
    from profiles x left join leads_participantes p on p.user_id = x.id left join teams t on t.id = x.equipo_id
    where x.estado = 'activo' and x.rol_id in ('asesor', 'supervisor')
    order by x.nombre;
end $$;

-- Guarda la participación de una persona. Activar, pausar o cambiar horarios no toca su cuenta ni sus clientes.
create or replace function public.leads_configurar_participante(p_user uuid, p jsonb, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_m text := public.clientes_motivo(p_motivo); antes jsonb;
  v_activo boolean := coalesce((p ->> 'activo')::boolean, false);
  v_dias smallint[] := array(select distinct x::smallint from jsonb_array_elements_text(coalesce(p -> 'dias', '[1,2,3,4,5]'::jsonb)) x order by 1);
  v_ini time := coalesce(nullif(p ->> 'hora_inicio', '')::time, '09:00');
  v_fin time := coalesce(nullif(p ->> 'hora_fin', '')::time, '18:00');
  v_vd date := nullif(p ->> 'vacaciones_desde', '')::date;
  v_vh date := nullif(p ->> 'vacaciones_hasta', '')::date;
  v_pausado boolean := coalesce((p ->> 'pausado')::boolean, false);
  v_pausa text := nullif(btrim(coalesce(p ->> 'pausa_motivo', '')), '');
begin
  perform public.leads_exigir_configuracion();
  if not exists (select 1 from profiles where id = p_user and estado = 'activo' and rol_id in ('asesor', 'supervisor')) then
    raise exception 'Solo participan vendedores y supervisores activos';
  end if;
  if v_activo and coalesce(array_length(v_dias, 1), 0) = 0 then raise exception 'Elige al menos un día de atención'; end if;
  if not (v_dias <@ '{1,2,3,4,5,6,7}'::smallint[]) then raise exception 'Días no válidos'; end if;
  if v_ini >= v_fin then raise exception 'La hora de inicio debe ser anterior a la hora de fin'; end if;
  if (v_vd is null) <> (v_vh is null) then raise exception 'Indica el inicio y el fin de las vacaciones'; end if;
  if v_vd is not null and v_vd > v_vh then raise exception 'Las vacaciones terminan antes de empezar'; end if;
  if v_pausado and char_length(coalesce(v_pausa, '')) < 3 then raise exception 'Indica el motivo de la pausa'; end if;
  select to_jsonb(x) - 'ultimo_lead_en' - 'turno' - 'actualizado_en' - 'actualizado_por' into antes from leads_participantes x where x.user_id = p_user;
  insert into leads_participantes (user_id, activo, dias, hora_inicio, hora_fin, vacaciones_desde, vacaciones_hasta, pausado, pausa_motivo, actualizado_por, actualizado_en)
  values (p_user, v_activo, v_dias, v_ini, v_fin, v_vd, v_vh, v_pausado, case when v_pausado then v_pausa end, auth.uid(), now())
  on conflict (user_id) do update set activo = excluded.activo, dias = excluded.dias, hora_inicio = excluded.hora_inicio, hora_fin = excluded.hora_fin,
    vacaciones_desde = excluded.vacaciones_desde, vacaciones_hasta = excluded.vacaciones_hasta, pausado = excluded.pausado, pausa_motivo = excluded.pausa_motivo,
    actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
  perform public.auditar('Configurar distribución de leads', 'usuario', p_user::text, v_m, antes,
    jsonb_build_object('activo', v_activo, 'dias', v_dias, 'hora_inicio', v_ini, 'hora_fin', v_fin, 'vacaciones_desde', v_vd, 'vacaciones_hasta', v_vh, 'pausado', v_pausado, 'pausa_motivo', v_pausa));
  perform public.leads_asignar_pendientes(now());
end $$;

-- El administrador puede pedir la asignación de los pendientes en este momento, o asignar uno a mano con motivo.
create or replace function public.leads_asignar_ahora() returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public.leads_exigir_configuracion();
  return public.leads_asignar_pendientes(now());
end $$;

create or replace function public.leads_asignar_manual(p_lead uuid, p_vendedor uuid, p_motivo text) returns text
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo);
begin
  perform public.leads_exigir_configuracion();
  if not exists (select 1 from profiles where id = p_vendedor and estado = 'activo' and rol_id in ('asesor', 'supervisor')) then
    raise exception 'Asigna a un vendedor o supervisor activo';
  end if;
  perform pg_advisory_xact_lock(hashtext('amura.leads'));
  if (select estado from leads where id = p_lead) is distinct from 'pendiente' then raise exception 'Este lead ya no está pendiente'; end if;
  return public.leads_procesar(p_lead, now(), p_vendedor, v_m);
end $$;

/* ------------------------------------------------------------ permisos de funciones */

do $$
declare fn text;
begin
  -- Solo el servidor (Edge Functions con clave de servicio y el programador).
  foreach fn in array array['public.leads_ingresar(jsonb, timestamptz)', 'public.leads_registrar_error(text, text, jsonb, text)', 'public.leads_asignar_pendientes(timestamptz)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', fn); end if;
  end loop;
  -- Internas.
  foreach fn in array array['public.leads_procesar(uuid, timestamptz, uuid, text)', 'public.leads_avisar(uuid)', 'public.leads_siguiente_vendedor(timestamptz)',
    'public.leads_estado_participante(public.leads_participantes, timestamptz)', 'public.leads_primer_contacto()', 'public.leads_exigir_configuracion()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
  -- Administración (verifican config.leads).
  foreach fn in array array['public.leads_disponibilidad(timestamptz)', 'public.leads_configurar_participante(uuid, jsonb, text)', 'public.leads_asignar_ahora()',
    'public.leads_asignar_manual(uuid, uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;
