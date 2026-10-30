-- AMURA · Diagnóstico de solo lectura. No crea, cambia ni borra nada. Ejecutar en el SQL Editor del proyecto.
-- Pega los resultados completos en el chat. No contiene claves ni datos personales.

-- 1. Objetos esperados, uno por fila: existe y coincide con la versión del repositorio.
select objeto, existe from (values
  ('tabla client_access', to_regclass('public.client_access') is not null),
  ('tabla client_import_settings', to_regclass('public.client_import_settings') is not null),
  ('tabla client_imports', to_regclass('public.client_imports') is not null),
  ('tabla contract_documents', to_regclass('public.contract_documents') is not null),
  ('tabla contract_milestones', to_regclass('public.contract_milestones') is not null),
  ('vista ventas_historicas', to_regclass('public.ventas_historicas') is not null),
  ('columna clients.documento', exists (select 1 from information_schema.columns where table_name = 'clients' and column_name = 'documento')),
  ('columna clients.corredor_origen_id', exists (select 1 from information_schema.columns where table_name = 'clients' and column_name = 'corredor_origen_id')),
  ('columna clients.version', exists (select 1 from information_schema.columns where table_name = 'clients' and column_name = 'version')),
  ('columna contracts.origen_detalle', exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'origen_detalle')),
  ('columna contracts.fecha_firma', exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'fecha_firma')),
  ('columna contracts.corredor_origen_id', exists (select 1 from information_schema.columns where table_name = 'contracts' and column_name = 'corredor_origen_id'))
) as x(objeto, existe) order by objeto;

-- 2. Funciones de los dos archivos: nombre, argumentos, si anon/authenticated pueden ejecutarlas.
select p.proname as funcion, pg_get_function_identity_arguments(p.oid) as argumentos,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ejecuta,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ejecuta
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'clientes\_%' or p.proname like 'oportunidades\_%' or p.proname like 'contratos\_%'
  or p.proname in ('cotizaciones_emitir', 'cotizaciones_aceptar', 'reservas_solicitar', 'reservas_fijar_monto', 'reservas_adjuntar_comprobante', 'cliente_en_alcance', 'cotizacion_en_historial', 'contrato_datos_venta', 'contrato_proteger', 'contrato_hito_firma', 'cotizacion_en_historial'))
order by 1, 2;

-- 3. Disparadores de las tablas de clientes, cotizaciones, reservas y contratos.
select event_object_table as tabla, trigger_name as disparador from information_schema.triggers
where event_object_schema = 'public' and event_object_table in ('clients', 'opportunities', 'quotes', 'reservations', 'contracts', 'client_activities')
order by 1, 2;

-- 4. Políticas RLS vigentes.
select tablename as tabla, policyname as politica, cmd as operacion, roles from pg_policies
where schemaname = 'public' and tablename in ('clients', 'client_activities', 'opportunities', 'quotes', 'reservations', 'contracts', 'contract_documents', 'contract_milestones', 'client_access')
order by 1, 2;

-- 5. Historial de migraciones que Supabase registra, si existe.
select version, name from supabase_migrations.schema_migrations order by version;

-- 6. Recuento de datos reales (solo para comparar después con la copia de seguridad).
select (select count(*) from public.clients) as clientes, (select count(*) from public.quotes) as cotizaciones,
  (select count(*) from public.reservations) as reservas, (select count(*) from public.contracts) as contratos,
  (select count(*) from public.opportunities) as oportunidades;
