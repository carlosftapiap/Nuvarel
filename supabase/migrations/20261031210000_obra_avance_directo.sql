-- AMURA · Avance de obra sin segunda aprobación: lo que registra un responsable autorizado actualiza de inmediato el avance.
--   · obra_avance_guardar: actividad, responsable, fecha y porcentaje. Conserva quién registró, cuándo y el valor anterior.
--   · Se cierran obra_avance_registrar y obra_avance_validar. Las ponderaciones y los cronogramas siguen requiriendo aprobación.
--   · El avance de un frente usa las ponderaciones aprobadas; sin ellas, el promedio simple de sus etapas.
-- CAMBIA DATOS EXISTENTES: un avance pendiente de validar pasa a contar como avance actual, con la nota «Aprobación eliminada»,
--   solo si quien lo registró es un usuario activo con permiso obra.avance. Los demás siguen pendientes y sin contar; los rechazados no cambian.
--   No crea ni borra avances, y conserva quién los registró. Revisarlos antes con supabase/instalacion/revisar_avances_pendientes.sql.
-- Revertir: volver a conceder execute a las funciones antiguas y restaurar obra_resumen desde 20261031120000_avance_obra.sql.
--   Para deshacer el cambio de datos: estado = 'pendiente' donde validacion_nota = 'Aprobación eliminada', y recalcular esas actividades.
-- Ejecutar después de 20261031200000_storage_comprobantes.sql y con un respaldo verificado.

alter table public.obra_avances add column if not exists responsable_id uuid references public.profiles (id);
alter table public.obra_avances add column if not exists responsable_nombre text;

create or replace function public.obra_avance_guardar(p_actividad uuid, p_fecha date, p_avance numeric, p_responsable uuid, p_responsable_texto text, p_observaciones text) returns uuid
language plpgsql security definer set search_path = public as $$
declare a public.obra_actividades; v_id uuid := gen_random_uuid(); v_obs text := btrim(coalesce(p_observaciones, '')); v_texto text := btrim(coalesce(p_responsable_texto, ''));
  v_resp text; v_nombre text := public.obra_nombre_actual(); v_actual numeric; v_ini date; v_fin date; v_antes numeric;
begin
  perform public.obra_requiere('obra.avance');
  select * into a from obra_actividades where id = p_actividad for update;
  if not found then raise exception 'La actividad no existe'; end if;
  if a.estado = 'cancelada' then raise exception 'La actividad está cancelada'; end if;
  if exists (select 1 from obra_actividades where parent_id = p_actividad and estado <> 'cancelada') then
    raise exception 'Esta actividad se calcula con sus subactividades: registra el avance en ellas';
  end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha no puede ser futura'; end if;
  if p_avance is null or p_avance < 0 or p_avance > 100 then raise exception 'El avance debe estar entre 0 y 100 %%'; end if;
  if p_responsable is not null then
    select nombre into v_resp from profiles where id = p_responsable;
    if not found then raise exception 'El responsable no existe'; end if;
    v_texto := '';
  else
    if char_length(v_texto) < 3 then raise exception 'Indica el responsable de la actividad'; end if;
    v_resp := v_texto;
  end if;
  v_antes := a.avance_validado;
  insert into obra_avances (id, actividad_id, fecha_corte, avance, avance_anterior, observaciones, estado, registrado_nombre, validado_por, validado_nombre, validado_en, validacion_nota, responsable_id, responsable_nombre)
  values (v_id, p_actividad, p_fecha, round(p_avance, 2), v_antes, v_obs, 'validado', v_nombre, auth.uid(), v_nombre, now(), 'Registro directo', p_responsable, v_resp);
  perform public.obra_recalcular(p_actividad);
  select avance_validado into v_actual from obra_actividades where id = p_actividad;
  v_ini := case when v_actual > 0 then least(coalesce(a.real_inicio, p_fecha), p_fecha) else a.real_inicio end;
  v_fin := case when v_actual >= 100 then greatest(p_fecha, coalesce(v_ini, p_fecha)) end;
  update obra_actividades set estado = case when v_actual >= 100 then 'completada' when v_actual > 0 then 'en_ejecucion' else 'por_programar' end,
    real_inicio = v_ini, real_fin = v_fin, responsable_id = p_responsable, responsable_texto = v_texto, version = version + 1, actualizada_en = now()
  where id = p_actividad;
  perform public.obra_historial_registrar(a.frente_id, p_actividad, case when v_antes is not null and p_avance < v_antes then 'Corregir avance' else 'Registrar avance' end,
    p_fecha::text || ': ' || round(p_avance, 2)::text || ' %. Responsable: ' || v_resp,
    jsonb_build_object('avance', v_antes), jsonb_build_object('avance', round(p_avance, 2), 'fecha_corte', p_fecha, 'responsable', v_resp));
  return v_id;
end $$;

