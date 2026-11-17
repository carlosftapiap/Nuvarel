-- AMURA · SQL de producción 0028. Copia exacta de supabase/migrations/20261207000000_sin_vendedor.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Clientes y oportunidades sin vendedor (sin ejecutar en producción).
-- Al desactivar un usuario, sus clientes y negociaciones abiertas quedan SIN VENDEDOR (NULL), con toda su información.
--   · Quien tiene clientes.asignar (administrador, gerencia, supervisor) los ve en la lista «Sin vendedor» y puede asignarlos.
--   · Ningún otro perfil los ve, igual que a cualquier cliente que no es suyo.
--   · Reasignar a un vendedor activo después funciona con clientes_asignar (ahora también desde «sin vendedor»).
--   · No se borra nada: clientes, reservas, pagos, documentos, gestiones e historial de responsables se conservan.
--   · Reservas, cotizaciones y contratos conservan a quien los generó (created_by), como antes.
-- Cambia: nulabilidad de clients.asesor_id, opportunities.responsable_id y client_assignment_history.asesor_nuevo;
-- cliente_en_alcance; disparadores de responsable; clientes_asignar; admin_desactivar_usuario (nueva firma, sin reasignar).
-- Revertir: volver a poner NOT NULL solo si no hay filas con NULL, y restaurar las funciones de sus migraciones de origen.

alter table public.clients alter column asesor_id drop not null;
alter table public.opportunities alter column responsable_id drop not null;
alter table public.client_assignment_history alter column asesor_nuevo drop not null;

-- Visibilidad: quien asigna ve los clientes sin vendedor; el resto de la regla no cambia.
create or replace function public.cliente_en_alcance(p_client uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from clients c where c.id = p_client and (
      public.en_alcance(c.asesor_id)
      or (c.asesor_id is null and public.tiene_permiso('clientes.asignar'))
      or exists (select 1 from opportunities o where o.client_id = c.id and o.etapa <> 'perdida' and public.en_alcance(o.responsable_id))
      or exists (select 1 from client_access a where a.client_id = c.id and a.revocado_en is null and public.en_alcance(a.usuario_id))
    ))
$$;

-- Responsable de un cliente: puede quedar vacío solo al desactivar; asignar siempre exige un usuario en alcance.
create or replace function public.clients_proteger_asesor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asesor_id is distinct from old.asesor_id then
    if not public.tiene_permiso('clientes.asignar') or (new.asesor_id is not null and not public.en_alcance(new.asesor_id)) then
      raise exception 'Sin permiso para reasignar a esa persona' using errcode = '42501';
    end if;
    insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), case when new.asesor_id is null then 'Dejar cliente sin vendedor' else 'Reasignar cliente' end, 'cliente', new.id::text,
            coalesce(nullif(current_setting('app.motivo', true), ''), 'Reasignación de asesor'),
            jsonb_build_object('asesor_id', old.asesor_id), jsonb_build_object('asesor_id', new.asesor_id));
  end if;
  -- El origen define la comisión y no se cambia después (política comercial, sección 3): solo por corrección autorizada.
  if (new.origen, new.origen_detalle, new.corredor_origen_id) is distinct from (old.origen, old.origen_detalle, old.corredor_origen_id)
     and coalesce(current_setting('app.corregir_origen', true), '') <> 'on' then
    raise exception 'El origen del cliente define la comisión y no se cambia; pide la corrección a administración' using errcode = '42501';
  end if;
  new.atribucion_usuario_id := old.atribucion_usuario_id;
  new.created_by := old.created_by;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;

