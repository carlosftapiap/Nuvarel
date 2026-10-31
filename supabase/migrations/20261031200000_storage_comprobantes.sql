-- AMURA · Correcciones de Storage de comprobantes:
--   1. Subir exige acceso a esa operación, no solo el permiso general.
--   2. El PDF de un recibo solo se sube cuando el recibo existe, y se vincula por su ruta exacta, con su huella y por quien lo subió.
--   3. Los archivos sin vincular se pueden identificar y limpiar con auditoría. Lo vinculado nunca se borra.
-- No modifica comprobantes, recibos ni archivos existentes. Se puede repetir.
-- Revertir: restaurar recibos_registrar_pdf y las políticas de Storage desde 20261031190000_cobranzas_controles.sql y borrar las funciones de este archivo.
-- Ejecutar después de 20261031190000_cobranzas_controles.sql y con un respaldo verificado.

/* --------------------------------------------------- 1. subida por operación */

create or replace function public.comprobante_puede_subir(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare p text[] := string_to_array(coalesce(p_ruta, ''), '/'); n int := coalesce(array_length(string_to_array(coalesce(p_ruta, ''), '/'), 1), 0); v_id uuid;
begin
  -- El recibo debe existir y aún no tener PDF: no se puede preparar un archivo por adelantado.
  if p[1] = 'recibos' then
    return n = 2 and (public.tiene_permiso('cobranzas.verificar') or public.tiene_permiso('reservas.verificar_pago'))
      and exists (select 1 from recibos_pago v where v.pdf_ruta is null and p[2] like v.numero || '-%.pdf' and public.pago_visible(v.reservation_id, v.payment_id));
  end if;
  if n <> 3 or p[2] !~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' then return false; end if;
  v_id := p[2]::uuid;
  if p[1] = 'reservas' then
    return (public.tiene_permiso('reservas.solicitar') or public.tiene_permiso('cobranzas.registrar'))
      and exists (select 1 from reservations r where r.id = v_id and r.estado = 'solicitada' and r.comprobante is null and public.cliente_en_alcance(r.client_id));
  elsif p[1] = 'contratos' then
    return public.tiene_permiso('cobranzas.registrar')
      and exists (select 1 from contracts c where c.id = v_id and c.estado <> 'anulado' and public.cliente_en_alcance(c.client_id));
  elsif p[1] = 'movimientos' then
    return public.tiene_permiso('cobranzas.registrar')
      and exists (select 1 from reservations r where r.id = v_id and r.estado = 'anulada' and coalesce(r.pago_monto, 0) > 0 and public.cliente_en_alcance(r.client_id));
  end if;
  return false;
end $$;

/* ------------------------------------------------ 2. vínculo seguro del recibo */

-- Dueño del archivo: quien lo subió. Sin Storage (pruebas locales), no aplica.
create or replace function public.comprobante_archivo_propio(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if to_regclass('storage.objects') is null then return true; end if;
  execute 'select exists (select 1 from storage.objects where bucket_id = $1 and name = $2 and owner_id = $3)' into v using 'comprobantes-pagos', p_ruta, auth.uid()::text;
  return v;
end $$;

create or replace function public.recibos_registrar_pdf(p_id uuid, p_ruta text, p_hash text) returns void
language plpgsql security definer set search_path = public as $$
declare v recibos_pago;
begin
  if not (public.tiene_permiso('cobranzas.verificar') or public.tiene_permiso('reservas.verificar_pago')) then raise exception 'Sin permiso' using errcode = '42501'; end if;
  select * into v from recibos_pago where id = p_id for update;
  if not found or not public.pago_visible(v.reservation_id, v.payment_id) then raise exception 'Recibo inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if v.pdf_ruta = p_ruta then return; end if;
  -- Otra persona ya lo guardó: este archivo sobra y la app lo quita.
  if v.pdf_ruta is not null then raise exception 'El recibo % ya tiene su PDF', v.numero; end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{64}$' then raise exception 'Huella del recibo no válida'; end if;
  if p_ruta is distinct from 'recibos/' || v.numero || '-' || left(p_hash, 12) || '.pdf' then raise exception 'La ruta no corresponde a este recibo'; end if;
  if not public.comprobante_archivo_propio(p_ruta) then raise exception 'El PDF del recibo no se cargó con tu usuario'; end if;
  update recibos_pago set pdf_ruta = p_ruta, pdf_hash = p_hash where id = p_id;
  perform public.auditar('Guardar PDF del recibo', case when v.reservation_id is not null then 'reserva' else 'pago' end, coalesce(v.reservation_id, v.payment_id)::text, 'Recibo ' || v.numero, null, null, p_ruta);
end $$;

/* ------------------------------------------------ 3. archivos sin vincular */

-- Las 24 horas evitan tocar una carga que aún esté en curso.
create or replace function public.comprobantes_sin_vincular() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.tiene_permiso('config.cobros') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if to_regclass('storage.objects') is null then return '[]'::jsonb; end if;
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('ruta', o.name, 'cargado_en', o.created_at) order by o.created_at), '[]'::jsonb) from storage.objects o
    where o.bucket_id = 'comprobantes-pagos' and o.created_at < now() - interval '24 hours' and not public.comprobante_archivo_vinculado(o.name)$q$ into v;
  return v;
