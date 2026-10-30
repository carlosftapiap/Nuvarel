-- AMURA · Validación de RLS con los usuarios de prueba. Ejecutar en el proyecto de pruebas, después de usuarios_prueba.sql.
-- Actúa como cada usuario, comprueba qué ve y qué se le niega, y al final deshace todo: no deja datos.
-- Resultado esperado: ok = true en todas las filas.

create temp table if not exists rls_resultado (n int, prueba text, esperado text, obtenido text, ok boolean) on commit preserve rows;
truncate rls_resultado;

do $$
declare
  res jsonb := '[]'::jsonb;
  uid jsonb;
  v_cliente uuid; v_n int; v_txt text; i int;
begin
  select jsonb_object_agg(email, id) into uid from public.profiles where email like '%@prueba.local';
  if uid is null or not uid ? 'corredor1@prueba.local' then raise exception 'Ejecuta antes usuarios_prueba.sql'; end if;

  begin
    /* corredor 1 crea su cliente y una negociación */
    perform set_config('request.jwt.claim.sub', uid ->> 'corredor1@prueba.local', true);
    set local role authenticated;
    v_cliente := public.clientes_crear(null, '{"nombre": "Prueba RLS", "telefono": "0999999901", "origen": "whatsapp"}'::jsonb, (uid ->> 'corredor1@prueba.local')::uuid);
    select count(*) into v_n from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('Corredor 1 ve su cliente', '1', v_n::text));
    begin
      update public.clients set nombre = 'Cambiado' where id = v_cliente;
      v_txt := 'permitido';
    exception when others then v_txt := 'rechazado'; end;
    res := res || jsonb_build_array(jsonb_build_array('Corredor 1 no escribe directo en la tabla', 'rechazado', v_txt));
    begin
      insert into public.clients (nombre, telefono, origen, asesor_id, created_by) values ('Directo', '0999999902', 'whatsapp', auth.uid(), auth.uid());
      v_txt := 'permitido';
    exception when others then v_txt := 'rechazado'; end;
    res := res || jsonb_build_array(jsonb_build_array('Corredor 1 no inserta directo', 'rechazado', v_txt));
    begin
      perform public.clientes_mover_etapa(v_cliente, null, 'reserva', null, null);
      v_txt := 'permitido';
    exception when others then v_txt := 'rechazado'; end;
    res := res || jsonb_build_array(jsonb_build_array('Nadie marca Reserva a mano', 'rechazado', v_txt));
    select count(*) into v_n from public.contracts;
    res := res || jsonb_build_array(jsonb_build_array('Corredor 1 no ve contratos', '0', v_n::text));
    reset role;

    /* corredor 2: sin acceso */
    perform set_config('request.jwt.claim.sub', uid ->> 'corredor2@prueba.local', true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('Corredor 2 no ve el cliente ajeno', '0', v_n::text));
    begin
      perform public.clientes_registrar_actividad(null, v_cliente, 'nota', current_date, 'Ajena', null);
      v_txt := 'permitido';
    exception when others then v_txt := 'rechazado'; end;
    res := res || jsonb_build_array(jsonb_build_array('Corredor 2 no opera sobre el cliente ajeno', 'rechazado', v_txt));
    reset role;

    /* supervisora: ve a su equipo */
    perform set_config('request.jwt.claim.sub', uid ->> 'supervisora@prueba.local', true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('Supervisora ve el cliente de su equipo', '1', v_n::text));
    begin
      perform public.clientes_asignar(v_cliente, null, (uid ->> 'corredor2@prueba.local')::uuid, 'Fuera de su equipo');
      v_txt := 'permitido';
    exception when others then v_txt := 'rechazado'; end;
    res := res || jsonb_build_array(jsonb_build_array('Supervisora no asigna fuera de su equipo', 'rechazado', v_txt));
    reset role;

    /* administración reasigna: el anterior pierde el acceso */
    perform set_config('request.jwt.claim.sub', uid ->> 'admin@prueba.local', true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('Administración ve todos', '1', v_n::text));
    perform public.clientes_asignar(v_cliente, null, (uid ->> 'corredor2@prueba.local')::uuid, 'Prueba de reasignación');
    reset role;

    perform set_config('request.jwt.claim.sub', uid ->> 'corredor1@prueba.local', true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('Tras reasignar, el anterior no lo ve', '0', v_n::text));
    reset role;

    perform set_config('request.jwt.claim.sub', uid ->> 'corredor2@prueba.local', true);
    set local role authenticated;
    select count(*) into v_n from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('Tras reasignar, el nuevo lo ve', '1', v_n::text));
    reset role;

    select atribucion_usuario_id::text into v_txt from public.clients where id = v_cliente;
    res := res || jsonb_build_array(jsonb_build_array('La atribución no cambia al reasignar', uid ->> 'corredor1@prueba.local', v_txt));

    /* escritura en contratos */
    perform set_config('request.jwt.claim.sub', uid ->> 'admin@prueba.local', true);
    set local role authenticated;
    begin
      insert into public.contract_milestones (contract_id, hito, fecha, motivo) values (gen_random_uuid(), 'escritura', current_date, 'Directo');
      v_txt := 'permitido';
    exception when others then v_txt := 'rechazado'; end;
    res := res || jsonb_build_array(jsonb_build_array('Ni administración escribe directo en hitos de contrato', 'rechazado', v_txt));
    reset role;

    raise exception 'AMURA_DESHACER';
  exception when others then
    if sqlerrm <> 'AMURA_DESHACER' then raise; end if;
  end;

  for i in 0 .. jsonb_array_length(res) - 1 loop
    insert into rls_resultado values (i + 1, res -> i ->> 0, res -> i ->> 1, res -> i ->> 2, (res -> i ->> 1) = (res -> i ->> 2));
  end loop;
end $$;

select n, prueba, esperado, obtenido, ok from rls_resultado order by n;