-- Responsable de una negociación: igual que el cliente; vacío solo al desactivar.
create or replace function public.oportunidad_proteger_etapa() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.etapa is distinct from old.etapa then
    if not public.en_flujo() and (new.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega')
                                   or old.etapa in ('solicitud_reserva', 'verificacion_pago', 'aprobacion', 'contrato', 'cobranza', 'entrega')) then
      raise exception 'Esta etapa la determina el flujo de reservas, contratos y cobranzas' using errcode = '42501';
    end if;
    insert into opportunity_events (opportunity_id, etapa, descripcion, user_id)
    values (new.id, new.etapa, old.etapa || ' → ' || new.etapa, coalesce(auth.uid(), new.responsable_id));
  end if;
  if new.responsable_id is distinct from old.responsable_id then
    if not public.tiene_permiso('clientes.asignar') or (new.responsable_id is not null and not public.en_alcance(new.responsable_id)) then
      raise exception 'Sin permiso para reasignar la oportunidad' using errcode = '42501';
    end if;
    perform public.auditar('Reasignar oportunidad', 'oportunidad', new.id::text,
      coalesce(nullif(current_setting('app.motivo', true), ''), 'Reasignación de responsable'),
      jsonb_build_object('responsable_id', old.responsable_id), jsonb_build_object('responsable_id', new.responsable_id));
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Reasignación de un cliente, también desde «sin vendedor». Mueve sus negociaciones abiertas que estaban sin responsable o con el anterior.
create or replace function public.clientes_asignar(p_id uuid, p_version int, p_asesor uuid, p_motivo text, p_mantener_acceso boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare c clients; v_m text := public.clientes_motivo(p_motivo); v_version int; v_antes text; v_nuevo text;
begin
  c := public.clientes_tomar(p_id, p_version);
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para reasignar clientes' using errcode = '42501'; end if;
  perform public.clientes_responsable_valido(p_asesor);
  if c.asesor_id is not distinct from p_asesor then return c.version; end if;
  select nombre into v_antes from profiles where id = c.asesor_id;
  select nombre into v_nuevo from profiles where id = p_asesor;
  perform set_config('app.motivo', v_m, true);
  update clients set asesor_id = p_asesor where id = p_id returning version into v_version;
  update opportunities set responsable_id = p_asesor where client_id = p_id and responsable_id is not distinct from c.asesor_id and etapa <> 'perdida';
  perform set_config('app.motivo', '', true);
  if p_mantener_acceso and c.asesor_id is not null then
    insert into client_access (client_id, usuario_id, motivo) values (p_id, c.asesor_id, v_m)
    on conflict (client_id, usuario_id) do update set motivo = excluded.motivo, otorgado_por = auth.uid(), otorgado_en = now(), revocado_por = null, revocado_en = null;
  end if;
  perform public.clientes_nota(p_id, 'nota', 'Asesor reasignado: ' || coalesce(v_antes, 'sin vendedor') || ' → ' || coalesce(v_nuevo, 'sin nombre') || ' · motivo: ' || v_m);
  return v_version;
end $$;

-- Desactiva el acceso y deja clientes y negociaciones abiertas sin vendedor. Nada se borra. Todo en una operación.
drop function if exists public.admin_desactivar_usuario(uuid, uuid, text);
create or replace function public.admin_desactivar_usuario(p_user uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m text := btrim(coalesce(p_motivo, '')); u profiles; v_clientes int := 0; v_ops int := 0; v_proyectos text[];
begin
  perform public.admin_eliminaciones_exigir();
  if char_length(v_m) < 10 then raise exception 'Indica el motivo de la desactivación (mínimo 10 caracteres)'; end if;
  if p_user = auth.uid() then raise exception 'No puedes desactivar tu propio usuario'; end if;
  select * into u from profiles where id = p_user for update;
  if not found then raise exception 'El usuario no existe'; end if;
  if u.estado <> 'activo' then raise exception 'El usuario ya está inactivo'; end if;

  perform set_config('app.motivo', 'Sin vendedor por desactivación de ' || u.nombre || ': ' || v_m, true);
  update clients set asesor_id = null where asesor_id = p_user;
  get diagnostics v_clientes = row_count;
  update opportunities set responsable_id = null where responsable_id = p_user and etapa <> 'perdida';
  get diagnostics v_ops = row_count;
  perform set_config('app.motivo', '', true);

  select coalesce(array_agg(project_id), '{}') into v_proyectos from user_projects where user_id = p_user;
  perform public.config_actualizar_usuario(p_user, u.rol_id, u.alcance, u.supervisor_id, u.equipo_id, v_proyectos, 'inactivo', v_m);
  insert into admin_eliminaciones (tipo, motivo, actor_id, actor_nombre, operaciones, resultado)
  values ('usuario', v_m, auth.uid(), coalesce((select nombre from profiles where id = auth.uid()), ''),
          jsonb_build_array(jsonb_build_object('usuario', u.nombre, 'rol', u.rol_id)),
          jsonb_build_object('estado', 'inactivo', 'clientes_sin_vendedor', v_clientes, 'negociaciones_sin_vendedor', v_ops,
                             'nota', 'Clientes y negociaciones quedan sin vendedor para asignarlos después. No se borró información.'));
  return jsonb_build_object('clientes_sin_vendedor', v_clientes, 'negociaciones_sin_vendedor', v_ops);
end $$;

revoke all on function public.admin_desactivar_usuario(uuid, text) from public, anon;
grant execute on function public.admin_desactivar_usuario(uuid, text) to authenticated;
