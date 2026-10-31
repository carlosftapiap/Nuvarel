-- AMURA · Nombres y apellidos del cliente por separado. `nombre` sigue siendo el nombre completo que usan todos los módulos, y lo genera el servidor.
-- Aditiva: los clientes existentes conservan su nombre y quedan con los campos nuevos vacíos; no se divide ningún nombre antiguo.
-- No cambia contratos ni documentos ya emitidos: cada documento guarda sus propios datos.
-- Revertir: restaurar clientes_datos, clientes_crear, clientes_editar y contratos_datos_documento desde sus migraciones;
--           drop function public.clientes_con_nombre(jsonb, boolean);
--           delete from public.contract_fields where clave in ('comprador.primer_nombre', 'comprador.segundo_nombre', 'comprador.primer_apellido', 'comprador.segundo_apellido');
--           alter table public.clients drop column primer_nombre, drop column segundo_nombre, drop column primer_apellido, drop column segundo_apellido;
-- Ejecutar después de 20261031150000_reserva_atomica_disponibilidad.sql y con un respaldo verificado.

alter table public.clients add column if not exists primer_nombre text;
alter table public.clients add column if not exists segundo_nombre text;
alter table public.clients add column if not exists primer_apellido text;
alter table public.clients add column if not exists segundo_apellido text;
alter table public.clients drop constraint if exists clients_nombres_completos;
alter table public.clients add constraint clients_nombres_completos check ((primer_nombre is null) = (primer_apellido is null));

-- Valida los cuatro campos y genera el nombre completo, respetando los opcionales.
-- Si la ficha no los trae (importación o datos anteriores), se devuelve sin cambios.
create or replace function public.clientes_con_nombre(p jsonb, p_obligatorio boolean) returns jsonb
language plpgsql immutable set search_path = public as $$
declare
  v_1n text := regexp_replace(trim(coalesce(p ->> 'primer_nombre', '')), '\s+', ' ', 'g');
  v_2n text := regexp_replace(trim(coalesce(p ->> 'segundo_nombre', '')), '\s+', ' ', 'g');
  v_1a text := regexp_replace(trim(coalesce(p ->> 'primer_apellido', '')), '\s+', ' ', 'g');
  v_2a text := regexp_replace(trim(coalesce(p ->> 'segundo_apellido', '')), '\s+', ' ', 'g');
begin
  if not p ? 'primer_nombre' then return p; end if;
  if v_1n = '' and v_2n = '' and v_1a = '' and v_2a = '' and not p_obligatorio then return p; end if;
  if v_1n = '' then raise exception 'Ingresa el primer nombre del cliente'; end if;
  if v_1a = '' then raise exception 'Ingresa el primer apellido del cliente'; end if;
  return p || jsonb_build_object('primer_nombre', v_1n, 'segundo_nombre', v_2n, 'primer_apellido', v_1a, 'segundo_apellido', v_2a,
    'nombre', concat_ws(' ', v_1n, nullif(v_2n, ''), v_1a, nullif(v_2a, '')));
end $$;

create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

select pg_temp.parchar('public.clientes_datos(jsonb)',
  $x$'forma_pago', nullif(p ->> 'forma_pago', ''));$x$,
  $x$'forma_pago', nullif(p ->> 'forma_pago', ''),
    'primer_nombre', nullif(trim(coalesce(p ->> 'primer_nombre', '')), ''), 'segundo_nombre', nullif(trim(coalesce(p ->> 'segundo_nombre', '')), ''),
    'primer_apellido', nullif(trim(coalesce(p ->> 'primer_apellido', '')), ''), 'segundo_apellido', nullif(trim(coalesce(p ->> 'segundo_apellido', '')), ''));$x$);

select pg_temp.parchar('public.clientes_crear(uuid, jsonb, uuid)',
  'd := public.clientes_datos(p_datos);', 'd := public.clientes_datos(public.clientes_con_nombre(p_datos, true));');
select pg_temp.parchar('public.clientes_crear(uuid, jsonb, uuid)',
  'insert into clients (id, nombre,', 'insert into clients (id, primer_nombre, segundo_nombre, primer_apellido, segundo_apellido, nombre,');
select pg_temp.parchar('public.clientes_crear(uuid, jsonb, uuid)',
  $x$values (v_id, d ->> 'nombre',$x$, $x$values (v_id, d ->> 'primer_nombre', d ->> 'segundo_nombre', d ->> 'primer_apellido', d ->> 'segundo_apellido', d ->> 'nombre',$x$);

-- Un cliente con los campos completos no los pierde; uno antiguo puede editarse sin completarlos.
select pg_temp.parchar('public.clientes_editar(uuid, integer, jsonb)',
  'd := public.clientes_datos(p_datos);', 'd := public.clientes_datos(public.clientes_con_nombre(p_datos, c.primer_nombre is not null));');
select pg_temp.parchar('public.clientes_editar(uuid, integer, jsonb)',
  $x$update clients set nombre = d ->> 'nombre',$x$,
  $x$update clients set primer_nombre = case when p_datos ? 'primer_nombre' then d ->> 'primer_nombre' else c.primer_nombre end,
    segundo_nombre = case when p_datos ? 'primer_nombre' then d ->> 'segundo_nombre' else c.segundo_nombre end,
    primer_apellido = case when p_datos ? 'primer_nombre' then d ->> 'primer_apellido' else c.primer_apellido end,
    segundo_apellido = case when p_datos ? 'primer_nombre' then d ->> 'segundo_apellido' else c.segundo_apellido end,
    nombre = case when c.primer_nombre is not null and not p_datos ? 'primer_nombre' then c.nombre else d ->> 'nombre' end,$x$);

-- Disponibles para las plantillas de documentos. Solo los documentos nuevos los incluyen.
select pg_temp.parchar('public.contratos_datos_documento(uuid, jsonb)',
  $x$v_principal := jsonb_build_object('nombre', cl.nombre,$x$,
  $x$v_principal := jsonb_build_object('primer_nombre', coalesce(cl.primer_nombre, ''), 'segundo_nombre', coalesce(cl.segundo_nombre, ''),
    'primer_apellido', coalesce(cl.primer_apellido, ''), 'segundo_apellido', coalesce(cl.segundo_apellido, ''), 'nombre', cl.nombre,$x$)
where to_regprocedure('public.contratos_datos_documento(uuid, jsonb)') is not null;

do $d$ begin
  if to_regclass('public.contract_fields') is not null then
    insert into public.contract_fields (clave, grupo, etiqueta, tipo, descripcion) values
      ('comprador.primer_nombre', 'Comprador principal', 'Primer nombre', 'texto', 'Vacío en clientes antiguos hasta completar su ficha'),
      ('comprador.segundo_nombre', 'Comprador principal', 'Segundo nombre', 'texto', 'Opcional'),
      ('comprador.primer_apellido', 'Comprador principal', 'Primer apellido', 'texto', 'Vacío en clientes antiguos hasta completar su ficha'),
      ('comprador.segundo_apellido', 'Comprador principal', 'Segundo apellido', 'texto', 'Opcional')
    on conflict (clave) do nothing;
  end if;
end $d$;

revoke all on function public.clientes_con_nombre(jsonb, boolean) from public, anon;
grant execute on function public.clientes_con_nombre(jsonb, boolean) to authenticated;
