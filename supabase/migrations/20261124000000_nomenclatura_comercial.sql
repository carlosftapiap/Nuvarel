-- AMURA · Nomenclatura comercial: Edificio A y B, departamentos A001–A505 y B001–B507.
-- Cambia solo el número visible de cada departamento (inventory_units.dpt): 1001 → A001, 1105 → A105, 2001 → B001, 2507 → B507.
-- El código interno (codigo, p. ej. E1-PB-A1) NO cambia: es la clave de reservas, cotizaciones, contratos, simulaciones,
-- historiales e importaciones. El edificio sigue guardado como 1 y 2; la app y los documentos nuevos lo muestran como A y B.
-- No modifica precios, metrajes, estados, relaciones ni documentos ya emitidos (los recibos guardan el número de su fecha).
-- Se puede repetir: solo convierte lo que sigue con la nomenclatura anterior.
-- Revertir: supabase/sql_produccion/reversion/0015_revertir_nomenclatura_comercial.sql
-- Verificar (antes y después): supabase/sql_produccion/verificacion/verificar_nomenclatura_comercial.sql

-- Completar con 0016 antes de habilitar operaciones o publicar: protege las descargas históricas.
begin;
lock table public.inventory_units in share row exclusive mode;
create temporary table nomenclatura_0015_antes on commit drop as
  select codigo,to_jsonb(u)-'dpt' as datos from public.inventory_units u;