end $$;

-- Deja constancia antes de quitarlo. Se niega si el archivo ya está vinculado.
create or replace function public.comprobante_limpieza_registrar(p_ruta text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.tiene_permiso('config.cobros') then raise exception 'Sin permiso' using errcode = '42501'; end if;
  if public.comprobante_archivo_vinculado(p_ruta) then raise exception 'Este archivo está vinculado a una operación y no se puede quitar'; end if;
  perform public.auditar('Quitar archivo sin vincular', 'archivo', p_ruta, 'Archivo sin vincular por más de 24 horas', null, null, p_ruta);
end $$;

/* ---------------------------------------------------------------- storage */

do $d$ begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "comprobantes pagos cargar" on storage.objects;
    create policy "comprobantes pagos cargar" on storage.objects for insert to authenticated
      with check (bucket_id = 'comprobantes-pagos' and public.comprobante_puede_subir(name));
    -- Lo vinculado no se borra: ni quien lo subió ni un administrador. Borrar exige también poder leer.
    drop policy if exists "comprobantes pagos consultar" on storage.objects;
    create policy "comprobantes pagos consultar" on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes-pagos' and (exists (select 1 from public.comprobantes_pago e where e.ruta = name) or exists (select 1 from public.recibos_pago v where v.pdf_ruta = name)
                                                   or exists (select 1 from public.reserva_movimientos m where m.ruta = name)
                                                   or (not public.comprobante_archivo_vinculado(name) and (owner_id = auth.uid()::text or (public.tiene_permiso('config.cobros') and created_at < now() - interval '24 hours')))));
    drop policy if exists "comprobantes pagos limpiar" on storage.objects;
    create policy "comprobantes pagos limpiar" on storage.objects for delete to authenticated
      using (bucket_id = 'comprobantes-pagos' and not public.comprobante_archivo_vinculado(name)
             and (owner_id = auth.uid()::text or (public.tiene_permiso('config.cobros') and created_at < now() - interval '24 hours')));
  end if;
end $d$;

revoke all on function public.comprobante_archivo_propio(text) from public, anon, authenticated;
revoke all on function public.comprobante_puede_subir(text) from public, anon;
revoke all on function public.comprobantes_sin_vincular() from public, anon;
revoke all on function public.comprobante_limpieza_registrar(text) from public, anon;
grant execute on function public.comprobante_puede_subir(text) to authenticated;
grant execute on function public.comprobantes_sin_vincular() to authenticated;
grant execute on function public.comprobante_limpieza_registrar(text) to authenticated;
