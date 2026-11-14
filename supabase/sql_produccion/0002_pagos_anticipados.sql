-- AMURA · SQL de producción 0002. Copia exacta de supabase/migrations/20261113000000_pagos_anticipados.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Pagos anticipados (fase 2 del plan de brechas, decisión 2).
--   · Lo verificado cubre primero la reserva (su propio pago) y luego la entrada (firma, cuotas mensuales y extraordinarias) en orden de vencimiento:
--     así lo vencido se cubre antes que lo próximo, aunque una cuota se haya reprogramado.
--   · Lo que supera la entrada queda como saldo a favor. Solo reduce el saldo contra entrega (80 %) con una autorización de Finanzas
--     registrada en aplicaciones_excedente: monto, motivo, documento de soporte, quién y cuándo. Se anula con motivo; nunca se borra.
--   · No modifica cuotas, contratos, pagos ni recibos: cambia cómo se aplican los pagos, no el cronograma.
-- Permiso nuevo: cobranzas.aplicar_excedente (Finanzas y Administrador).
-- Revertir (solo si aplicaciones_excedente está vacía): restaurar installment_status y contract_balances desde 20261029050000_cobranza_cronograma.sql
--   con create or replace (sin las columnas nuevas, recreando ventas_historicas), restaurar comprobante_puede_subir, comprobante_archivo_vinculado y la
--   política "comprobantes pagos consultar" desde 20261031200000_storage_comprobantes.sql, y borrar las funciones cobranzas_*excedente*, la tabla y el permiso.
-- Antes de aplicar: supabase/instalacion/diagnostico_pagos_anticipados.sql (contratos que ya pagaron más que la entrada). Ejecutar con un respaldo verificado.

do $$
begin
  if to_regclass('public.installment_status') is null or to_regclass('public.contract_balances') is null
     or to_regprocedure('public.comprobante_puede_subir(text)') is null or to_regprocedure('public.pagos_archivo_valido(jsonb, text)') is null then
    raise exception 'Faltan dependencias: instala antes Cobranzas, comprobantes y Storage de comprobantes';
  end if;
end $$;

insert into public.permissions (clave, modulo, descripcion)
values ('cobranzas.aplicar_excedente', 'Cobranzas', 'Autorizar la aplicación de excedentes al saldo de financiamiento')
on conflict (clave) do nothing;
insert into public.role_permissions (role_id, permiso)
select r.id, 'cobranzas.aplicar_excedente' from public.roles r where r.id in ('administrador', 'finanzas')
on conflict do nothing;

/* ------------------------------------------------- autorizaciones de excedente */

create table if not exists public.aplicaciones_excedente (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  monto numeric(14,2) not null check (monto > 0),
  motivo text not null check (char_length(btrim(motivo)) >= 10),
  soporte_ruta text not null,
  soporte_nombre text,
  soporte_mime text,
  soporte_tamano bigint,
  soporte_hash text,
  autorizado_por uuid not null references auth.users (id),
  autorizado_en timestamptz not null default now(),
  anulado_por uuid references auth.users (id),
  anulado_en timestamptz,
  motivo_anulacion text
);
create index if not exists aplicaciones_excedente_contrato on public.aplicaciones_excedente (contract_id);
alter table public.aplicaciones_excedente enable row level security;
-- Como los pagos: quien consulta cobranzas del contrato. Escritura solo mediante las funciones.
drop policy if exists "ver aplicaciones de excedente" on public.aplicaciones_excedente;
create policy "ver aplicaciones de excedente" on public.aplicaciones_excedente for select to authenticated
  using (public.tiene_permiso('cobranzas.ver') and exists (select 1 from contracts c where c.id = contract_id));
grant select on public.aplicaciones_excedente to authenticated;

/* ------------------------------------------------------------ vistas de saldos */

