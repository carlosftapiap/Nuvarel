-- AMURA · Conexión de la aplicación con el flujo comercial.
-- Ejecutar después de 20261029000000_flujo_comercial.sql y luego volver a ejecutar supabase/seed_roles.sql (agrega Finanzas, Legal y JARVAL).
-- No modifica clientes, inventario, cotizaciones ni reservas existentes: cambia políticas, funciones y la configuración de Gerencia.

do $$ begin
  if to_regclass('public.opportunities') is null or to_regclass('public.contracts') is null or to_regprocedure('public.reservas_aprobar(uuid, text)') is null then
    raise exception 'Falta el flujo comercial: ejecuta antes 20261029000000_flujo_comercial.sql';
  end if;
end $$;

-- Reemplaza un fragmento exacto de una función existente; si ya se aplicó no hace nada y si no lo encuentra se detiene.
create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

/* ------------------------------------------------------------- sesión de la app */

-- Perfil, permisos efectivos y alcance del usuario conectado, en una sola llamada. Sin perfil devuelve null.
create or replace function public.mi_sesion() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'nombre', p.nombre, 'email', p.email, 'estado', p.estado, 'rol', p.rol_id, 'rolNombre', r.nombre,
    'alcance', coalesce(p.alcance, r.alcance),
    'permisos', coalesce((select jsonb_agg(k.clave order by k.clave) from permissions k where public.tiene_permiso(k.clave)), '[]'::jsonb),
    'usuariosAlcance', coalesce((select jsonb_agg(u) from public.usuarios_en_alcance() u), '[]'::jsonb),
    'proyectos', coalesce((select jsonb_agg(up.project_id) from user_projects up where up.user_id = p.id), '[]'::jsonb))
  from profiles p join roles r on r.id = p.rol_id
  where p.id = auth.uid()
$$;

/* ------------------------------------------- lectura por permiso (no por rol fijo) */

drop policy if exists "leer inventario" on public.inventory_units;
create policy "leer inventario" on public.inventory_units for select to authenticated
  using (public.tiene_permiso('inventario.ver') or public.tiene_permiso('cotizaciones.ver') or public.tiene_permiso('reservas.ver')
         or public.tiene_permiso('ventas.ver') or public.tiene_permiso('cobranzas.ver'));
drop policy if exists "leer parametros" on public.pricing_params;
create policy "leer parametros" on public.pricing_params for select to authenticated
  using (public.tiene_permiso('inventario.ver') or public.tiene_permiso('financiamiento.simular') or public.tiene_permiso('cotizaciones.ver'));
drop policy if exists "leer historial precios" on public.inventory_price_history;
create policy "leer historial precios" on public.inventory_price_history for select to authenticated using (public.tiene_permiso('inventario.ver'));
drop policy if exists "leer historial estados" on public.inventory_status_history;
create policy "leer historial estados" on public.inventory_status_history for select to authenticated using (public.tiene_permiso('inventario.ver'));

drop policy if exists "ver actividades" on public.client_activities;
drop policy if exists "registrar actividades" on public.client_activities;
create policy "ver actividades" on public.client_activities for select to authenticated
  using (public.tiene_permiso('clientes.ver') and public.cliente_en_alcance(client_id));
create policy "registrar actividades" on public.client_activities for insert to authenticated
  with check (user_id = auth.uid() and public.tiene_permiso('clientes.editar') and public.cliente_en_alcance(client_id));

-- El rol del historial es el rol configurable del perfil (texto), no la lista fija anterior.
alter table public.inventory_status_history alter column rol type text using rol::text;
alter table public.inventory_price_history alter column rol type text using rol::text;

/* ----------------------------------------------------------------- clientes */

-- La atribución la fija la base de datos: quien registra al cliente.
create or replace function public.clients_antes_insertar() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atribucion_usuario_id := coalesce(auth.uid(), new.created_by);
  return new;
end $$;
drop trigger if exists clients_antes_insertar on public.clients;
create trigger clients_antes_insertar before insert on public.clients for each row execute function public.clients_antes_insertar();

