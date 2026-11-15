-- AMURA · Reversión de 0015 (nomenclatura comercial). Vuelve a 1001–1505 / 2001–2507 y a «Edificio 1 / 2».
-- Ejecutar SOLO si se decide volver atrás, junto con la versión anterior de la app. No toca el código interno ni otros datos.
-- Probada en supabase/tests/nomenclatura-comercial.test.ts: deja la base como antes de 0015 y 0015 se puede volver a aplicar.

alter table public.inventory_units drop constraint if exists inventory_units_dpt_comercial;

do $$
declare v_cambiadas int;
begin
  update public.inventory_units set dpt = case left(dpt, 1) when 'A' then '1' else '2' end || substr(dpt, 2)
  where dpt ~ '^[AB][0-5]0[1-7]$';
  get diagnostics v_cambiadas = row_count;
  if v_cambiadas > 0 then
    insert into public.audit_log (actor_id, accion, entidad, entidad_id, motivo, antes, despues)
    values (auth.uid(), 'nomenclatura_comercial_revertida', 'inventory_units', 'todas',
      'Reversión de la nomenclatura comercial: vuelven los números 1001-1505 y 2001-2507.',
      jsonb_build_object('formato', 'A001-A505 y B001-B507'), jsonb_build_object('formato', '1001-1505 y 2001-2507', 'unidades', v_cambiadas));
  end if;
end $$;

create or replace function pg_temp.parchar(p_firma text, p_buscar text, p_reemplazo text) returns void
language plpgsql as $$
declare v_def text := pg_get_functiondef(to_regprocedure(p_firma)); v_new text;
begin
  if position(p_buscar in v_def) = 0 then return; end if;
  v_new := replace(v_def, p_buscar, p_reemplazo);
  execute v_new;
end $$;

select pg_temp.parchar('public.contratos_datos_documento(uuid, jsonb)',
  $x$'edificio', case u.edificio when 1 then 'A' when 2 then 'B' else u.edificio::text end,$x$,
  $x$'edificio', u.edificio,$x$)
where to_regprocedure('public.contratos_datos_documento(uuid, jsonb)') is not null;
select pg_temp.parchar('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)',
  $x$'Los meses del Edificio A deben estar entre 1 y 120'$x$, $x$'Los meses del Edificio 1 deben estar entre 1 y 120'$x$)
where to_regprocedure('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)') is not null;
select pg_temp.parchar('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)',
  $x$'Los meses del Edificio B deben estar entre 1 y 120'$x$, $x$'Los meses del Edificio 2 deben estar entre 1 y 120'$x$)
where to_regprocedure('public.inventario_actualizar_parametros(numeric, numeric, numeric, integer, integer, text)') is not null;

do $$
begin
  if to_regclass('public.contract_fields') is not null then
    update public.contract_fields set tipo = 'numero', descripcion = '' where clave = 'unidad.edificio';
  end if;
  if to_regclass('public.obra_frentes') is not null then
    update public.obra_frentes set
      nombre = replace(replace(nombre, 'Edificio A', 'Edificio 1'), 'Edificio B', 'Edificio 2'),
      descripcion = replace(replace(descripcion, 'Edificio A', 'Edificio 1'), 'Edificio B', 'Edificio 2'),
      contexto = replace(replace(contexto, 'Edificio A', 'Edificio 1'), 'Edificio B', 'Edificio 2')
    where nombre ~ 'Edificio [AB]' or descripcion ~ 'Edificio [AB]' or contexto ~ 'Edificio [AB]';
  end if;
  if to_regclass('public.medios_proyecto') is not null then
    update public.medios_proyecto set
      titulo = replace(replace(titulo, 'Edificio A', 'Edificio 1'), 'Edificio B', 'Edificio 2'),
      descripcion = replace(replace(descripcion, 'Edificio A', 'Edificio 1'), 'Edificio B', 'Edificio 2')
    where titulo ~ 'Edificio [AB]' or descripcion ~ 'Edificio [AB]';
  end if;
end $$;