-- La entrada son las cuotas con fecha; el saldo contra entrega (80 %) es la cuota sin fecha, que no se puede reprogramar.
create or replace view public.installment_status with (security_invoker = on) as
with pagado as (
  select contract_id, coalesce(sum(monto) filter (where estado = 'verificado'), 0) as verificado from payments group by contract_id
), autorizado as (
  select contract_id, sum(monto) as aplicado from aplicaciones_excedente where anulado_en is null group by contract_id
), base as (
  select i.contract_id, i.numero, i.concepto, i.vencimiento, i.vencimiento_original, i.monto, c.estado as estado_contrato,
    coalesce(pg.verificado, 0) as verificado, coalesce(au.aplicado, 0) as aplicado, (i.vencimiento is null) as financiamiento,
    sum(i.monto) over (partition by i.contract_id, (i.vencimiento is null) order by (i.numero = 0) desc, i.vencimiento, i.numero) as acumulado,
    coalesce(sum(i.monto) filter (where i.vencimiento is not null) over (partition by i.contract_id), 0) as total_entrada
  from installments i join contracts c on c.id = i.contract_id
  left join pagado pg on pg.contract_id = i.contract_id left join autorizado au on au.contract_id = i.contract_id
), asignado as (
  select contract_id, numero, concepto, vencimiento, vencimiento_original, monto, estado_contrato,
    case when not financiamiento then greatest(0, least(monto, verificado - (acumulado - monto)))
         -- Al financiamiento solo llega lo autorizado, y nunca más que el excedente real sobre la entrada.
         else greatest(0, least(monto, least(aplicado, greatest(0, verificado - total_entrada)) - (acumulado - monto))) end as pagado
  from base
)
select contract_id, numero, concepto, vencimiento, vencimiento_original, monto, estado_contrato, pagado,
  round(monto - pagado, 2) as pendiente,
  (estado_contrato = 'firmado') as exigible,
  case when monto - pagado <= 0.005 then 'pagada' when pagado > 0 then 'parcial' else 'pendiente' end as situacion
from asignado;

-- Se conservan las columnas actuales; las nuevas van al final.
create or replace view public.contract_balances with (security_invoker = on) as
select c.id as contract_id, c.codigo, c.client_id, c.codigo_unidad, c.precio, c.estado as estado_contrato,
  coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) as pagado_verificado,
  coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'registrado'), 0) as pendiente_verificacion,
  round(c.precio - coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0), 2) as saldo,
  greatest(0, round(coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) - c.precio, 2)) as saldo_a_favor,
  coalesce((select sum(s.pendiente) from installment_status s where s.contract_id = c.id and s.exigible), 0) as saldo_exigible,
  coalesce((select sum(s.pendiente) from installment_status s where s.contract_id = c.id and s.exigible
            and s.vencimiento < (now() at time zone 'America/Guayaquil')::date), 0) as vencido,
  e.total_entrada, e.pagado_entrada, round(e.total_entrada - e.pagado_entrada, 2) as saldo_entrada,
  greatest(0, round(coalesce((select sum(p.monto) from payments p where p.contract_id = c.id and p.estado = 'verificado'), 0) - e.pagado_entrada - e.aplicado_financiamiento, 2)) as excedente_disponible,
  e.aplicado_financiamiento, e.saldo_financiamiento
from contracts c
cross join lateral (
  select coalesce(sum(s.monto) filter (where s.vencimiento is not null), 0) as total_entrada,
    coalesce(sum(s.pagado) filter (where s.vencimiento is not null), 0) as pagado_entrada,
    coalesce(sum(s.pagado) filter (where s.vencimiento is null), 0) as aplicado_financiamiento,
    coalesce(sum(s.pendiente) filter (where s.vencimiento is null), 0) as saldo_financiamiento
  from installment_status s where s.contract_id = c.id
) e;

grant select on public.installment_status, public.contract_balances to authenticated;

/* ------------------------------------------------------- autorizar y anular */