-- Una oportunidad no cambia de cliente.
create or replace function public.oportunidad_cliente_fijo() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.client_id is distinct from old.client_id then raise exception 'Una oportunidad no puede cambiar de cliente'; end if;
  if new.codigo_unidad is distinct from old.codigo_unidad and exists (select 1 from quotes q where q.opportunity_id = old.id) then
    raise exception 'La oportunidad ya tiene cotizaciones; crea otra oportunidad para otra unidad';
  end if;
  return new;
end $$;
drop trigger if exists oportunidad_cliente_fijo on public.opportunities;
create trigger oportunidad_cliente_fijo before update on public.opportunities for each row execute function public.oportunidad_cliente_fijo();

/* ------------------------------------------------------------- cotizaciones */

-- Las cotizaciones solo se emiten con cotizaciones_emitir: el precio lo calcula la base de datos, no el navegador.
drop policy if exists "crear cotizaciones" on public.quotes;

create or replace function public.cotizaciones_emitir(p_opportunity uuid, p_descuento_pct numeric, p_vigencia_dias int, p_observaciones text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o opportunities; c clients; u inventory_units; pp pricing_params; a profiles;
  v_hoy date := (now() at time zone 'America/Guayaquil')::date;
  v_desc_pct numeric := coalesce(p_descuento_pct, 0);
  v_lista numeric; v_desc numeric; v_final numeric; v_reserva numeric; v_cuotas numeric; v_meses int;
  v_cuota numeric; v_ultima numeric; v_entrega numeric; v_patio numeric; v_area numeric;
  v_id uuid; v_numero text; v_intento int := 0; v_prefijo text;
begin
  if not public.tiene_permiso('cotizaciones.crear') then raise exception 'Sin permiso para emitir cotizaciones' using errcode = '42501'; end if;
  if v_desc_pct < 0 or v_desc_pct > 50 then raise exception 'El descuento debe estar entre 0%% y 50%%'; end if;
  if v_desc_pct > 0 and not public.tiene_permiso('cotizaciones.descuento') then raise exception 'Sin permiso para autorizar descuentos' using errcode = '42501'; end if;
  if p_vigencia_dias is null or p_vigencia_dias < 1 or p_vigencia_dias > 90 then raise exception 'La vigencia debe ser de 1 a 90 días'; end if;
  if char_length(coalesce(p_observaciones, '')) > 600 then raise exception 'Las observaciones superan 600 caracteres'; end if;
  select * into o from opportunities where id = p_opportunity;
  if not found or not (public.en_alcance(o.responsable_id) or public.cliente_en_alcance(o.client_id)) then
    raise exception 'Oportunidad inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  if o.etapa not in ('captacion', 'calificacion', 'visita', 'cotizacion') then raise exception 'La oportunidad está en %; no admite nuevas cotizaciones', o.etapa; end if;
  if o.codigo_unidad is null then raise exception 'Asigna una unidad a la oportunidad antes de cotizar'; end if;
  select * into u from inventory_units where codigo = o.codigo_unidad;
  if u.estado not in ('disponible', 'por_confirmar') then raise exception 'La unidad % está %; no puede cotizarse', u.codigo, u.estado; end if;
  select * into c from clients where id = o.client_id;
  select * into pp from pricing_params where id = 1;
  select * into a from profiles where id = auth.uid();

  -- Misma regla que src/features/financiamiento/plan.ts
  v_lista := public.precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, u.usd_m2, pp.patio_usd_m2);
  v_desc := round(v_lista * v_desc_pct / 100, 2);
  v_final := round(v_lista - v_desc, 2);
  v_reserva := round(v_final * pp.reserva_pct / 100, 2);
  v_cuotas := round(v_final * pp.cuotas_pct / 100, 2);
  v_meses := case u.edificio when 1 then pp.meses_e1 else pp.meses_e2 end;
  v_cuota := round(v_cuotas / v_meses, 2);
  v_ultima := round(v_cuotas - v_cuota * (v_meses - 1), 2);
  v_entrega := round(v_final - v_reserva - v_cuotas, 2);
  v_area := u.area_m2 + u.bodega_m2;
  v_patio := round(u.patio_m2 * pp.patio_usd_m2, 2);

  v_prefijo := 'COT-' || to_char(v_hoy, 'YYYY') || '-';
  loop
    v_numero := v_prefijo || lpad((coalesce((select max(substring(numero from char_length(v_prefijo) + 1)::int) from quotes
                                             where numero ~ ('^' || v_prefijo || '[0-9]+$')), 0) + 1)::text, 4, '0');
    begin
      insert into quotes (numero, fecha, valida_hasta, codigo, cliente, asesor, descuento_pct, precio_lista, precio_final, plan, observaciones,
                          created_by, client_id, opportunity_id, descuento_autorizado_por)
      values (v_numero, v_hoy, v_hoy + p_vigencia_dias, u.codigo,
              jsonb_build_object('nombre', c.nombre, 'email', c.email, 'telefono', c.telefono),
              jsonb_build_object('nombre', a.nombre, 'email', a.email, 'telefono', ''),
              v_desc_pct, v_lista, v_final,
              jsonb_build_object('precioLista', v_lista, 'descuentoPct', v_desc_pct, 'descuentoMonto', v_desc, 'precioFinal', v_final,
                'areaVendibleM2', v_area, 'usdM2Final', case when v_area > 0 then round((v_final - v_patio) / v_area, 2) else 0 end,
                'reservaPct', pp.reserva_pct, 'cuotasPct', pp.cuotas_pct, 'entregaPct', round(100 - pp.reserva_pct - pp.cuotas_pct, 2),
                'reserva', v_reserva, 'cuotasTotal', v_cuotas, 'meses', v_meses, 'cuotaMensual', v_cuota, 'ultimaCuota', v_ultima,
                'contraEntrega', v_entrega),
              trim(coalesce(p_observaciones, '')), auth.uid(), o.client_id, o.id,
              case when v_desc_pct > 0 then auth.uid() end)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_intento := v_intento + 1;
      if v_intento > 5 then raise; end if;
    end;
  end loop;
  update opportunities set etapa = 'cotizacion' where id = o.id and etapa in ('captacion', 'calificacion', 'visita');
  perform public.auditar('Emitir cotización', 'cotizacion', v_id::text, 'Cotización ' || v_numero, null,
    jsonb_build_object('unidad', u.codigo, 'precio_lista', v_lista, 'descuento_pct', v_desc_pct, 'precio_final', v_final));
  return v_id;
