-- Responsable externo: una persona que no es usuario de la app se guarda como texto en responsable_externo.
-- responsable_texto conserva el texto original del cronograma y no se toca.
-- Sin usuario ni externo = "Sin responsable". No se puede combinar usuario y externo.

alter table public.plan_activities add column if not exists responsable_externo text;

drop function if exists public.plan_actividad_asignar(uuid, int, uuid, uuid, uuid[], text);
drop function if exists public.plan_actividad_asignar(uuid, int, uuid, uuid, uuid[], text, text);

create or replace function public.plan_actividad_asignar(p_id uuid, p_version int, p_responsable uuid, p_equipo uuid, p_colaboradores uuid[], p_motivo text, p_responsable_externo text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a plan_activities; v_m text := public.plan_motivo(p_motivo); v_antes uuid[]; v_externo text := nullif(btrim(p_responsable_externo), '');
begin
  a := public.plan_tomar(p_id, p_version, 'plan.asignar');
  if p_responsable is not null and v_externo is not null then raise exception 'Elige un usuario o escribe un nombre externo, no ambos'; end if;
  if v_externo is not null and char_length(v_externo) < 3 then raise exception 'El nombre del responsable externo debe tener al menos 3 caracteres'; end if;
  if p_responsable is not null and not exists (select 1 from profiles where id = p_responsable and estado = 'activo') then raise exception 'El responsable debe ser un usuario activo'; end if;
  -- Asignar a alguien fuera del propio alcance no está permitido (salvo alcance de empresa).
  if p_responsable is not null and not public.en_alcance(p_responsable) then raise exception 'No puedes asignar a una persona fuera de tu alcance' using errcode = '42501'; end if;
  select array_agg(user_id order by user_id) into v_antes from plan_activity_collaborators where activity_id = p_id;
  update plan_activities set responsable_id = p_responsable, responsable_externo = v_externo, equipo_id = p_equipo, version = version + 1, updated_at = now(), updated_by = auth.uid() where id = p_id;
  delete from plan_activity_collaborators where activity_id = p_id;
  insert into plan_activity_collaborators select p_id, unnest(coalesce(p_colaboradores, '{}')) on conflict do nothing;
  perform public.plan_registrar(p_id, 'Asignar responsable', v_m,
    jsonb_build_object('responsable_id', a.responsable_id, 'responsable_externo', a.responsable_externo, 'equipo_id', a.equipo_id, 'colaboradores', v_antes),
    jsonb_build_object('responsable_id', p_responsable, 'responsable_externo', v_externo, 'equipo_id', p_equipo, 'colaboradores', p_colaboradores));
end $$;

revoke all on function public.plan_actividad_asignar(uuid, int, uuid, uuid, uuid[], text, text) from public, anon;
grant execute on function public.plan_actividad_asignar(uuid, int, uuid, uuid, uuid[], text, text) to authenticated;
