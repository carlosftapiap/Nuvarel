-- AMURA · Ventas y contratos sobre las tablas existentes (contracts, installments, payments, audit_log).
-- Agrega firma con fecha, documentos, hitos, anulación sin borrado e historial. Los datos de una venta quedan fijos.
-- No calcula ni crea comisiones: los porcentajes, beneficiarios y momentos de pago son una política aún no aprobada.
-- Ejecutar después de 20261031010000_integracion_comercial.sql. No borra datos.

do $$ begin
  if to_regprocedure('public.contrato_datos_venta()') is null or to_regprocedure('public.contratos_firmar(uuid, text, text)') is null then
    raise exception 'Falta la integración comercial: ejecuta antes 20261031010000_integracion_comercial.sql';
  end if;
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

/* --------------------------------------------------------------------- estructura */

alter table public.contracts add column if not exists fecha_firma date;
alter table public.contracts add column if not exists anulado_por uuid references auth.users (id);
alter table public.contracts add column if not exists anulado_en timestamptz;
alter table public.contracts add column if not exists motivo_anulacion text;
-- Columna que la migración 20261031010000 añadió después de la primera versión: en bases ya migradas puede faltar.
alter table public.contracts add column if not exists origen_detalle text;
alter table public.contracts add column if not exists origen text;

-- Una reserva admite un solo contrato vigente; uno anulado se conserva y permite generar otro.
alter table public.contracts drop constraint if exists contracts_reservation_id_key;
create unique index if not exists contracts_uno_vigente_por_reserva on public.contracts (reservation_id) where estado <> 'anulado';

-- Documentos: se retiran con motivo, nunca se borran. Guardan la referencia, no el archivo.
create table if not exists public.contract_documents (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  tipo text not null check (tipo in ('borrador', 'contrato_firmado', 'anexo', 'escritura', 'anulacion', 'otro')),
  referencia text not null check (char_length(trim(referencia)) >= 3),
  descripcion text not null default '',
  registrado_por uuid not null default auth.uid() references auth.users (id),
  registrado_en timestamptz not null default now(),
  retirado_por uuid references auth.users (id),
  retirado_en timestamptz,
  motivo_retiro text
);

-- Hechos de la venta que usará Comisiones. Solo registran lo ocurrido; un hito revertido se conserva marcado.
create table if not exists public.contract_milestones (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id),
  hito text not null check (hito in ('contrato_firmado', 'escritura', 'desembolso', 'entrega')),
  fecha date not null,
  referencia text not null default '',
  motivo text not null,
  registrado_por uuid references auth.users (id),
  registrado_en timestamptz not null default now(),
  revertido_por uuid references auth.users (id),
  revertido_en timestamptz,
  motivo_reversion text
);
create unique index if not exists contract_milestones_uno_vigente on public.contract_milestones (contract_id, hito) where revertido_en is null;

alter table public.contract_documents enable row level security;
alter table public.contract_milestones enable row level security;
-- Se ven si se ve el contrato. Sin políticas de escritura: solo las funciones siguientes.
drop policy if exists "ver documentos de contrato" on public.contract_documents;
create policy "ver documentos de contrato" on public.contract_documents for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id));
drop policy if exists "ver hitos de contrato" on public.contract_milestones;
create policy "ver hitos de contrato" on public.contract_milestones for select to authenticated
  using (exists (select 1 from public.contracts c where c.id = contract_id));

-- Contratos firmados antes de esta migración: se completa su fecha y su hito, sin tocar lo demás.
update public.contracts set fecha_firma = (firmado_en at time zone 'America/Guayaquil')::date where estado = 'firmado' and fecha_firma is null and firmado_en is not null;
insert into public.contract_milestones (contract_id, hito, fecha, motivo, registrado_por)
select c.id, 'contrato_firmado', c.fecha_firma, 'Contrato firmado antes de registrar hitos', c.firmado_por from public.contracts c
where c.estado = 'firmado' and c.fecha_firma is not null
  and not exists (select 1 from public.contract_milestones m where m.contract_id = c.id and m.hito = 'contrato_firmado' and m.revertido_en is null);

