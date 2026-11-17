-- AMURA · Eliminaciones administrativas (sin ejecutar en producción).
-- Exclusivo del permiso config.eliminaciones (solo administrador). Nada se borra físicamente:
--   · Reservas: se anulan con motivo, solo si no tienen dinero reportado ni recibido, contrato vigente ni desistimiento
--     en trámite. Varias reservas de un mismo cliente van en una sola operación: si una tiene impedimento, no se anula ninguna.
--     Las que tienen dinero siguen el procedimiento de desistimiento (autorización y revisión de Finanzas).
--   · Ventas: reutiliza contratos_anular (conserva cuotas y pagos como historial, cancela compromisos y avisos pendientes,
--     revierte hitos). El departamento no se libera solo: la reserva con dinero sigue el desistimiento.
--   · Usuarios: reasigna sus clientes y negociaciones (clientes_asignar) y desactiva el acceso (config_actualizar_usuario).
--     Sus operaciones quedan registradas a su nombre.
-- Cada operación queda en la bitácora admin_eliminaciones con motivo, administrador, fecha, operaciones y resultado.

insert into public.permissions (clave, modulo, descripcion)
values ('config.eliminaciones', 'Configuración', 'Eliminaciones administrativas: cancelar reservas, anular ventas y desactivar usuarios')
on conflict (clave) do nothing;
insert into public.role_permissions (role_id, permiso)
select 'administrador', 'config.eliminaciones' where exists (select 1 from public.roles where id = 'administrador')
on conflict do nothing;

create table if not exists public.admin_eliminaciones (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('reservas', 'venta', 'usuario')),
  motivo text not null check (char_length(btrim(motivo)) >= 10),
  actor_id uuid not null references auth.users (id),
  actor_nombre text not null default '',
  fecha timestamptz not null default now(),
  operaciones jsonb not null,
  resultado jsonb not null
);
alter table public.admin_eliminaciones enable row level security;
revoke all on public.admin_eliminaciones from anon, authenticated;
grant select on public.admin_eliminaciones to authenticated;
drop policy if exists "eliminaciones consultar" on public.admin_eliminaciones;
create policy "eliminaciones consultar" on public.admin_eliminaciones for select to authenticated
  using (public.tiene_permiso('config.eliminaciones'));

create or replace function public.admin_eliminaciones_exigir() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.tiene_permiso('config.eliminaciones') then
    raise exception 'Solo el administrador puede hacer eliminaciones administrativas' using errcode = '42501';
  end if;
end $$;

