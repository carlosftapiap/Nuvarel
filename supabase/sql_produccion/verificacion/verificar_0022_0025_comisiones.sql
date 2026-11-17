-- AMURA · Diagnóstico de producción: 0022 (planos), 0023 (Cumplimiento de reservas), 0024 (cuentas receptoras),
-- 0025 (retiro de planos_publicar) y restos de la versión VELKROVA de Comisiones.
-- SOLO LECTURA: no modifica nada. Ejecutar en el SQL Editor; cada consulta devuelve un objeto JSON.
-- Huellas esperadas (md5 del cuerpo) según el repositorio:
--   reservas_verificar_pago ff291e69ab19a2f7be0a83e8cb8fb4de · reservas_registrar_pagador 75568ee94a044ea88fda60728c335e96
--   reservas_cumplimiento_resolver ea2486c401c11a2743f1ac2e66dc8db2 · config_cuenta_registrar cccd2ee60724eff7298c4935d26866bb
--   config_cuenta_desactivar 2b76e4f03a47708a96f99bdb46e09293

-- 1. Cumplimiento de reservas (0023): columnas, restricciones, funciones, disparadores, política, permisos, historial y tarea programada.
select json_build_object(
 'columnas', (select json_agg(column_name order by column_name) from information_schema.columns where table_schema='public' and table_name='reservations' and column_name in ('cumplimiento_estado','apartado_hasta','prorrogas','cumplimiento_decidido_por','cumplimiento_decidido_en','pagador_nombre','pagador_identificacion','pagador_relacion','pagador_referencia')),
 'checks', (select json_agg(conname order by conname) from pg_constraint where conrelid='public.reservations'::regclass and contype='c' and (pg_get_constraintdef(oid) ilike '%cumplimiento%' or pg_get_constraintdef(oid) ilike '%pagador%' or pg_get_constraintdef(oid) ilike '%prorrogas%')),
 'funciones', (select json_object_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(replace(p.prosrc, chr(13), ''))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('reservas_registrar_pagador','reservas_liberar_apartados_vencidos','reservas_cumplimiento_alta','reservas_cumplimiento_historial_alta','reservas_cumplimiento_guardia','reservas_cumplimiento_resolver','reservas_cumplimiento_reenviar','reservas_cumplimiento_prorrogar','reservas_vencer_apartado','reservas_verificar_pago')),
 'disparadores', (select json_agg(tgname order by tgname) from pg_trigger where tgrelid='public.reservations'::regclass and tgname like 'reservas_cumplimiento%'),
 'politica', (select json_agg(policyname) from pg_policies where tablename='reservas_cumplimiento_historial'),
 'permiso', (select json_agg(role_id order by role_id) from public.role_permissions where permiso='reservas.prorrogar'),
 'catalogo_permiso', (select count(*) from public.permissions where clave='reservas.prorrogar'),
 'historial_filas', (select count(*) from public.reservas_cumplimiento_historial),
 'reservas', (select json_agg(json_build_object('estado', estado, 'cumpl', cumplimiento_estado, 'n', n)) from (select estado, cumplimiento_estado, count(*) n from public.reservations group by 1,2) s),
 'cron', (select to_regnamespace('cron') is not null),
 'grant_resolver', (select has_function_privilege('authenticated', 'public.reservas_cumplimiento_resolver(uuid, text, text)', 'execute'))
) as r
;

-- 2. Planos (0022 y 0025), tarea programada y cuentas receptoras (0024).
select json_build_object(
 'cron_job', (select json_agg(json_build_object('nombre', jobname, 'horario', schedule, 'comando', command)) from cron.job where jobname = 'reservas-liberar-apartados'),
 'tabla_cuentas_en_esquemas', (select json_agg(n.nspname || '.' || c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname = 'cuentas_receptoras'),
 'funciones_cuentas', (select json_agg(n.nspname || '.' || p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname in ('config_cuenta_registrar', 'config_cuenta_desactivar')),
 'planos_publicar', (select json_agg(json_build_object('firma', pg_get_function_identity_arguments(p.oid), 'dependientes', (select count(*) from pg_depend d where d.refobjid = p.oid and d.deptype = 'n'), 'usada_por_funciones', (select json_agg(q.proname) from pg_proc q where q.oid <> p.oid and q.prosrc ilike '%planos_publicar%'))) from pg_proc p where p.proname = 'planos_publicar'),
 'planos_0022', json_build_object('registrar', (select json_agg(pg_get_function_identity_arguments(oid)) from pg_proc where proname = 'planos_registrar'), 'eliminar', (select count(*) from pg_proc where proname = 'planos_eliminar'), 'rechazar', (select count(*) from pg_proc where proname = 'planos_rechazar'), 'estado_check', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'planos_estado_check'), 'col_eliminado', (select count(*) from information_schema.columns where table_name = 'planos' and column_name = 'eliminado_en'), 'filas', (select json_agg(json_build_object('estado', estado, 'n', n)) from (select estado, count(*) n from public.planos group by 1) s))
) as r
;

-- 3. Cuentas receptoras (0024) en detalle y columnas restantes de la versión VELKROVA de Comisiones (quién las usa y si tienen datos).
select json_build_object(
 'cuentas_funciones', (select json_object_agg(p.proname, md5(replace(p.prosrc, chr(13), ''))) from pg_proc p where p.proname in ('config_cuenta_registrar', 'config_cuenta_desactivar')),
 'cuentas_columnas', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'cuentas_receptoras'),
 'cuentas_filas', (select count(*) from public.cuentas_receptoras),
 'cuentas_politica', (select json_agg(policyname) from pg_policies where tablename = 'cuentas_receptoras'),
 'comisiones_columnas', (select json_agg(json_build_object('col', table_name || '.' || column_name, 'tipo', data_type, 'defecto', column_default)) from information_schema.columns where table_schema = 'public' and ((table_name = 'comision_movimientos' and column_name = 'iva') or (table_name = 'comision_parametros' and column_name in ('beneficiario', 'dias_habiles_pago', 'iva_pct')) or (table_name = 'comision_tramos' and column_name like 'factura%'))),
 'funciones_que_las_usan', (select json_agg(distinct p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.prosrc ilike '%factura_numero%' or p.prosrc ilike '%factura_total%' or p.prosrc ilike '%iva_pct%' or p.prosrc ilike '%dias_habiles_pago%' or p.prosrc ~* 'comision_movimientos[^;]*\miva\M')),
 'vistas_que_las_usan', (select json_agg(distinct v.table_name) from information_schema.view_column_usage v where v.table_schema = 'public' and ((v.table_name is not null and v.column_name in ('iva', 'iva_pct', 'dias_habiles_pago', 'beneficiario') and v.table_name <> 'comision_parametros') or v.column_name like 'factura%')),
 'datos_parametros', (select json_build_object('beneficiario', beneficiario, 'dias_habiles_pago', dias_habiles_pago, 'iva_pct', iva_pct) from public.comision_parametros where id = 1),
 'tramos_con_factura', (select count(*) from public.comision_tramos where factura_numero is not null),
 'movimientos_con_iva', (select count(*) from public.comision_movimientos where iva is not null)
) as r
;
