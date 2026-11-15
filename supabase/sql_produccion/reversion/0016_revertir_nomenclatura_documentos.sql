-- Recuperación manual ANTES de emitir documentos nuevos. No elimina columnas ni instantáneas.
-- Si ya se emitieron documentos, aborta: se requiere una corrección compatible hacia adelante.
-- Ejecutar con operaciones detenidas y respaldo verificado. Luego, si corresponde, revertir 0015.
begin;
lock table public.quotes, public.recibos_pago, public.comprobantes_pago,
 public.mortgage_simulations, public.contract_document_versions in share row exclusive mode;
select public.nomenclatura_permitir_reversion();
do $$ declare f record; a record; v_actual jsonb; v_esperado jsonb;
begin
 if not exists(select 1 from public.nomenclatura_respaldo where version='0016') then
   raise exception 'Falta el respaldo interno de 0016: no se modificó nada';
 end if;
 for a in select value from jsonb_array_elements((select plan from public.nomenclatura_respaldo where version='0016')) loop
   select jsonb_build_object('nombre',nombre,'descripcion',descripcion) into v_actual from public.plan_activities where id=(a.value->>'id')::uuid;
   v_esperado:=jsonb_build_object('nombre',replace(replace(a.value->>'nombre','edificio 1','edificio A'),'edificio 2','edificio B'),
     'descripcion',replace(replace(a.value->>'descripcion','edificio 1','edificio A'),'edificio 2','edificio B'));
   if v_actual is distinct from v_esperado and v_actual is distinct from jsonb_build_object('nombre',a.value->>'nombre','descripcion',a.value->>'descripcion') then
     raise exception 'La actividad % cambió desde 0016; revisar su reversión manualmente',a.value->>'codigo';
   end if;
   update public.plan_activities set nombre=a.value->>'nombre',descripcion=a.value->>'descripcion' where id=(a.value->>'id')::uuid;
 end loop;
 for f in select value from jsonb_each_text((select funciones from public.nomenclatura_respaldo where version='0016')) loop
   execute f.value;
 end loop;
end $$;
-- Se conservan la protección de documentos, las instantáneas y las equivalencias para no perder trazabilidad.
commit;