create or replace function public.cobranzas_autorizar_excedente(p_contract uuid, p_monto numeric, p_motivo text, p_archivo jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts; b contract_balances; v_m text := btrim(coalesce(p_motivo, '')); v_monto numeric := round(coalesce(p_monto, 0), 2); v_id uuid;
begin
  if not public.tiene_permiso('cobranzas.aplicar_excedente') then raise exception 'Sin permiso para autorizar la aplicación de excedentes' using errcode = '42501'; end if;
  select * into c from contracts where id = p_contract for update;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  if c.estado <> 'firmado' then raise exception 'Solo se aplica excedente a un contrato firmado (este está %)', c.estado; end if;
  if char_length(v_m) < 10 then raise exception 'Indica el motivo de la autorización (mínimo 10 caracteres)'; end if;
  if v_monto <= 0 then raise exception 'Monto inválido'; end if;
  if p_archivo is null or jsonb_typeof(p_archivo) = 'null' or coalesce(p_archivo ->> 'ruta', '') = '' then
    raise exception 'Adjunta el documento de soporte de la autorización';
  end if;
  perform public.pagos_archivo_valido(p_archivo, 'excedentes/' || p_contract || '/');
  if not public.comprobante_archivo_cargado(p_archivo ->> 'ruta') then raise exception 'El documento de soporte no se cargó. Vuelve a intentarlo'; end if;
  select * into b from contract_balances where contract_id = p_contract;
  if v_monto > b.excedente_disponible then raise exception 'El monto supera el saldo a favor disponible (USD %)', b.excedente_disponible; end if;
  if v_monto > b.saldo_financiamiento then raise exception 'El monto supera el saldo de financiamiento pendiente (USD %)', b.saldo_financiamiento; end if;
  insert into aplicaciones_excedente (contract_id, monto, motivo, soporte_ruta, soporte_nombre, soporte_mime, soporte_tamano, soporte_hash, autorizado_por)
  values (p_contract, v_monto, v_m, p_archivo ->> 'ruta', p_archivo ->> 'nombre', p_archivo ->> 'mime', (p_archivo ->> 'tamano')::bigint, p_archivo ->> 'hash', auth.uid())
  returning id into v_id;
  perform public.auditar('Autorizar aplicación de excedente', 'contrato', p_contract::text, v_m,
    jsonb_build_object('aplicado_financiamiento', b.aplicado_financiamiento, 'saldo_financiamiento', b.saldo_financiamiento, 'excedente_disponible', b.excedente_disponible),
    jsonb_build_object('monto', v_monto, 'aplicacion', v_id), p_archivo ->> 'ruta');
  return v_id;
end $$;

create or replace function public.cobranzas_anular_aplicacion(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare a aplicaciones_excedente; v_m text := btrim(coalesce(p_motivo, ''));
begin
  if not public.tiene_permiso('cobranzas.aplicar_excedente') then raise exception 'Sin permiso para anular aplicaciones de excedente' using errcode = '42501'; end if;
  select * into a from aplicaciones_excedente where id = p_id for update;
  if not found or not exists (select 1 from contracts c where c.id = a.contract_id and public.cliente_en_alcance(c.client_id)) then
    raise exception 'Aplicación inexistente o fuera de tu alcance' using errcode = '42501';
  end if;
  if a.anulado_en is not null then raise exception 'La aplicación ya está anulada'; end if;
  if char_length(v_m) < 10 then raise exception 'Indica el motivo de la anulación (mínimo 10 caracteres)'; end if;
  update aplicaciones_excedente set anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = v_m where id = p_id;
  perform public.auditar('Anular aplicación de excedente', 'contrato', a.contract_id::text, v_m, jsonb_build_object('monto', a.monto, 'aplicacion', a.id), null);
end $$;

/* ---------------------------------------------------------------- storage */

-- Igual que en 20261031200000_storage_comprobantes.sql, más el soporte de excedentes: excedentes/<contrato>/<archivo>.
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
  elsif p[1] = 'excedentes' then
    return public.tiene_permiso('cobranzas.aplicar_excedente')
      and exists (select 1 from contracts c where c.id = v_id and c.estado = 'firmado' and public.cliente_en_alcance(c.client_id));
  end if;
  return false;
end $$;

create or replace function public.comprobante_archivo_vinculado(p_ruta text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from comprobantes_pago where ruta = p_ruta) or exists (select 1 from recibos_pago where pdf_ruta = p_ruta) or exists (select 1 from reserva_movimientos where ruta = p_ruta)
    or exists (select 1 from aplicaciones_excedente where soporte_ruta = p_ruta)
$$;

do $d$ begin
  if to_regclass('storage.buckets') is not null then
    drop policy if exists "comprobantes pagos consultar" on storage.objects;
    create policy "comprobantes pagos consultar" on storage.objects for select to authenticated
      using (bucket_id = 'comprobantes-pagos' and (exists (select 1 from public.comprobantes_pago e where e.ruta = name) or exists (select 1 from public.recibos_pago v where v.pdf_ruta = name)
                                                   or exists (select 1 from public.reserva_movimientos m where m.ruta = name)
                                                   or exists (select 1 from public.aplicaciones_excedente a where a.soporte_ruta = name)
                                                   or (not public.comprobante_archivo_vinculado(name) and (owner_id = auth.uid()::text or (public.tiene_permiso('config.cobros') and created_at < now() - interval '24 hours')))));
  end if;
end $d$;

/* -------------------------------------------------------------- permisos */

revoke all on function public.cobranzas_autorizar_excedente(uuid, numeric, text, jsonb) from public, anon;
revoke all on function public.cobranzas_anular_aplicacion(uuid, text) from public, anon;
grant execute on function public.cobranzas_autorizar_excedente(uuid, numeric, text, jsonb) to authenticated;
grant execute on function public.cobranzas_anular_aplicacion(uuid, text) to authenticated;