-- Recuperación exacta de textos; no se revierte mediante sustituciones globales.
create table if not exists public.nomenclatura_textos_respaldo (
  tabla text not null, clave text not null, antes jsonb not null, despues jsonb not null,
  primary key(tabla,clave)
);
alter table public.nomenclatura_textos_respaldo enable row level security;
revoke all on public.nomenclatura_textos_respaldo from public,anon,authenticated;
insert into public.nomenclatura_textos_respaldo
select 'obra_frentes',id::text,
 jsonb_build_object('nombre',nombre,'descripcion',descripcion,'contexto',contexto),
 jsonb_build_object('nombre',replace(replace(nombre,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'),
 'descripcion',replace(replace(descripcion,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'),
 'contexto',replace(replace(contexto,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'))
from public.obra_frentes where nombre ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]' or contexto ~ 'Edificio [12]'
on conflict do nothing;
insert into public.nomenclatura_textos_respaldo
select 'medios_proyecto',id::text,jsonb_build_object('titulo',titulo,'descripcion',descripcion),
 jsonb_build_object('titulo',replace(replace(titulo,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'),
 'descripcion',replace(replace(descripcion,'Edificio 1','Edificio A'),'Edificio 2','Edificio B'))
from public.medios_proyecto where titulo ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]'
on conflict do nothing;
insert into public.nomenclatura_textos_respaldo
select 'contract_fields',clave,jsonb_build_object('tipo',tipo,'descripcion',descripcion),jsonb_build_object('tipo','texto','descripcion','Edificio A o B')
from public.contract_fields where clave='unidad.edificio' on conflict do nothing;

-- 1. Verificación previa, conversión y constancia en la auditoría. Si algo no cuadra, se detiene sin cambiar nada.
do $$
declare v_total int; v_fuera int; v_cambiadas int;
begin
  select count(*) into v_total from public.inventory_units;
  if v_total <> 72 then raise exception 'Se esperaban 72 unidades y hay %: revisar antes de continuar', v_total; end if;
  if (select count(*) from public.inventory_units where edificio=1)<>30
     or (select count(*) from public.inventory_units where edificio=2)<>42
     or (select count(distinct (edificio,piso,posicion)) from public.inventory_units)<>72
     or exists(select 1 from public.inventory_units where posicion>case edificio when 1 then 5 else 7 end
       or codigo<>'E'||edificio::text||'-'||case piso when 'PB' then 'PB' else 'P'||piso end||'-A'||posicion::text) then
    raise exception 'Los edificios, posiciones o claves técnicas no coinciden con el mapeo aprobado';
  end if;
  select count(*) into v_fuera from public.inventory_units
  where dpt <> edificio::text || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0')
    and dpt <> case edificio when 1 then 'A' else 'B' end || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0');
  if v_fuera > 0 then raise exception '% unidades tienen un número que no corresponde a su edificio, piso y posición: revisar antes de continuar', v_fuera; end if;

  update public.inventory_units set dpt = case edificio when 1 then 'A' else 'B' end || substr(dpt, 2)
  where dpt ~ '^[12][0-5]0[1-7]$';
  get diagnostics v_cambiadas = row_count;

  if v_cambiadas > 0 then
    insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), 'nomenclatura_comercial', 'inventory_units', 'todas',
      'Nueva nomenclatura comercial: Edificio A y B, departamentos A001-A505 y B001-B507. El código interno no cambia.',
      jsonb_build_object('formato', '1001-1505 y 2001-2507', 'edificios', '1 y 2'),
      jsonb_build_object('formato', 'A001-A505 y B001-B507', 'edificios', 'A y B', 'unidades', v_cambiadas));
  end if;
end $$;

-- 2. Integridad: el número comercial siempre corresponde a su edificio, piso y posición.
alter table public.inventory_units drop constraint if exists inventory_units_dpt_comercial;
alter table public.inventory_units add constraint inventory_units_dpt_comercial
  check (dpt = case edificio when 1 then 'A' else 'B' end || case piso when 'PB' then '0' else piso end || lpad(posicion::text, 2, '0'));

-- 3. Funciones: solo se reemplaza el fragmento indicado de la versión vigente (que ya incluye los cambios de migraciones anteriores).
create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_reemplazo in v_def) > 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  if v_new = v_def then raise exception 'No se encontró el fragmento esperado en %', p_firma; end if;
  execute v_new;
end $$;

-- Contratos nuevos: el edificio se imprime como A o B.
select pg_temp.parchar('public.contratos_datos_documento(uuid, jsonb)',
  $x$'edificio', u.edificio,$x$,
  $x$'edificio', case u.edificio when 1 then 'A' when 2 then 'B' else u.edificio::text end,$x$)
where to_regprocedure('public.contratos_datos_documento(uuid, jsonb)') is not null;

-- Mensajes de los parámetros de precios.
select pg_temp.parchar('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)',
  $x$'Los meses del Edificio 1 deben estar entre 1 y 120'$x$, $x$'Los meses del Edificio A deben estar entre 1 y 120'$x$)
where to_regprocedure('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)') is not null;
select pg_temp.parchar('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)',
  $x$'Los meses del Edificio 2 deben estar entre 1 y 120'$x$, $x$'Los meses del Edificio B deben estar entre 1 y 120'$x$)
where to_regprocedure('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)') is not null;

-- 4. La variable {{unidad.edificio}} de las plantillas ahora es una letra.
do $$ begin
  if to_regclass('public.contract_fields') is not null then
    update public.contract_fields set tipo = 'texto', descripcion = 'Edificio A o B' where clave = 'unidad.edificio';
  end if;
end $$;

-- 5. Textos guardados que nombran los edificios: frentes de obra y material del proyecto. Solo cambia «Edificio 1/2».
do $$
begin
  if to_regclass('public.obra_frentes') is not null then
    update public.obra_frentes set
      nombre = replace(replace(nombre, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B'),
      descripcion = replace(replace(descripcion, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B'),
      contexto = replace(replace(contexto, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B')
    where nombre ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]' or contexto ~ 'Edificio [12]';
  end if;
  if to_regclass('public.medios_proyecto') is not null then
    update public.medios_proyecto set
      titulo = replace(replace(titulo, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B'),
      descripcion = replace(replace(descripcion, 'Edificio 1', 'Edificio A'), 'Edificio 2', 'Edificio B')
    where titulo ~ 'Edificio [12]' or descripcion ~ 'Edificio [12]';
  end if;
end $$;

do $$ begin
 if (select jsonb_agg(datos order by codigo) from nomenclatura_0015_antes) is distinct from
    (select jsonb_agg(to_jsonb(u)-'dpt' order by codigo) from public.inventory_units u) then
  raise exception 'Cambió un dato protegido de Inventario; se cancela 0015';
 end if;
end $$;
commit;