/* -------------------------------------------------------------- reglas de la venta */

-- Los datos de una venta no cambian después de generarla, ni siquiera desde una función. Un contrato anulado queda cerrado.
create or replace function public.contrato_proteger() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.codigo, new.reservation_id, new.client_id, new.opportunity_id, new.codigo_unidad, new.precio, new.fecha_contrato, new.created_by,
      new.asesor_id, new.responsable_id, new.atribucion_usuario_id, new.corredor_origen_id, new.origen, new.origen_detalle)
     is distinct from
     (old.codigo, old.reservation_id, old.client_id, old.opportunity_id, old.codigo_unidad, old.precio, old.fecha_contrato, old.created_by,
      old.asesor_id, old.responsable_id, old.atribucion_usuario_id, old.corredor_origen_id, old.origen, old.origen_detalle) then
    raise exception 'Los datos de una venta no se modifican: anula el contrato y genera otro' using errcode = '42501';
  end if;
  if old.estado = 'anulado' then raise exception 'Un contrato anulado no cambia' using errcode = '42501'; end if;
  if old.estado = 'firmado' and new.estado = 'borrador' then raise exception 'Un contrato firmado no vuelve a borrador; anúlalo si corresponde' using errcode = '42501'; end if;
  if old.estado = 'firmado' and new.fecha_firma is distinct from old.fecha_firma then raise exception 'La fecha de firma no se modifica' using errcode = '42501'; end if;
  if new.estado = 'firmado' and new.fecha_firma is null then new.fecha_firma := (now() at time zone 'America/Guayaquil')::date; end if;
  return new;
end $$;
drop trigger if exists contrato_proteger on public.contracts;
create trigger contrato_proteger before update on public.contracts for each row execute function public.contrato_proteger();

-- Toda firma, por cualquier camino autorizado, deja su hito.
create or replace function public.contrato_hito_firma() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'firmado' and old.estado <> 'firmado' then
    insert into contract_milestones (contract_id, hito, fecha, motivo, registrado_por)
    values (new.id, 'contrato_firmado', new.fecha_firma, 'Contrato firmado', auth.uid());
  end if;
  return new;
end $$;
drop trigger if exists contrato_hito_firma on public.contracts;
create trigger contrato_hito_firma after update of estado on public.contracts for each row execute function public.contrato_hito_firma();