-- Situación de una reserva para cancelarla: datos para el resumen e impedimentos. No cambia nada.
create or replace function public.admin_reserva_situacion(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r reservations; v_imp text[] := '{}'; v_rep int; v_conf int; v_rech int; v_contrato record; v_desist int; v_recibido numeric;
begin
  select * into r from reservations where id = p_id;
  if not found then return jsonb_build_object('id', p_id, 'existe', false, 'impedimentos', jsonb_build_array('La reserva no existe')); end if;
  select count(*) filter (where estado = 'reportado'), count(*) filter (where estado = 'confirmado'), count(*) filter (where estado = 'rechazado')
    into v_rep, v_conf, v_rech from comprobantes_pago where reservation_id = p_id;
  select codigo, estado into v_contrato from contracts where reservation_id = p_id and estado <> 'anulado' limit 1;
  select count(*) into v_desist from desistimientos where reservation_id = p_id and estado = 'pendiente';
  v_recibido := public.desistimiento_recibido(r.id, r.opportunity_id);

  if r.estado in ('anulada', 'rechazada') then v_imp := v_imp || ('La reserva ya está ' || r.estado); end if;
  if v_contrato.codigo is not null then v_imp := v_imp || ('Tiene el contrato ' || v_contrato.codigo || ' (' || v_contrato.estado || '): anula primero la venta'); end if;
  if v_rep > 0 then v_imp := v_imp || 'Tiene pagos reportados: Finanzas debe resolverlos o se gestiona por desistimiento'::text; end if;
  if v_conf > 0 or r.monto_recibido is not null or r.estado in ('pago_verificado', 'confirmada') or coalesce(v_recibido, 0) > 0 then
    v_imp := v_imp || 'Tiene dinero recibido: se anula por el procedimiento de desistimiento, con autorización y revisión de Finanzas'::text;
  end if;
  if v_desist > 0 then v_imp := v_imp || 'Tiene un desistimiento en trámite'::text; end if;

  return jsonb_build_object(
    'id', r.id, 'existe', true, 'codigo', r.codigo, 'client_id', r.client_id,
    'cliente', (select nombre from clients where id = r.client_id), 'unidad', r.codigo_unidad,
    'departamento', (select dpt from inventory_units where codigo = r.codigo_unidad),
    'estado', r.estado, 'monto_reserva', r.monto_reserva,
    'comprobantes', jsonb_build_object('reportados', v_rep, 'confirmados', v_conf, 'rechazados', v_rech),
    'contrato', case when v_contrato.codigo is null then null else jsonb_build_object('codigo', v_contrato.codigo, 'estado', v_contrato.estado) end,
    'documentos', (select count(*) from contract_document_versions d join contracts c on c.id = d.contract_id where c.reservation_id = p_id and d.estado <> 'anulado'),
    'impedimentos', to_jsonb(v_imp),
    'libera_departamento', cardinality(v_imp) = 0
  );
end $$;

-- Resumen previo para varias reservas (solo lectura).
create or replace function public.admin_eliminaciones_revisar(p_reservas uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.admin_eliminaciones_exigir();
  return coalesce((select jsonb_agg(public.admin_reserva_situacion(x)) from unnest(coalesce(p_reservas, '{}')) x), '[]'::jsonb);
end $$;

-- Cancela una o varias reservas de un mismo cliente. Todo o nada: si alguna tiene impedimento, no se cancela ninguna.
create or replace function public.admin_cancelar_reservas(p_ids uuid[], p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m text := btrim(coalesce(p_motivo, '')); v_sit jsonb; v_todas jsonb := '[]'::jsonb; v_clientes int; v_imp text[] := '{}'; r reservations; v_id uuid;
begin
  perform public.admin_eliminaciones_exigir();
  if char_length(v_m) < 10 then raise exception 'Indica el motivo de la cancelación (mínimo 10 caracteres)'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Elige al menos una reserva'; end if;
  -- Bloquea las reservas en orden para evitar cambios simultáneos.
  perform 1 from reservations where id = any (p_ids) order by id for update;
  select count(distinct client_id) into v_clientes from reservations where id = any (p_ids);
  if v_clientes <> 1 or (select count(*) from reservations where id = any (p_ids)) <> cardinality(p_ids) then
    raise exception 'Las reservas deben existir y pertenecer a un mismo cliente';
  end if;
  foreach v_id in array p_ids loop
    v_sit := public.admin_reserva_situacion(v_id);
    v_todas := v_todas || jsonb_build_array(v_sit);
    if jsonb_array_length(v_sit -> 'impedimentos') > 0 then
      v_imp := v_imp || ((v_sit ->> 'codigo') || ': ' || (select string_agg(x, '; ') from jsonb_array_elements_text(v_sit -> 'impedimentos') x));
    end if;
  end loop;
  if cardinality(v_imp) > 0 then
    raise exception 'No se canceló ninguna reserva. %', array_to_string(v_imp, ' | ');
  end if;

  perform set_config('app.flujo', 'on', true);
  perform set_config('app.cumplimiento', 'on', true);
  foreach v_id in array p_ids loop
    select * into r from reservations where id = v_id;
    update opportunities set etapa = 'cotizacion' where id = r.opportunity_id and etapa <> 'perdida';
    update reservations set estado = 'anulada', motivo_anulacion = 'Cancelación administrativa: ' || v_m where id = v_id;
    perform public.auditar('Cancelación administrativa de reserva', 'reserva', v_id::text, v_m, jsonb_build_object('estado', r.estado), jsonb_build_object('estado', 'anulada'), null);
  end loop;
  insert into admin_eliminaciones (tipo, motivo, actor_id, actor_nombre, operaciones, resultado)
  values ('reservas', v_m, auth.uid(), coalesce((select nombre from profiles where id = auth.uid()), ''), v_todas,
          jsonb_build_object('canceladas', cardinality(p_ids), 'departamentos_disponibles', (select jsonb_agg(codigo_unidad) from reservations where id = any (p_ids))));
  return jsonb_build_object('canceladas', cardinality(p_ids));
end $$;

-- Anula una venta (contrato) conservando su historial. Reutiliza contratos_anular con sus controles.
create or replace function public.admin_anular_venta(p_contract uuid, p_motivo text, p_evidencia text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m text := btrim(coalesce(p_motivo, '')); c contracts; v_antes jsonb;
begin
  perform public.admin_eliminaciones_exigir();
  if char_length(v_m) < 10 then raise exception 'Indica el motivo de la anulación (mínimo 10 caracteres)'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found then raise exception 'La venta no existe'; end if;
  v_antes := jsonb_build_object('codigo', c.codigo, 'estado', c.estado, 'unidad', c.codigo_unidad,
    'pagos_verificados', (select coalesce(sum(monto), 0) from payments where contract_id = c.id and estado = 'verificado'),
    'cuotas', (select count(*) from installments where contract_id = c.id));
  perform public.contratos_anular(p_contract, v_m, p_evidencia);
  insert into admin_eliminaciones (tipo, motivo, actor_id, actor_nombre, operaciones, resultado)
  values ('venta', v_m, auth.uid(), coalesce((select nombre from profiles where id = auth.uid()), ''), jsonb_build_array(v_antes),
          jsonb_build_object('contrato', c.codigo, 'estado', 'anulado', 'historial_conservado', true,
                             'nota', 'Pagos y cuotas se conservan como historial. La reserva con dinero se resuelve por desistimiento.'));
  return jsonb_build_object('contrato', c.codigo, 'estado', 'anulado');
end $$;

-- Desactiva un usuario y reasigna sus clientes y negociaciones abiertas. Todo o nada.
create or replace function public.admin_desactivar_usuario(p_user uuid, p_reasignar_a uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_m text := btrim(coalesce(p_motivo, '')); u profiles; v_c record; v_clientes int := 0; v_ops int := 0; v_proyectos text[];
begin
  perform public.admin_eliminaciones_exigir();
  if char_length(v_m) < 10 then raise exception 'Indica el motivo de la desactivación (mínimo 10 caracteres)'; end if;
  if p_user = auth.uid() then raise exception 'No puedes desactivar tu propio usuario'; end if;
  select * into u from profiles where id = p_user for update;
  if not found then raise exception 'El usuario no existe'; end if;
  if u.estado <> 'activo' then raise exception 'El usuario ya está inactivo'; end if;
  if exists (select 1 from clients where asesor_id = p_user) or exists (select 1 from opportunities where responsable_id = p_user and etapa <> 'perdida') then
    if p_reasignar_a is null then raise exception 'El usuario tiene clientes o negociaciones: elige a quién reasignarlos'; end if;
    if p_reasignar_a = p_user then raise exception 'Elige a otra persona para reasignar'; end if;
  end if;
  for v_c in select id, version from clients where asesor_id = p_user order by id loop
    perform public.clientes_asignar(v_c.id, v_c.version, p_reasignar_a, 'Reasignación por desactivación del usuario: ' || v_m, false);
    v_clientes := v_clientes + 1;
  end loop;
  for v_c in select id from opportunities where responsable_id = p_user and etapa <> 'perdida' order by id loop
    perform public.oportunidades_transferir(v_c.id, p_reasignar_a, 'Reasignación por desactivación del usuario: ' || v_m);
    v_ops := v_ops + 1;
  end loop;
  select coalesce(array_agg(project_id), '{}') into v_proyectos from user_projects where user_id = p_user;
  perform public.config_actualizar_usuario(p_user, u.rol_id, u.alcance, u.supervisor_id, u.equipo_id, v_proyectos, 'inactivo', v_m);
  insert into admin_eliminaciones (tipo, motivo, actor_id, actor_nombre, operaciones, resultado)
  values ('usuario', v_m, auth.uid(), coalesce((select nombre from profiles where id = auth.uid()), ''),
          jsonb_build_array(jsonb_build_object('usuario', u.nombre, 'rol', u.rol_id, 'reasignado_a', (select nombre from profiles where id = p_reasignar_a))),
          jsonb_build_object('estado', 'inactivo', 'clientes_reasignados', v_clientes, 'negociaciones_reasignadas', v_ops));
  return jsonb_build_object('clientes_reasignados', v_clientes, 'negociaciones_reasignadas', v_ops);
end $$;

revoke all on function public.admin_eliminaciones_exigir() from public, anon, authenticated;
revoke all on function public.admin_reserva_situacion(uuid) from public, anon, authenticated;
revoke all on function public.admin_eliminaciones_revisar(uuid[]) from public, anon;
revoke all on function public.admin_cancelar_reservas(uuid[], text) from public, anon;
revoke all on function public.admin_anular_venta(uuid, text, text) from public, anon;
revoke all on function public.admin_desactivar_usuario(uuid, uuid, text) from public, anon;
grant execute on function public.admin_eliminaciones_revisar(uuid[]) to authenticated;
grant execute on function public.admin_cancelar_reservas(uuid[], text) to authenticated;
grant execute on function public.admin_anular_venta(uuid, text, text) to authenticated;
grant execute on function public.admin_desactivar_usuario(uuid, uuid, text) to authenticated;
