-- AMURA · Verificación de Storage de comprobantes. SOLO LECTURA: no modifica nada. Ejecutar completo en SQL Editor.
with b as (select * from storage.buckets where id = 'comprobantes-pagos'),
pol as (select policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as regla from pg_policies where schemaname = 'storage' and tablename = 'objects'),
vinc as (
  select ruta as name from public.comprobantes_pago where ruta is not null
  union select pdf_ruta from public.recibos_pago where pdf_ruta is not null
  union select ruta from public.reserva_movimientos
),
obj as (select o.name, o.created_at, o.owner_id, v.name is not null as vinculado from storage.objects o left join vinc v on v.name = o.name where o.bucket_id = 'comprobantes-pagos')
select 1 as orden, 'bucket' as tipo, 'existe' as objeto, (select count(*)::text from b) as resultado
union all select 1, 'bucket', 'publico (debe ser false)', (select public::text from b)
union all select 1, 'bucket', 'limite en bytes', (select file_size_limit::text from b)
union all select 2, 'politica', policyname, cmd from pol where regla like '%comprobantes-pagos%'
-- Las políticas se suman: una regla general sobre storage.objects podría abrir este bucket aunque las suyas sean correctas.
union all select 3, 'politica sin limitar por bucket (no deberia haber)', policyname, cmd from pol where regla not like '%bucket_id%'
union all select 4, 'archivos', 'confirmados', (select count(*)::text from public.comprobantes_pago where estado = 'confirmado')
union all select 4, 'archivos', 'vinculados en el bucket', (select count(*)::text from obj where vinculado)
union all select 4, 'archivos', 'sin vincular', (select count(*)::text from obj where not vinculado)
union all select 4, 'archivos', 'registros cuyo archivo no existe', (select count(*)::text from vinc where not exists (select 1 from obj where obj.name = vinc.name))
union all select 4, 'recibos', 'con PDF / total', (select count(pdf_ruta)::text || ' / ' || count(*)::text from public.recibos_pago)
union all select 5, 'sin vincular', name, to_char(created_at, 'YYYY-MM-DD HH24:MI') from obj where not vinculado
order by 1, 2, 3;
