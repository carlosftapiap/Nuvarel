-- AMURA · Celular / WhatsApp de los usuarios (sin ejecutar en producción).
-- Revisado antes de crear: profiles no tiene teléfono; corredores y clientes tienen el suyo, pero son otras personas.
-- Se guarda aparte de profiles para no exponerlo: profiles lo leen muchos perfiles (nombres en listas), el celular no.
--   · Lo ve el propio usuario y quien administra usuarios (config.usuarios). Nadie más.
--   · Lo registra o cambia solo config.usuarios, con la normalización ya usada en Clientes (celular_normalizado):
--     09XXXXXXXX → +5939XXXXXXXX (Ecuador por defecto); otros países con «+» y su código. Se guarda en formato E.164.
--   · Es opcional. Vaciarlo lo borra. Queda en la auditoría con el número enmascarado.
--   · Preparado para futuros avisos por WhatsApp o SMS: no se integra ningún servicio de mensajería.
-- Solo agrega una tabla y una función. No modifica perfiles, roles ni permisos.

create table if not exists public.usuarios_contacto (
  user_id uuid primary key references auth.users (id),
  celular text check (celular is null or celular ~ '^\+[1-9][0-9]{7,14}$'),
  actualizado_por uuid references auth.users (id),
  actualizado_en timestamptz not null default now()
);
alter table public.usuarios_contacto enable row level security;
revoke all on public.usuarios_contacto from anon, authenticated;
grant select on public.usuarios_contacto to authenticated;
drop policy if exists "contacto de usuarios consultar" on public.usuarios_contacto;
create policy "contacto de usuarios consultar" on public.usuarios_contacto for select to authenticated
  using (user_id = auth.uid() or public.tiene_permiso('config.usuarios'));

-- Registra, cambia o borra (vacío) el celular de un usuario. Devuelve el número normalizado.
create or replace function public.config_usuario_celular(p_user uuid, p_celular text) returns text
language plpgsql security definer set search_path = public as $$
declare v_texto text := nullif(btrim(coalesce(p_celular, '')), ''); v_num text; v_antes text;
begin
  if auth.uid() is null or not public.tiene_permiso('config.usuarios') then
    raise exception 'Solo quien administra usuarios registra su celular' using errcode = '42501';
  end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'El usuario no existe'; end if;
  if v_texto is not null then
    v_num := public.celular_normalizado(v_texto);
    if v_num is null then
      raise exception 'Celular no válido: escribe 09XXXXXXXX para Ecuador o el número internacional con «+» y el código del país';
    end if;
  end if;
  select celular into v_antes from usuarios_contacto where user_id = p_user;
  if v_antes is not distinct from v_num then return v_num; end if;
  insert into usuarios_contacto (user_id, celular, actualizado_por, actualizado_en) values (p_user, v_num, auth.uid(), now())
  on conflict (user_id) do update set celular = excluded.celular, actualizado_por = excluded.actualizado_por, actualizado_en = excluded.actualizado_en;
  -- En la auditoría solo los últimos cuatro dígitos.
  perform public.auditar('Celular de usuario', 'usuario', p_user::text, case when v_num is null then 'Celular retirado' else 'Celular registrado' end,
    jsonb_build_object('celular', case when v_antes is null then null else '···' || right(v_antes, 4) end),
    jsonb_build_object('celular', case when v_num is null then null else '···' || right(v_num, 4) end), null);
  return v_num;
end $$;

revoke all on function public.config_usuario_celular(uuid, text) from public, anon;
grant execute on function public.config_usuario_celular(uuid, text) to authenticated;