-- Firmar exige alcance sobre el cliente, igual que crear el contrato.
select pg_temp.parchar('public.contratos_firmar(uuid, text, text)',
  'if not found or c.estado <> ''borrador'' then raise exception ''El contrato no está en borrador''; end if;',
  'if not found or not public.cliente_en_alcance(c.client_id) then raise exception ''Contrato inexistente o fuera de tu alcance'' using errcode = ''42501''; end if;
  if c.estado <> ''borrador'' then raise exception ''El contrato no está en borrador''; end if;');

/* ------------------------------------------------------------------------- funciones */

create or replace function public.contratos_tomar(p_id uuid, p_permiso text) returns public.contracts
language plpgsql security definer set search_path = public as $$
declare c contracts;
begin
  if not public.tiene_permiso(p_permiso) then raise exception 'Sin permiso para esta operación del contrato' using errcode = '42501'; end if;
  select * into c from contracts where id = p_id for update;
  if not found or not public.cliente_en_alcance(c.client_id) then raise exception 'Contrato inexistente o fuera de tu alcance' using errcode = '42501'; end if;
  return c;
end $$;

-- Firma con su fecha real y registra el documento firmado. La validación de estado la hace contratos_firmar.
create or replace function public.contratos_formalizar(p_id uuid, p_fecha date, p_motivo text, p_evidencia text) returns void
language plpgsql security definer set search_path = public as $$
declare c contracts := public.contratos_tomar(p_id, 'ventas.formalizar'); v_m text := public.clientes_motivo(p_motivo);
begin
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de firma no puede ser futura'; end if;
  if c.estado <> 'borrador' then raise exception 'El contrato no está en borrador'; end if;
  update contracts set fecha_firma = p_fecha where id = p_id;
  perform public.contratos_firmar(p_id, v_m, p_evidencia);
  insert into contract_documents (contract_id, tipo, referencia, descripcion) values (p_id, 'contrato_firmado', trim(p_evidencia), 'Contrato firmado el ' || to_char(p_fecha, 'DD/MM/YYYY'));
end $$;

create or replace function public.contratos_registrar_documento(p_contract uuid, p_tipo text, p_referencia text, p_descripcion text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts := public.contratos_tomar(p_contract, 'ventas.preparar'); v_id uuid;
begin
  if c.estado = 'anulado' and p_tipo <> 'anulacion' then raise exception 'El contrato está anulado'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia o el enlace del documento'; end if;
  insert into contract_documents (contract_id, tipo, referencia, descripcion) values (p_contract, p_tipo, trim(p_referencia), trim(coalesce(p_descripcion, ''))) returning id into v_id;
  perform public.auditar('Registrar documento de contrato', 'contrato', p_contract::text, 'Documento: ' || p_tipo, null, jsonb_build_object('tipo', p_tipo, 'referencia', trim(p_referencia)), trim(p_referencia));
  return v_id;
end $$;

create or replace function public.contratos_retirar_documento(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare d contract_documents; v_m text := public.clientes_motivo(p_motivo);
begin
  select * into d from contract_documents where id = p_id for update;
  if not found then raise exception 'Documento inexistente'; end if;
  perform public.contratos_tomar(d.contract_id, 'ventas.formalizar');
  if d.retirado_en is not null then raise exception 'El documento ya fue retirado'; end if;
  update contract_documents set retirado_por = auth.uid(), retirado_en = now(), motivo_retiro = v_m where id = p_id;
  perform public.auditar('Retirar documento de contrato', 'contrato', d.contract_id::text, v_m, jsonb_build_object('tipo', d.tipo, 'referencia', d.referencia), null);
end $$;

-- Escritura pasa la unidad a vendida y entrega avanza la negociación. Desembolso solo deja constancia.
create or replace function public.contratos_registrar_hito(p_contract uuid, p_hito text, p_fecha date, p_referencia text, p_motivo text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c contracts := public.contratos_tomar(p_contract, 'ventas.formalizar'); v_m text := public.clientes_motivo(p_motivo); v_id uuid; v_unidad estado_comercial;
begin
  if c.estado <> 'firmado' then raise exception 'Los hitos se registran sobre un contrato firmado'; end if;
  if p_hito not in ('escritura', 'desembolso', 'entrega') then raise exception 'Hito no válido'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha del hito no puede ser futura'; end if;
  if exists (select 1 from contract_milestones m where m.contract_id = p_contract and m.hito = p_hito and m.revertido_en is null) then raise exception 'Ese hito ya está registrado'; end if;
  insert into contract_milestones (contract_id, hito, fecha, referencia, motivo, registrado_por) values (p_contract, p_hito, p_fecha, trim(coalesce(p_referencia, '')), v_m, auth.uid()) returning id into v_id;
  perform set_config('app.flujo', 'on', true);
  if p_hito = 'escritura' then
    select estado into v_unidad from inventory_units where codigo = c.codigo_unidad for update;
    if v_unidad <> 'promesa' then raise exception 'La unidad debe estar en promesa para registrar la escritura (está %)', v_unidad; end if;
    update inventory_units set estado = 'vendido', updated_at = now(), updated_by = auth.uid() where codigo = c.codigo_unidad;
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select rol_id from profiles where id = auth.uid()), c.codigo_unidad, 'promesa', 'vendido', 'Escritura del contrato ' || c.codigo, c.reservation_id);
  elsif p_hito = 'entrega' then
    update opportunities set etapa = 'entrega' where id = c.opportunity_id;
  end if;
  perform public.auditar('Registrar hito de contrato', 'contrato', p_contract::text, v_m, null, jsonb_build_object('hito', p_hito, 'fecha', p_fecha, 'referencia', trim(coalesce(p_referencia, ''))));
  return v_id;
end $$;

-- Reverso: el hito se conserva marcado como revertido y se deshace su efecto. La firma solo se revierte anulando el contrato.
create or replace function public.contratos_revertir_hito(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare m contract_milestones; c contracts; v_m text := public.clientes_motivo(p_motivo);
begin
  select * into m from contract_milestones where id = p_id for update;
  if not found then raise exception 'Hito inexistente'; end if;
  c := public.contratos_tomar(m.contract_id, 'ventas.formalizar');
  if m.revertido_en is not null then raise exception 'El hito ya fue revertido'; end if;
  if m.hito = 'contrato_firmado' then raise exception 'La firma no se revierte: anula el contrato'; end if;
  update contract_milestones set revertido_por = auth.uid(), revertido_en = now(), motivo_reversion = v_m where id = p_id;
  perform set_config('app.flujo', 'on', true);
  if m.hito = 'escritura' then
    update inventory_units set estado = 'promesa', updated_at = now(), updated_by = auth.uid() where codigo = c.codigo_unidad and estado = 'vendido';
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select rol_id from profiles where id = auth.uid()), c.codigo_unidad, 'vendido', 'promesa', 'Reverso de escritura del contrato ' || c.codigo, c.reservation_id);
  elsif m.hito = 'entrega' then
    update opportunities set etapa = 'cobranza' where id = c.opportunity_id and etapa = 'entrega';
  end if;
  perform public.auditar('Revertir hito de contrato', 'contrato', m.contract_id::text, v_m, jsonb_build_object('hito', m.hito, 'fecha', m.fecha), null);
end $$;

-- Cancelación sin borrado. El contrato, sus cuotas y pagos quedan como historia y dejan de ser exigibles.
-- La reserva sigue confirmada: se puede generar otro contrato o anularla con su propio flujo. No devuelve dinero.
create or replace function public.contratos_anular(p_id uuid, p_motivo text, p_evidencia text) returns void
language plpgsql security definer set search_path = public as $$
declare c contracts := public.contratos_tomar(p_id, 'ventas.formalizar'); v_m text := public.clientes_motivo(p_motivo); v_cambio boolean;
begin
  if c.estado = 'anulado' then raise exception 'El contrato ya está anulado'; end if;
  if c.estado = 'firmado' and char_length(trim(coalesce(p_evidencia, ''))) < 3 then raise exception 'Indica el documento que respalda la anulación'; end if;
  if exists (select 1 from contract_milestones m where m.contract_id = p_id and m.hito in ('escritura', 'desembolso', 'entrega') and m.revertido_en is null) then
    raise exception 'El contrato tiene escritura, desembolso o entrega registrados: revierte primero esos hitos';
  end if;
  if exists (select 1 from payments p where p.contract_id = p_id and p.estado = 'registrado') then raise exception 'Hay pagos por verificar: Finanzas debe resolverlos antes de anular'; end if;
  update contracts set estado = 'anulado', anulado_por = auth.uid(), anulado_en = now(), motivo_anulacion = v_m where id = p_id;
  update contract_milestones set revertido_por = auth.uid(), revertido_en = now(), motivo_reversion = 'Contrato anulado: ' || v_m where contract_id = p_id and revertido_en is null;
  update cobranza_compromisos set estado = 'cancelado', cerrado_en = now() where contract_id = p_id and estado = 'pendiente';
  update cobranza_alertas set estado = 'cancelada' where contract_id = p_id and estado = 'pendiente';
  if char_length(trim(coalesce(p_evidencia, ''))) >= 3 then
    insert into contract_documents (contract_id, tipo, referencia, descripcion) values (p_id, 'anulacion', trim(p_evidencia), v_m);
  end if;
  perform set_config('app.flujo', 'on', true);
  update inventory_units set estado = 'reservado', updated_at = now(), updated_by = auth.uid() where codigo = c.codigo_unidad and estado = 'promesa';
  get diagnostics v_cambio = row_count;
  if v_cambio then
    insert into inventory_status_history (user_id, rol, codigo, de, a, motivo, reserva_id)
    values (auth.uid(), (select rol_id from profiles where id = auth.uid()), c.codigo_unidad, 'promesa', 'reservado', 'Contrato ' || c.codigo || ' anulado', c.reservation_id);
  end if;
  update opportunities set etapa = 'aprobacion' where id = c.opportunity_id;
  perform public.auditar('Anular contrato', 'contrato', p_id::text, v_m, jsonb_build_object('estado', c.estado), jsonb_build_object('estado', 'anulado'), nullif(trim(coalesce(p_evidencia, '')), ''));
end $$;

/* --------------------------------------------------------------------------- lectura */

-- Historial del contrato con el de su reserva y cotización de origen. Solo para quien puede ver ese contrato.
create or replace function public.contratos_historial(p_id uuid)
returns table (fecha timestamptz, accion text, motivo text, usuario text, antes jsonb, despues jsonb, evidencia text)
language sql stable security definer set search_path = public as $$
  with c as (
    select k.id, k.reservation_id, r.quote_id from contracts k join reservations r on r.id = k.reservation_id
    where k.id = p_id and (public.tiene_permiso('ventas.ver') or public.tiene_permiso('cobranzas.ver')) and public.cliente_en_alcance(k.client_id)
  )
  select a.fecha, a.accion, a.motivo, coalesce(p.nombre, 'Sistema'), a.antes, a.despues, a.evidencia
  from audit_log a join c on (a.entidad = 'contrato' and a.entidad_id = c.id::text)
                          or (a.entidad = 'reserva' and a.entidad_id = c.reservation_id::text)
                          or (a.entidad = 'cotizacion' and a.entidad_id = c.quote_id::text)
  left join profiles p on p.id = a.actor_id
  order by a.fecha desc
$$;

-- Nombres de quienes intervienen en los contratos visibles: un rol con alcance propio no puede leer otros perfiles.
create or replace function public.contratos_personas() returns table (id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  with vistos as (
    select k.* from contracts k
    where (public.tiene_permiso('ventas.ver') or public.tiene_permiso('cobranzas.ver')) and public.cliente_en_alcance(k.client_id)
  ), ids as (
    select asesor_id as u from vistos union select responsable_id from vistos union select atribucion_usuario_id from vistos
    union select corredor_origen_id from vistos union select firmado_por from vistos union select anulado_por from vistos union select created_by from vistos
    union select d.registrado_por from contract_documents d join vistos v on v.id = d.contract_id
    union select m.registrado_por from contract_milestones m join vistos v on v.id = m.contract_id
  )
  select p.id, p.nombre from profiles p join ids on ids.u = p.id
$$;

-- Lo que el futuro módulo Comisiones leerá de cada venta, sin copiarlo: datos fijos del contrato, hitos vigentes y dinero conciliado.
-- No es una comisión ni una obligación de pago. Con security_invoker aplica los permisos de quien consulta.
create or replace view public.ventas_historicas with (security_invoker = on) as
select c.id as contract_id, c.codigo, c.client_id, c.codigo_unidad, c.precio as precio_final, c.estado as estado_contractual,
  c.origen, c.origen_detalle, c.corredor_origen_id, c.asesor_id, c.responsable_id, c.atribucion_usuario_id,
  c.fecha_contrato, c.fecha_firma as fecha_formalizacion, c.anulado_en,
  coalesce((select jsonb_object_agg(m.hito, m.fecha) from contract_milestones m where m.contract_id = c.id and m.revertido_en is null), '{}'::jsonb) as hitos,
  b.pagado_verificado,
  case when c.precio > 0 then round(b.pagado_verificado * 100 / c.precio, 2) else 0 end as pct_pagado
from contracts c join contract_balances b on b.contract_id = c.id;
grant select on public.ventas_historicas to authenticated;

/* -------------------------------------------------------------------------- permisos */

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.contratos_formalizar(uuid, date, text, text)', 'public.contratos_registrar_documento(uuid, text, text, text)', 'public.contratos_retirar_documento(uuid, text)',
    'public.contratos_registrar_hito(uuid, text, date, text, text)', 'public.contratos_revertir_hito(uuid, text)', 'public.contratos_anular(uuid, text, text)',
    'public.contratos_historial(uuid)', 'public.contratos_personas()'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array['public.contratos_tomar(uuid, text)', 'public.contrato_hito_firma()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
