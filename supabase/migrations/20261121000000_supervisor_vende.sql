-- El Supervisor también vende: tiene las herramientas del vendedor y su propia cartera, además de la supervisión de su equipo.
-- Sus permisos ya incluyen todos los del vendedor y su alcance ya incluye su propia cartera: aquí solo se impide que decida
-- sobre su propia cartera cuando la decisión corresponde a una autoridad superior (anulaciones y reasignaciones de sus clientes).
-- Gerencia y administración (alcance empresa) siguen decidiendo como hasta ahora. No crea roles ni usuarios.

do $$
begin
  if to_regprocedure('public.desistimiento_tomar(uuid)') is null or to_regprocedure('public.clientes_resolver_reasignacion(uuid, boolean, text)') is null then
    raise exception 'Faltan dependencias: instala antes Desistimiento y Clientes únicos';
  end if;
end $$;

-- La operación es sobre la cartera propia y quien decide no tiene alcance de empresa (p. ej. un Supervisor con sus clientes).
create or replace function public.cartera_propia_sin_autoridad(p_asesor uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_asesor = auth.uid(), false) and coalesce((
    select coalesce(p.alcance, r.alcance) from profiles p join roles r on r.id = p.rol_id where p.id = auth.uid()
  ), '') <> 'empresa'
$$;
revoke all on function public.cartera_propia_sin_autoridad(uuid) from public, anon;
grant execute on function public.cartera_propia_sin_autoridad(uuid) to authenticated;

-- Anulaciones: además de que quien registra no decide, un Supervisor no autoriza ni rechaza la de su propio cliente.
create or replace function public.desistimiento_tomar(p_id uuid) returns public.desistimientos
language plpgsql security definer set search_path = public as $$
declare d desistimientos; v_cliente uuid; v_asesor uuid;
begin
  select client_id into v_cliente from desistimientos where id = p_id;
  if not found or not public.cliente_en_alcance(v_cliente) then raise exception 'Solicitud inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  select asesor_id into v_asesor from clients where id = v_cliente for update;
  select * into d from desistimientos where id = p_id for update;
  if d.estado <> 'pendiente' then raise exception 'Esta solicitud ya está %', d.estado; end if;
  if d.registrado_por = auth.uid() then raise exception 'Quien registra la solicitud no puede autorizarla ni rechazarla' using errcode = '42501'; end if;
  if public.cartera_propia_sin_autoridad(v_asesor) then
    raise exception 'Es tu propio cliente: esta anulación la decide Gerencia' using errcode = '42501';
  end if;
  return d;
end $$;

-- Reasignaciones: un Supervisor no resuelve una solicitud sobre un cliente suyo; la resuelve Gerencia.
create or replace function public.clientes_resolver_reasignacion(p_id uuid, p_aprobar boolean, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare s client_reassignment_requests; c clients; v_m text := btrim(coalesce(p_motivo, ''));
begin
  if not public.tiene_permiso('clientes.asignar') then raise exception 'Sin permiso para reasignar clientes' using errcode = '42501'; end if;
  if char_length(v_m) < 5 then raise exception 'Indica el motivo de la decisión'; end if;
  select * into s from client_reassignment_requests where id = p_id for update;
  if not found or s.estado <> 'pendiente' then raise exception 'La solicitud no existe o ya fue resuelta'; end if;
  if s.solicitante_id = auth.uid() then raise exception 'Quien pide la reasignación no puede resolverla' using errcode = '42501'; end if;
  if public.cartera_propia_sin_autoridad(s.asesor_actual) then
    raise exception 'Es tu propio cliente: esta reasignación la resuelve Gerencia' using errcode = '42501';
  end if;
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

create or replace function public.clientes_reasignaciones() returns table (id uuid, client_id uuid, cliente text, solicitante text, asesor_actual text, motivo text, estado text, resolucion text, creado_en timestamptz, resuelto_en timestamptz, puede_resolver boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.client_id, case when public.cliente_en_alcance(s.client_id) then c.nombre else 'Cliente de otro equipo' end,
         ps.nombre, pa.nombre, s.motivo, s.estado, s.resolucion, s.creado_en, s.resuelto_en,
         s.estado = 'pendiente' and s.solicitante_id <> auth.uid() and public.tiene_permiso('clientes.asignar') and public.cliente_en_alcance(s.client_id) and public.en_alcance(s.solicitante_id)
           and not public.cartera_propia_sin_autoridad(s.asesor_actual)
  from client_reassignment_requests s join clients c on c.id = s.client_id
  left join profiles ps on ps.id = s.solicitante_id left join profiles pa on pa.id = s.asesor_actual
  where s.solicitante_id = auth.uid() or (public.tiene_permiso('clientes.asignar') and (public.cliente_en_alcance(s.client_id) or public.en_alcance(s.solicitante_id)))
  order by s.creado_en desc
$$;

-- Descripción del perfil, solo si sigue siendo la inicial.
update public.roles set descripcion = 'Vende con su propia cartera y supervisa a su equipo'
where id = 'supervisor' and descripcion = 'Seguimiento y asignación dentro de su equipo (p. ej. líder de corredores)';
