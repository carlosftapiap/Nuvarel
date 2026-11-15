-- AMURA · Reversión de 0015 (nomenclatura comercial). Vuelve a 1001–1505 / 2001–2507 y a «Edificio 1 / 2».
-- Ejecutar SOLO si se decide volver atrás, junto con la versión anterior de la app. No toca el código interno ni otros datos.
-- Probada en supabase/tests/nomenclatura-comercial.test.ts: deja la base como antes de 0015 y 0015 se puede volver a aplicar.

begin;
lock table public.quotes, public.recibos_pago, public.comprobantes_pago,
 public.mortgage_simulations, public.contract_document_versions in share row exclusive mode;
do $$ begin
 if to_regprocedure('public.nomenclatura_permitir_reversion()') is not null then
   perform public.nomenclatura_permitir_reversion();
 end if;
 if to_regclass('public.nomenclatura_textos_respaldo') is null then
   raise exception 'Falta el respaldo exacto de textos de 0015: revisar manualmente, sin sustituciones globales';
 end if;
end $$;
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

do $$ declare r record; v_actual jsonb;
begin
 for r in select * from public.nomenclatura_textos_respaldo loop
  if r.tabla='obra_frentes' then
   select jsonb_build_object('nombre',nombre,'descripcion',descripcion,'contexto',contexto) into v_actual from public.obra_frentes where id=r.clave::uuid;
  elsif r.tabla='medios_proyecto' then
   select jsonb_build_object('titulo',titulo,'descripcion',descripcion) into v_actual from public.medios_proyecto where id=r.clave::uuid;
  elsif r.tabla='contract_fields' then
   select jsonb_build_object('tipo',tipo,'descripcion',descripcion) into v_actual from public.contract_fields where clave=r.clave;
  else raise exception 'Objeto de reversión no reconocido: %',r.tabla;
  end if;
  if v_actual is distinct from r.antes and v_actual is distinct from r.despues then
   raise exception '% % cambió desde 0015; no se sobrescribe',r.tabla,r.clave;
  end if;
  if r.tabla='obra_frentes' then
   update public.obra_frentes set nombre=r.antes->>'nombre',descripcion=r.antes->>'descripcion',contexto=r.antes->>'contexto' where id=r.clave::uuid;
  elsif r.tabla='medios_proyecto' then
   update public.medios_proyecto set titulo=r.antes->>'titulo',descripcion=r.antes->>'descripcion' where id=r.clave::uuid;
  else
   update public.contract_fields set tipo=r.antes->>'tipo',descripcion=r.antes->>'descripcion' where clave=r.clave;
  end if;
 end loop;
end $$;
commit;
