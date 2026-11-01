-- AMURA · Datos de configuración solo para usuarios activos.
--   Hasta ahora, cualquier cuenta autenticada podía leerlos, aunque no tuviera perfil en AMURA:
--   datos del emisor de recibos, receptor de pagos, roles, permisos, proyectos, equipos y porcentaje de comisión.
-- No cambia datos ni afecta a los usuarios activos. Se puede repetir.
-- Revertir: volver a crear estas ocho políticas con using (true), restaurar comisiones_porcentaje desde su migración y borrar usuario_activo().
-- Ejecutar con un respaldo verificado.

create or replace function public.usuario_activo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and estado = 'activo')
$$;
revoke all on function public.usuario_activo() from public, anon;
grant execute on function public.usuario_activo() to authenticated;

drop policy if exists "configuracion de cobros legible" on public.payment_settings;
create policy "configuracion de cobros legible" on public.payment_settings for select to authenticated using (public.usuario_activo());
drop policy if exists "ver importacion" on public.client_import_settings;
create policy "ver importacion" on public.client_import_settings for select to authenticated using (public.usuario_activo());
drop policy if exists "emisor de recibos legible" on public.emisor_recibos;
create policy "emisor de recibos legible" on public.emisor_recibos for select to authenticated using (public.usuario_activo());
drop policy if exists "catalogo legible" on public.permissions;
create policy "catalogo legible" on public.permissions for select to authenticated using (public.usuario_activo());
drop policy if exists "roles legibles" on public.roles;
create policy "roles legibles" on public.roles for select to authenticated using (public.usuario_activo());
drop policy if exists "permisos de rol legibles" on public.role_permissions;
create policy "permisos de rol legibles" on public.role_permissions for select to authenticated using (public.usuario_activo());
drop policy if exists "proyectos legibles" on public.projects;
create policy "proyectos legibles" on public.projects for select to authenticated using (public.usuario_activo());
drop policy if exists "equipos legibles" on public.teams;
create policy "equipos legibles" on public.teams for select to authenticated using (public.usuario_activo());
drop policy if exists "gerencias de equipo legibles" on public.team_managers;
create policy "gerencias de equipo legibles" on public.team_managers for select to authenticated using (public.usuario_activo());

create or replace function public.comisiones_porcentaje() returns numeric
language sql stable security definer set search_path = public as $$
  -- Sin sesión (procesos internos) sigue respondiendo; con sesión, solo a usuarios activos.
  select porcentaje_base from comision_parametros where id = 1 and (auth.uid() is null or public.usuario_activo())
$$;
