-- AMURA · Usuarios y permisos (5/5): clientes, cotizaciones y reservas pasan a permisos + alcance.
-- No modifica datos de clientes, cotizaciones ni reservas; solo políticas, una columna nueva y las verificaciones de las funciones.

drop policy if exists "ver clientes" on public.clients;
drop policy if exists "crear clientes" on public.clients;
drop policy if exists "editar clientes" on public.clients;
create policy "ver clientes" on public.clients for select to authenticated
  using (public.tiene_permiso('clientes.ver') and (public.en_alcance(asesor_id) or public.en_alcance(created_by)));
create policy "crear clientes" on public.clients for insert to authenticated
  with check (public.tiene_permiso('clientes.editar') and created_by = auth.uid()
              and (asesor_id = auth.uid() or (public.tiene_permiso('clientes.asignar') and public.en_alcance(asesor_id))));
create policy "editar clientes" on public.clients for update to authenticated
  using (public.tiene_permiso('clientes.editar') and (public.en_alcance(asesor_id) or public.en_alcance(created_by)))
  with check (public.en_alcance(asesor_id) or public.en_alcance(created_by));

-- Atribución de origen: se fija al crear y no cambia al reasignar.
alter table public.clients add column if not exists atribucion_usuario_id uuid references auth.users (id);
update public.clients set atribucion_usuario_id = created_by where atribucion_usuario_id is null;

create or replace function public.clients_proteger_asesor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.asesor_id is distinct from old.asesor_id then
    if not (public.tiene_permiso('clientes.asignar') and public.en_alcance(new.asesor_id)) then
      raise exception 'Sin permiso para reasignar a esa persona' using errcode = '42501';
    end if;
    insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), 'Reasignar cliente', 'cliente', new.id::text, 'Reasignación de asesor',
            jsonb_build_object('asesor_id', old.asesor_id), jsonb_build_object('asesor_id', new.asesor_id));
  end if;
  new.atribucion_usuario_id := old.atribucion_usuario_id;
  new.updated_at := now();
  return new;
end $$;

drop policy if exists "leer cotizaciones" on public.quotes;
create policy "leer cotizaciones" on public.quotes for select to authenticated
  using (public.tiene_permiso('cotizaciones.ver') and public.en_alcance(created_by));

drop policy if exists "ver reservas" on public.reservations;
create policy "ver reservas" on public.reservations for select to authenticated
  using (public.tiene_permiso('reservas.ver') and (public.en_alcance(created_by)
         or exists (select 1 from clients c where c.id = client_id and public.en_alcance(c.asesor_id))));

-- Cambia la verificación por rol fijo de una función existente por una verificación de permiso.
-- Si ya se cambió, no hace nada; si el texto no coincide, se detiene en lugar de dejar la función sin control.
create or replace function pg_temp.exigir_permiso(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_fn regprocedure := to_regprocedure(p_firma); v_def text; v_new text;
begin
  if v_fn is null then raise notice '% no existe; se omite', p_firma; return; end if;
  v_def := pg_get_functiondef(v_fn);
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró la verificación esperada en %; revisar la función antes de continuar', p_firma; end if;
  execute v_new;
end $$;

-- Verificar pago y confirmar son permisos separados; ambos se exigen para confirmar.
select pg_temp.exigir_permiso('public.reservas_confirmar(uuid, text, numeric)',
  'if v_rol not in (''administrador'', ''gerencia'') then raise exception ''Solo gerencia o administración confirma reservas''',
  'if not (public.tiene_permiso(''reservas.verificar_pago'') and public.tiene_permiso(''reservas.confirmar'')) then raise exception ''Sin permiso para verificar el pago y confirmar''');
select pg_temp.exigir_permiso('public.reservas_anular(uuid, text)',
  'if v_rol not in (''administrador'', ''gerencia'') then',
  'if not public.tiene_permiso(''reservas.anular'') then');
select pg_temp.exigir_permiso('public.inventario_ajustar_precio(text, numeric, text, text[], smallint, text, text)',
  'if v_rol is null or v_rol <> ''administrador'' then',
  'if not public.tiene_permiso(''precios.aprobar'') then');