-- Promedio simple: cada etapa pesa igual, a cada nivel. Sin registro cuenta como 0.
create or replace function public.obra_avance_simple(p_id uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare a public.obra_actividades; v_suma numeric := 0; v_n int := 0; h record;
begin
  select * into a from obra_actividades where id = p_id;
  for h in select id from obra_actividades where parent_id = p_id and estado <> 'cancelada' loop
    v_n := v_n + 1;
    v_suma := v_suma + public.obra_avance_simple(h.id);
  end loop;
  if v_n = 0 then return coalesce(a.avance_validado, 0); end if;
  return v_suma / v_n;
end $$;

create or replace function public.obra_avance_actual(p_frente uuid) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare v numeric := public.obra_avance_frente(p_frente, 'validado'); v_suma numeric := 0; v_n int := 0; h record;
begin
  if v is not null then return v; end if;
  for h in select id from obra_actividades where frente_id = p_frente and parent_id is null and estado <> 'cancelada' loop
    v_n := v_n + 1;
    v_suma := v_suma + public.obra_avance_simple(h.id);
  end loop;
  if v_n = 0 then return null; end if;
  return round(v_suma / v_n, 2);
end $$;

create or replace function public.obra_resumen() returns table (
  frente_id uuid, codigo text, nombre text, descripcion text, orden smallint, pesos_aprobados boolean, avance_validado numeric, ultimo_corte date,
  actividades int, actividades_con_avance int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.tiene_permiso('obra.resumen') or public.tiene_permiso('obra.ver')) then raise exception 'No tienes permiso para consultar el avance de obra' using errcode = '42501'; end if;
  return query
    select f.id, f.codigo, f.nombre, f.descripcion, f.orden, f.pesos_aprobados_en is not null,
      public.obra_avance_actual(f.id),
      (select max(a.ultimo_corte_validado) from obra_actividades a where a.frente_id = f.id),
      (select count(*)::int from obra_actividades a where a.frente_id = f.id and a.estado <> 'cancelada'
         and not exists (select 1 from obra_actividades h where h.parent_id = a.id and h.estado <> 'cancelada')),
      (select count(*)::int from obra_actividades a where a.frente_id = f.id and a.estado <> 'cancelada' and a.avance_validado is not null
         and not exists (select 1 from obra_actividades h where h.parent_id = a.id and h.estado <> 'cancelada'))
    from obra_frentes f order by f.orden;
end $$;

/* --------------------------------------------- avances que esperaban validación */

do $d$
declare r record;
begin
  for r in
    select distinct v.actividad_id, x.frente_id from obra_avances v join obra_actividades x on x.id = v.actividad_id
    join profiles pr on pr.id = v.registrado_por
    where v.estado = 'pendiente' and pr.estado = 'activo' and (
      exists (select 1 from user_permission_overrides o where o.user_id = pr.id and o.permiso = 'obra.avance' and o.valor = 'permitir')
      or exists (select 1 from role_permissions rp where rp.role_id = pr.rol_id and rp.permiso = 'obra.avance'))
      and not exists (select 1 from user_permission_overrides o where o.user_id = pr.id and o.permiso = 'obra.avance' and o.valor <> 'permitir')
  loop
    update obra_avances v set estado = 'validado', validado_nombre = 'Aprobación eliminada', validado_en = now(), validacion_nota = 'Aprobación eliminada'
    where v.actividad_id = r.actividad_id and v.estado = 'pendiente' and exists (
      select 1 from profiles pr where pr.id = v.registrado_por and pr.estado = 'activo' and (
        exists (select 1 from user_permission_overrides o where o.user_id = pr.id and o.permiso = 'obra.avance' and o.valor = 'permitir')
        or exists (select 1 from role_permissions rp where rp.role_id = pr.rol_id and rp.permiso = 'obra.avance'))
        and not exists (select 1 from user_permission_overrides o where o.user_id = pr.id and o.permiso = 'obra.avance' and o.valor <> 'permitir'));
    perform public.obra_recalcular(r.actividad_id);
    insert into obra_historial (frente_id, actividad_id, user_id, usuario, accion, motivo)
    values (r.frente_id, r.actividad_id, null, 'Cambio de proceso', 'Avance pendiente incorporado', 'Registrado por un usuario autorizado; se eliminó la segunda aprobación');
  end loop;
  -- El estado coincide con el porcentaje. Pausadas y canceladas son decisiones técnicas: no cambian.
  update obra_actividades a set estado = case when a.avance_validado >= 100 then 'completada' when a.avance_validado > 0 then 'en_ejecucion' else 'por_programar' end
  where a.avance_validado is not null and a.estado not in ('pausada', 'cancelada')
    and not exists (select 1 from obra_actividades h where h.parent_id = a.id and h.estado <> 'cancelada');
end $d$;

revoke all on function public.obra_avance_registrar(uuid, date, numeric, text, text) from public, anon, authenticated;
revoke all on function public.obra_avance_validar(uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.obra_avance_simple(uuid) from public, anon, authenticated;
revoke all on function public.obra_avance_actual(uuid) from public, anon, authenticated;
revoke all on function public.obra_avance_guardar(uuid, date, numeric, uuid, text, text) from public, anon;
grant execute on function public.obra_avance_guardar(uuid, date, numeric, uuid, text, text) to authenticated;