end $$;

/* -------------------------------------------------------------------- reservas */

-- El comprobante del cliente debe estar registrado antes de que Finanzas verifique el ingreso.
select pg_temp.parchar('public.reservas_verificar_pago(uuid, numeric, date, text, text)',
  'if r.created_by = auth.uid() then',
  'if r.comprobante_subido_en is null then raise exception ''Falta registrar el comprobante del cliente''; end if;
  if r.created_by = auth.uid() then');

-- El historial registra el rol real de quien aprueba.
select pg_temp.parchar('public.reservas_aprobar(uuid, text)',
  'coalesce(public.current_app_role(), ''gerencia'')',
  '(select pr.rol_id from profiles pr where pr.id = auth.uid())');

-- Anular una reserva aprobada también deja constancia en el historial del inventario.
select pg_temp.parchar('public.reservas_anular(uuid, text)',
  'update clients set etapa = ''negociacion'' where id = r.client_id and etapa = ''reserva'';',
  'update clients set etapa = ''negociacion'' where id = r.client_id and etapa = ''reserva'';
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), r.codigo_unidad, ''reservado'', ''disponible'', ''Reserva '' || r.codigo || '' anulada'', r.id);');

-- Firmar el contrato pasa la unidad a promesa de compraventa.
select pg_temp.parchar('public.contratos_firmar(uuid, text, text)',
  'update opportunities set etapa = ''cobranza'' where id = c.opportunity_id;',
  'update opportunities set etapa = ''cobranza'' where id = c.opportunity_id;
  update inventory_units set estado = ''promesa'', updated_at = now(), updated_by = auth.uid() where codigo = c.codigo_unidad and estado = ''reservado'';
  if found then
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), c.codigo_unidad, ''reservado'', ''promesa'', ''Contrato '' || c.codigo || '' firmado'', c.reservation_id);
  end if;');

