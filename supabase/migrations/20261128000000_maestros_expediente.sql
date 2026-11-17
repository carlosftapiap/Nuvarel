-- Maestros del expediente de venta de AMURA: formularios oficiales (persona natural, jurídica y especificaciones).
-- Bucket privado. Lectura: quien tiene ventas.documentos_ver. Cargar y quitar: quien tiene recursos.publicar.
-- Sin enlaces públicos. No modifica datos existentes.

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('maestros-amura', 'maestros-amura', false, 10485760, array['application/pdf'])
      on conflict (id) do update set public = false, file_size_limit = 10485760, allowed_mime_types = array['application/pdf'];

    drop policy if exists "maestros amura consultar" on storage.objects;
    create policy "maestros amura consultar" on storage.objects for select to authenticated
      using (bucket_id = 'maestros-amura' and public.tiene_permiso('ventas.documentos_ver'));

    drop policy if exists "maestros amura cargar" on storage.objects;
    create policy "maestros amura cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'maestros-amura' and public.tiene_permiso('recursos.publicar'));

    drop policy if exists "maestros amura limpiar" on storage.objects;
    create policy "maestros amura limpiar" on storage.objects for delete to authenticated
      using (bucket_id = 'maestros-amura' and public.tiene_permiso('recursos.publicar'));
  end if;
end $$;
