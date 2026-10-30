-- AMURA · Verificación final (solo lectura). Ejecutar después de instalar usuarios y permisos.
-- No continuar con 20261029000000_flujo_comercial.sql mientras alguna fila tenga ok = false.

with requisitos(grupo, objeto) as (values
  ('tabla', 'public.inventory_units'), ('tabla', 'public.inventory_status_history'), ('tabla', 'public.user_roles'),
  ('tabla', 'public.clients'), ('tabla', 'public.quotes'), ('tabla', 'public.reservations'),
  ('tabla', 'public.permissions'), ('tabla', 'public.roles'), ('tabla', 'public.role_permissions'),
  ('tabla', 'public.teams'), ('tabla', 'public.team_managers'), ('tabla', 'public.profiles'),
  ('tabla', 'public.user_permission_overrides'), ('tabla', 'public.projects'), ('tabla', 'public.user_projects'),
  ('tabla', 'public.audit_log'),
  ('funcion', 'public.current_app_role()'), ('funcion', 'public.tiene_permiso(text)'), ('funcion', 'public.usuarios_en_alcance()'),
  ('funcion', 'public.en_alcance(uuid)'), ('funcion', 'public.puede_conceder_rol(text)'),
  ('funcion', 'public.config_actualizar_usuario(uuid, text, text, uuid, uuid, text[], text, text)'),
  ('funcion', 'public.config_fijar_excepcion(uuid, text, text, text)'),
  ('columna', 'clients.id'), ('columna', 'clients.etapa'), ('columna', 'clients.asesor_id'), ('columna', 'clients.created_by'),
  ('columna', 'clients.atribucion_usuario_id'),
  ('columna', 'quotes.id'), ('columna', 'quotes.numero'), ('columna', 'quotes.codigo'), ('columna', 'quotes.client_id'),
  ('columna', 'quotes.created_by'), ('columna', 'quotes.valida_hasta'), ('columna', 'quotes.precio_final'),
  ('columna', 'quotes.descuento_pct'), ('columna', 'quotes.plan'),
  ('columna', 'reservations.codigo'), ('columna', 'reservations.estado'), ('columna', 'reservations.client_id'),
  ('columna', 'reservations.codigo_unidad'), ('columna', 'reservations.quote_id'), ('columna', 'reservations.vigencia_hasta'),
  ('columna', 'reservations.precio_acordado'), ('columna', 'reservations.descuento_pct'), ('columna', 'reservations.reserva_pct'),
  ('columna', 'reservations.monto_reserva'), ('columna', 'reservations.meses'), ('columna', 'reservations.cuota_mensual'),
  ('columna', 'reservations.comprobante'), ('columna', 'reservations.monto_recibido'), ('columna', 'reservations.fecha_confirmacion'),
  ('columna', 'reservations.motivo_anulacion'), ('columna', 'reservations.created_by'),
  ('columna', 'inventory_units.codigo'), ('columna', 'inventory_units.estado'), ('columna', 'inventory_units.reserva_id'),
  ('columna', 'inventory_units.updated_at'), ('columna', 'inventory_units.updated_by'),
  ('columna', 'inventory_status_history.reserva_id')
)
select grupo, objeto,
  case grupo
    when 'tabla' then to_regclass(objeto) is not null
    when 'funcion' then to_regprocedure(objeto) is not null
    when 'columna' then exists (select 1 from information_schema.columns c
                                where c.table_schema = 'public' and c.table_name = split_part(objeto, '.', 1) and c.column_name = split_part(objeto, '.', 2))
  end as ok,
  null::text as detalle
from requisitos

union all
select 'rls', t, coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || t)), false), 'RLS activa'
from unnest(array['profiles', 'roles', 'permissions', 'role_permissions', 'user_permission_overrides', 'teams', 'team_managers',
                  'projects', 'user_projects', 'audit_log', 'clients', 'quotes', 'reservations', 'inventory_units']) t

union all
select 'rls', 'sin escritura directa en tablas de acceso',
  not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.cmd <> 'SELECT'
              and p.tablename in ('profiles', 'roles', 'permissions', 'role_permissions', 'user_permission_overrides',
                                  'teams', 'team_managers', 'projects', 'user_projects', 'audit_log')),
  'los cambios de acceso solo pasan por funciones con permiso y auditoría'

union all
select 'datos', 'catálogo de permisos (incluye config.cobros)',
  to_regclass('public.permissions') is not null and exists (select 1 from public.permissions where clave = 'config.cobros'),
  (select count(*)::text || ' permisos' from public.permissions)
union all
select 'datos', 'perfiles base (5)', (select count(*) from public.roles where sistema) >= 5,
  (select string_agg(id, ', ' order by id) from public.roles where sistema)
union all
select 'datos', 'cuentas de user_roles con perfil',
  not exists (select 1 from public.user_roles ur where not exists (select 1 from public.profiles p where p.id = ur.user_id)),
  (select count(*)::text || ' sin perfil' from public.user_roles ur where not exists (select 1 from public.profiles p where p.id = ur.user_id))
union all
select 'datos', 'al menos un administrador activo',
  exists (select 1 from public.profiles p join public.role_permissions rp on rp.role_id = p.rol_id and rp.permiso = 'config.usuarios'
          where p.estado = 'activo'),
  'si es false, ejecutar supabase/instalacion/primer_administrador.sql'
order by ok, grupo, objeto;