/* ---------------------------------------------------- estados del inventario */

-- Cambios manuales por permiso. Reservado y promesa solo los asigna el flujo (aprobación de reserva y firma de contrato).
create or replace function public.inventario_cambiar_estado(p_codigo text, p_estado public.estado_comercial, p_motivo text, p_reserva_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_actual public.estado_comercial; v_ok boolean;
begin
  if not public.tiene_permiso('inventario.cambiar_estado') then raise exception 'Sin permiso para cambiar estados' using errcode = '42501'; end if;
  if char_length(coalesce(trim(p_motivo), '')) < 5 then raise exception 'Motivo obligatorio'; end if;
  select estado into v_actual from inventory_units where codigo = p_codigo for update;
  if not found then raise exception 'Unidad inexistente'; end if;
  if p_estado in ('reservado', 'promesa') or v_actual = 'reservado' then
    raise exception 'Reservado y promesa se asignan desde Reservas y Contratos' using errcode = '42501';
  end if;
  v_ok := case v_actual
    when 'por_confirmar' then p_estado <> 'por_confirmar'
    when 'disponible' then p_estado in ('bloqueado', 'no_disponible')
    when 'bloqueado' then p_estado in ('disponible', 'no_disponible')
    when 'promesa' then p_estado in ('vendido', 'disponible')
    when 'no_disponible' then p_estado in ('disponible', 'bloqueado')
    else false end;
  if not v_ok then raise exception 'Transición no permitida: % -> %', v_actual, p_estado; end if;
  if v_actual = 'promesa' and p_estado = 'disponible' and exists (select 1 from contracts c where c.codigo_unidad = p_codigo and c.estado <> 'anulado') then
    raise exception 'La unidad tiene un contrato vigente';
  end if;
  update inventory_units set estado = p_estado, reserva_id = case when p_estado = 'vendido' then reserva_id end, updated_at = now(), updated_by = auth.uid()
  where codigo = p_codigo;
  insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), p_codigo, v_actual, p_estado, trim(p_motivo), p_reserva_id);
end $$;

/* --------------------------------------------- responsabilidades por perfil */

-- Finanzas verifica el ingreso; Gerencia aprueba. Gerencia supervisa toda la empresa.
do $$ begin
  if exists (select 1 from role_permissions where role_id = 'gerencia' and permiso = 'reservas.verificar_pago') then
    delete from role_permissions where role_id = 'gerencia' and permiso = 'reservas.verificar_pago';
    insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (null, 'Editar rol', 'rol', 'gerencia', 'Separación de funciones: Finanzas verifica pagos y Gerencia aprueba',
            jsonb_build_object('reservas.verificar_pago', true), jsonb_build_object('reservas.verificar_pago', false));
  end if;
  if exists (select 1 from roles where id = 'gerencia' and alcance <> 'empresa') then
    update roles set alcance = 'empresa' where id = 'gerencia';
    insert into audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (null, 'Editar rol', 'rol', 'gerencia', 'Gerencia comercial supervisa toda la operación',
            jsonb_build_object('alcance', 'equipo'), jsonb_build_object('alcance', 'empresa'));
  end if;
end $$;

revoke all on function public.mi_sesion() from public, anon;
revoke all on function public.cotizaciones_emitir(uuid, numeric, int, text) from public, anon;
grant execute on function public.mi_sesion() to authenticated;
grant execute on function public.cotizaciones_emitir(uuid, numeric, int, text) to authenticated;
