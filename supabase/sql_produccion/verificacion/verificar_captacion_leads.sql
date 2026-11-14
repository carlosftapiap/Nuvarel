-- AMURA · Verificación funcional de la captación de leads en producción (0013). NO deja datos: todo ocurre en una sola
-- transacción que se revierte con la excepción final. El resultado aparece como mensaje de error «VERIFICACION {...}».
-- Resultado esperado:
--   rotacion "ABA" · mismo_celular "duplicado" · domingo "pendiente" · lunes_asignados 1 · domingo_despues "asignado"
--   primer_contacto true · clientes_creados 4 · etapa "nuevo" · comisiones 0 · disponibles 72
-- Usa los celulares +593999990001 a +593999990004 (se detiene si alguno ya existe). Requiere al menos dos vendedores activos.
-- Ejecutar completo en el SQL Editor de Supabase.

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; r jsonb; res jsonb := '{}'::jsonb; rot text := ''; l record; n int; i int;
  cfg jsonb := '{"activo": true, "dias": [1,2,3,4,5], "hora_inicio": "09:00", "hora_fin": "18:00"}';
  lunes timestamptz := '2026-11-16 15:00+00'; domingo timestamptz := '2026-11-15 15:00+00';
begin
  select id into v_admin from profiles where rol_id = 'administrador' and estado = 'activo' order by nombre limit 1;
  select id into v_a from profiles where rol_id = 'asesor' and estado = 'activo' order by nombre limit 1;
  select id into v_b from profiles where rol_id = 'asesor' and estado = 'activo' order by nombre offset 1 limit 1;
  if exists (select 1 from clients where public.celular_normalizado(telefono) in ('+593999990001', '+593999990002', '+593999990003', '+593999990004')) then
    raise exception 'Celulares de verificación en uso';
  end if;
  -- Como administrador: dos vendedores habilitados de lunes a viernes, 09:00 a 18:00.
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.leads_configurar_participante(v_a, cfg, 'Verificación en transacción revertida');
  perform public.leads_configurar_participante(v_b, cfg, 'Verificación en transacción revertida');
  -- Tres leads el lunes a las 10:00: rotación por turnos.
  for i in 1..3 loop
    r := public.leads_ingresar(jsonb_build_object('fuente', 'facebook', 'nombre', 'Verificación ' || i, 'telefono', '+59399999000' || i, 'consentimiento', true,
      'consentimiento_version', 'verificacion', 'campana', 'Prueba'), lunes + make_interval(mins => i));
    select estado, asignado_a into l from leads where id = (r ->> 'lead')::uuid;
    rot := rot || case l.asignado_a when v_a then 'A' when v_b then 'B' else '?' end;
  end loop;
  res := res || jsonb_build_object('rotacion', rot);
  -- El mismo celular escrito de otra forma: no crea otro cliente.
  r := public.leads_ingresar(jsonb_build_object('fuente', 'web', 'nombre', 'Verificación repetida', 'telefono', '0999990001', 'consentimiento', true, 'consentimiento_version', 'verificacion'), lunes + interval '10 minutes');
  res := res || jsonb_build_object('mismo_celular', r ->> 'estado');
  -- Domingo: nadie atiende; queda pendiente y se asigna el lunes.
  r := public.leads_ingresar(jsonb_build_object('fuente', 'instagram', 'nombre', 'Verificación domingo', 'telefono', '+593999990004', 'consentimiento', true, 'consentimiento_version', 'verificacion'), domingo);
  res := res || jsonb_build_object('domingo', r ->> 'estado');
  n := public.leads_asignar_pendientes(lunes + interval '20 minutes');
  res := res || jsonb_build_object('lunes_asignados', n, 'domingo_despues', (select estado from leads where id = (r ->> 'lead')::uuid));
  -- Primer contacto: una llamada del vendedor.
  select client_id, asignado_a into l from leads where nombre = 'Verificación 1';
  perform set_config('request.jwt.claim.sub', l.asignado_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', l.asignado_a, 'role', 'authenticated')::text, true);
  perform public.clientes_registrar_actividad(null, l.client_id, 'llamada', (now() at time zone 'America/Guayaquil')::date, 'Verificación de primer contacto', null);
  res := res || jsonb_build_object('primer_contacto', (select primer_contacto_en is not null from leads where nombre = 'Verificación 1'),
    'clientes_creados', (select count(*) from clients where nombre like 'Verificación%'),
    'etapa', (select etapa::text from clients where id = l.client_id),
    'avisos_encolados', (select count(*) from cobranza_alertas where entidad = 'lead'),
    'comisiones', (select count(*) from comisiones),
    'disponibles', (select count(*) from inventory_units where estado = 'disponible'));
  raise exception 'VERIFICACION %', res;
end $$;
