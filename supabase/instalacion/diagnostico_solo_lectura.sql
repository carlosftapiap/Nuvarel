-- AMURA · Diagnóstico de SOLO LECTURA. No crea, cambia ni borra nada.
-- Cómo usarlo: SQL Editor del proyecto → pegar todo → Run. Es una sola consulta porque el editor solo muestra el último resultado.
-- Qué compartir: la tabla completa de resultados (botón Export → Copy as CSV o JSON). No contiene claves, contraseñas ni datos de personas.

with huellas(funcion, anterior, actual) as (values
    ('cliente_en_alcance', '442c31bf43339542017eb4e4031eb044', 'eab00b6e411de37d77d33c04937fb8f8'),
    ('clients_proteger_asesor', '6e4a9f547b63b15178c7b39576dd7110', '5a3e951051ebe4264c50391f59847fc1'),
    ('clientes_tomar', '16cdf26813e602cbcccf3fac3d26f0e9', 'f032244120723925aeb33516a4c7429c'),
    ('clientes_datos', 'b1f0746dd5ef188e59abca3d35dcc76d', '73c952c8d7ba9ad8aa3b408ad917e814'),
    ('clientes_crear', '9fc3627416cf6ef313e53a0e4cc8c93e', '1be3f28a33b274e420ed27d333bb2efc'),
    ('clientes_editar', '8be1ac9c4012bf726808818588f3739d', '499a0a1b91ac8da8a17e0e156b4675e1'),
    ('clientes_personas', '24331804ab0cd0648d0b5d572fce9a1b', 'bb152f4173cb69ad890c6def440b2c0e'),
    ('clientes_importar_revisar', '2c71bf925f4dd9e84724c158abe241d1', '383cbac0e09204e5db851f47decc7744'),
    ('clientes_importar', 'c1a60467c1810396f5ecdcf0b067a54e', 'eb4851b02e3a02cb8d7f14722a8a85a6'),
    ('clientes_asignar', '4c469f98673b54503f0f642cdc6bbb0b', 'b02b34c0da566eb0d90545328210eed1'),
    ('clientes_corredor_valido', '', '9d60ff5e378b27a4511540e41f73a159'),
    ('clientes_autorizar_acceso', '', '10f6b703b64f1092648b38a0d97174ea'),
    ('clientes_revocar_acceso', '', 'adfa3bee02db9af56ed45de42436f709'),
    ('clientes_corregir_origen', '', '3d7d72020691ca2131b8a91b87dee869'),
    ('clientes_corredores', '', 'd513aeecbd9231255b2bffc1e2722bef'),
    ('clientes_importacion_habilitada', '', '048cc3906d9dc4578445d7880bf859e8'),
    ('clientes_importacion_definir', '', '9ff7523b0fc7ef9ee942eb20ddd18587')
), funciones as (
  select p.proname as funcion, pg_get_function_identity_arguments(p.oid) as argumentos, md5(replace(p.prosrc, chr(13), '')) as huella,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
)
select * from (
  select 1 as orden, 'tabla o vista' as seccion, 'client_imports' as objeto, case when to_regclass('public.client_imports') is null then 'NO EXISTE' else 'existe' end as resultado
  union all
  select 1 as orden, 'tabla o vista' as seccion, 'client_access' as objeto, case when to_regclass('public.client_access') is null then 'NO EXISTE' else 'existe' end as resultado
  union all
  select 1 as orden, 'tabla o vista' as seccion, 'client_import_settings' as objeto, case when to_regclass('public.client_import_settings') is null then 'NO EXISTE' else 'existe' end as resultado
  union all
  select 1 as orden, 'tabla o vista' as seccion, 'contract_documents' as objeto, case when to_regclass('public.contract_documents') is null then 'NO EXISTE' else 'existe' end as resultado
  union all
  select 1 as orden, 'tabla o vista' as seccion, 'contract_milestones' as objeto, case when to_regclass('public.contract_milestones') is null then 'NO EXISTE' else 'existe' end as resultado
  union all
  select 1 as orden, 'tabla o vista' as seccion, 'ventas_historicas' as objeto, case when to_regclass('public.ventas_historicas') is null then 'NO EXISTE' else 'existe' end as resultado
  union all
  select 2, 'columna', 'clients.version', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'version') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'clients.documento', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'documento') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'clients.corredor_origen_id', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clients' and column_name = 'corredor_origen_id') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'client_activities.referencia', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_activities' and column_name = 'referencia') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'opportunities.tipologia', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'opportunities' and column_name = 'tipologia') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'contracts.corredor_origen_id', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'corredor_origen_id') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'contracts.origen_detalle', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'origen_detalle') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'contracts.fecha_firma', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'fecha_firma') then 'existe' else 'NO EXISTE' end
  union all
  select 2, 'columna', 'plan_activities.responsable_externo', case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'plan_activities' and column_name = 'responsable_externo') then 'existe' else 'NO EXISTE' end
  union all
  select 3, 'funcion', h.funcion, case when count(f.funcion) = 0 then 'NO EXISTE'
      when bool_or(f.huella = h.actual) then 'igual al repositorio actual'
      when bool_or(f.huella = h.anterior) then 'version anterior'
      else 'OTRA VERSION' end || ' | firmas: ' || coalesce(string_agg(f.argumentos, ' / '), '-') || ' | anon: ' || coalesce(bool_or(f.anon)::text, '-') || ' | authenticated: ' || coalesce(bool_or(f.auth)::text, '-')
    from huellas h left join funciones f on f.funcion = h.funcion group by h.funcion, h.anterior, h.actual
  union all
  select 4, 'marca', 'cotizaciones_emitir guarda la cedula', case when bool_or(prosrc like '%''documento'', c.documento%') then 'si' else 'NO' end from pg_proc where proname = 'cotizaciones_emitir'
  union all
  select 4, 'marca', 'contrato_datos_venta guarda origen_detalle', case when bool_or(prosrc like '%origen_detalle%') then 'si' else 'NO' end from pg_proc where proname = 'contrato_datos_venta'
  union all
  select 5, 'politica', schemaname || '.' || tablename || ' · ' || policyname, cmd || ' | usa: ' || left(coalesce(qual, '-'), 160) || ' | comprueba: ' || left(coalesce(with_check, '-'), 80)
    from pg_policies where schemaname = 'public' and tablename in ('clients', 'client_activities', 'opportunities', 'quotes', 'reservations', 'contracts')
  union all
  select 6, 'disparador', event_object_table || ' · ' || trigger_name, string_agg(event_manipulation, ', ') from information_schema.triggers
    where trigger_schema = 'public' and event_object_table in ('clients', 'opportunities', 'quotes', 'contracts') group by event_object_table, trigger_name
  union all
  select 7, 'registros', 'clients', (select count(*)::text from public.clients)
  union all
  select 7, 'registros', 'client_activities', (select count(*)::text from public.client_activities)
  union all
  select 7, 'registros', 'opportunities', (select count(*)::text from public.opportunities)
  union all
  select 7, 'registros', 'quotes', (select count(*)::text from public.quotes)
  union all
  select 7, 'registros', 'reservations', (select count(*)::text from public.reservations)
  union all
  select 7, 'registros', 'contracts', (select count(*)::text from public.contracts)
  union all
  select 7, 'registros', 'installments', (select count(*)::text from public.installments)
  union all
  select 7, 'registros', 'payments', (select count(*)::text from public.payments)
  union all
  select 7, 'registros', 'inventory_units', (select count(*)::text from public.inventory_units)
  union all
  select 7, 'registros', 'profiles', (select count(*)::text from public.profiles)
  union all
  select 7, 'registros', 'client_imports', (select count(*)::text from public.client_imports)
  union all
  select 7, 'registros', 'contract_documents', (select count(*)::text from public.contract_documents)
  union all
  select 7, 'registros', 'contract_milestones', (select count(*)::text from public.contract_milestones)
  union all
  select 7, 'registros', 'auth.users', (select count(*)::text from auth.users)
  union all
  select 8, 'version', 'postgres', current_setting('server_version')
) r order by orden, objeto;
