-- AMURA · Comisiones: seguimiento por tramos (manual de política, sección 4.4), conectado con Contratos y Cobranzas.
--   · Tramo 1 (50 %): promesa firmada, al menos 10 % del precio pagado y honorario recibido por Jarva.
--   · Tramo 2 (50 %): escritura o desembolso, y honorario recibido por Jarva.
--   · Estados: calculada (contrato sin firmar), pendiente de condiciones, habilitada para liquidación, pagada, anulada.
-- El porcentaje y el precio se fijan al firmar y no cambian después. Un pago solo existe si Finanzas lo confirma: nada se paga solo.
-- Liquidar exige que la política esté aprobada formalmente (empieza sin aprobar). No reparte entre participantes.
-- Nada se borra: ajustes, reversos y recuperaciones quedan como movimientos. Si un contrato se anula con tramos pagados, queda el monto por recuperar.
-- Ejecutar después de 20261031050000_comisiones_base.sql.

do $$ begin
  if to_regclass('public.comision_parametros') is null or to_regclass('public.contract_milestones') is null then
    raise exception 'Falta la comisión base o Ventas: aplica antes 20261031020000_ventas_contratos.sql y 20261031050000_comisiones_base.sql';
  end if;
end $$;

/* --------------------------------------------------------------------- permisos */

insert into public.permissions (clave, modulo, descripcion) values
  ('comisiones.finanzas', 'Comisiones', 'Registrar honorario recibido y confirmar pagos')
on conflict (clave) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;
insert into public.role_permissions (role_id, permiso)
select x.rol, x.permiso from (values
  ('administrador', 'comisiones.finanzas'), ('finanzas', 'comisiones.finanzas'),
  ('administrador', 'comisiones.aprobar'), ('gerencia', 'comisiones.aprobar')
) as x(rol, permiso) where exists (select 1 from public.roles r where r.id = x.rol)
on conflict do nothing;

/* --------------------------------------------------------------------- registro */

alter table public.comision_parametros add column if not exists liquidacion_aprobada boolean not null default false;
alter table public.comision_parametros add column if not exists liquidacion_documento text;
alter table public.comision_parametros add column if not exists liquidacion_motivo text;
alter table public.comision_parametros add column if not exists liquidacion_por uuid references auth.users (id);
alter table public.comision_parametros add column if not exists liquidacion_nombre text;
alter table public.comision_parametros add column if not exists liquidacion_en timestamptz;

-- Una comisión por contrato: evita duplicarla aunque el disparador o la carga inicial se repitan.
create table if not exists public.comisiones (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null unique references public.contracts (id),
  precio_base numeric(14,2) not null,
  porcentaje numeric(5,2) not null,
  monto_total numeric(14,2) not null,
  estado text not null default 'calculada' check (estado in ('calculada', 'vigente', 'anulada')),
  creada_en timestamptz not null default now(),
  fijada_en timestamptz,
  anulada_en timestamptz,
  motivo_anulacion text
);

create table if not exists public.comision_tramos (
  id uuid primary key default gen_random_uuid(),
  comision_id uuid not null references public.comisiones (id),
  numero smallint not null check (numero in (1, 2)),
  porcentaje numeric(5,2) not null default 50,
  monto numeric(14,2) not null,
  estado text not null default 'calculada' check (estado in ('calculada', 'pendiente', 'habilitada', 'pagada', 'anulada')),
  honorario_monto numeric(14,2),
  honorario_fecha date,
  honorario_referencia text,
  honorario_por uuid references auth.users (id),
  honorario_nombre text,
  honorario_en timestamptz,
  habilitada_por uuid references auth.users (id),
  habilitada_nombre text,
  habilitada_en timestamptz,
  habilitada_motivo text,
  unique (comision_id, numero)
);

-- Lo que ocurrió con el dinero. Se agrega y se marca; nunca se borra.
create table if not exists public.comision_movimientos (
  id uuid primary key default gen_random_uuid(),
  comision_id uuid not null references public.comisiones (id),
  tramo_id uuid references public.comision_tramos (id),
  tipo text not null check (tipo in ('pago', 'reverso_pago', 'ajuste', 'por_recuperar')),
  monto numeric(14,2) not null,
  fecha date,
  beneficiario text,
  referencia text,
  motivo text not null,
  registrado_por uuid references auth.users (id),
  registrado_nombre text,
  registrado_en timestamptz not null default now(),
  revertido_por uuid references auth.users (id),
  revertido_nombre text,
  revertido_en timestamptz,
  motivo_reverso text,
  recuperado_por uuid references auth.users (id),
  recuperado_nombre text,
  recuperado_en timestamptz,
  nota_recuperacion text
);
-- Un tramo no puede tener dos pagos vigentes, ni con dos personas a la vez.
create unique index if not exists comision_un_pago_por_tramo on public.comision_movimientos (tramo_id) where tipo = 'pago' and revertido_en is null;

-- Sin políticas: solo se leen y escriben con las funciones siguientes.
alter table public.comisiones enable row level security;
alter table public.comision_tramos enable row level security;
alter table public.comision_movimientos enable row level security;

-- Porcentaje y base históricos: una vez firmada la venta no cambian, ni siquiera desde una función.
create or replace function public.comision_proteger() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.estado <> 'calculada' and (new.precio_base, new.porcentaje, new.monto_total) is distinct from (old.precio_base, old.porcentaje, old.monto_total) then
    raise exception 'El porcentaje y la base de una venta firmada no se modifican: registra un ajuste' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists comision_proteger on public.comisiones;
create trigger comision_proteger before update on public.comisiones for each row execute function public.comision_proteger();

create or replace function public.comision_sin_borrado() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'El historial de comisiones no se borra' using errcode = '42501';
end $$;
drop trigger if exists comision_sin_borrado on public.comisiones;
create trigger comision_sin_borrado before delete on public.comisiones for each row execute function public.comision_sin_borrado();
drop trigger if exists comision_sin_borrado on public.comision_tramos;
create trigger comision_sin_borrado before delete on public.comision_tramos for each row execute function public.comision_sin_borrado();
drop trigger if exists comision_sin_borrado on public.comision_movimientos;
create trigger comision_sin_borrado before delete on public.comision_movimientos for each row execute function public.comision_sin_borrado();

/* ------------------------------------------------------- conexión con Contratos */

-- Crea la comisión de un contrato o, si ya existe y sigue sin firmar, fija su porcentaje al firmar.
create or replace function public.comision_sincronizar(p_contrato uuid, p_precio numeric, p_firmado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_pct numeric := public.comisiones_porcentaje(); v_total numeric := round(p_precio * v_pct / 100, 2); v_uno numeric := round(v_total / 2, 2); v_id uuid; v_estado text;
begin
  select id, estado into v_id, v_estado from comisiones where contract_id = p_contrato for update;
  if v_id is null then
    insert into comisiones (contract_id, precio_base, porcentaje, monto_total, estado, fijada_en)
    values (p_contrato, p_precio, v_pct, v_total, case when p_firmado then 'vigente' else 'calculada' end, case when p_firmado then now() end)
    returning id into v_id;
    insert into comision_tramos (comision_id, numero, monto, estado) values
      (v_id, 1, v_uno, case when p_firmado then 'pendiente' else 'calculada' end),
      (v_id, 2, v_total - v_uno, case when p_firmado then 'pendiente' else 'calculada' end);
  elsif v_estado = 'calculada' and p_firmado then
    update comisiones set precio_base = p_precio, porcentaje = v_pct, monto_total = v_total, estado = 'vigente', fijada_en = now() where id = v_id;
    update comision_tramos set monto = case when numero = 1 then v_uno else v_total - v_uno end, estado = 'pendiente' where comision_id = v_id;
  end if;
end $$;

-- Al anular el contrato: lo no pagado se anula y lo ya pagado queda por recuperar. No se mueve dinero.
create or replace function public.comision_anular(p_contrato uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare m comisiones; t comision_tramos; v_nombre text;
begin
  select * into m from comisiones where contract_id = p_contrato for update;
  if not found or m.estado = 'anulada' then return; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  for t in select * from comision_tramos where comision_id = m.id and estado = 'pagada' loop
    insert into comision_movimientos (comision_id, tramo_id, tipo, monto, motivo, registrado_por, registrado_nombre)
    values (m.id, t.id, 'por_recuperar', -t.monto, 'Contrato anulado: ' || coalesce(p_motivo, ''), auth.uid(), v_nombre);
  end loop;
  update comision_tramos set estado = 'anulada' where comision_id = m.id and estado <> 'pagada';
  update comisiones set estado = 'anulada', anulada_en = now(), motivo_anulacion = p_motivo where id = m.id;
  perform public.auditar('Anular comisión', 'comision', m.id::text, coalesce(p_motivo, 'Contrato anulado'), jsonb_build_object('estado', m.estado), jsonb_build_object('estado', 'anulada'));
end $$;

create or replace function public.contrato_comision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.comision_sincronizar(new.id, new.precio, new.estado = 'firmado');
  elsif new.estado = 'firmado' and old.estado <> 'firmado' then
    perform public.comision_sincronizar(new.id, new.precio, true);
  elsif new.estado = 'anulado' and old.estado <> 'anulado' then
    perform public.comision_anular(new.id, new.motivo_anulacion);
  end if;
  return new;
end $$;
drop trigger if exists contrato_comision on public.contracts;
create trigger contrato_comision after insert or update of estado on public.contracts for each row execute function public.contrato_comision();

-- Contratos que ya existen. Los anulados no generan comisión. Se puede repetir.
do $$
declare k record;
begin
  for k in select id, precio, estado from public.contracts where estado <> 'anulado' loop
    perform public.comision_sincronizar(k.id, k.precio, k.estado = 'firmado');
  end loop;
end $$;

/* --------------------------------------------------------------------- condiciones */

-- Se calculan siempre con los datos vivos: si Cobranzas anula un pago o Legal revierte un hito, la condición deja de cumplirse.
create or replace function public.comision_condiciones(p_tramo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t comision_tramos; k contracts; v_pagado numeric; v_pct numeric; v_firmado boolean; v_hito boolean; v_honorario boolean; v_lista jsonb;
begin
  select * into t from comision_tramos where id = p_tramo;
  select c.* into k from contracts c join comisiones m on m.contract_id = c.id where m.id = t.comision_id;
  v_firmado := k.estado = 'firmado';
  v_honorario := t.honorario_en is not null;
  if t.numero = 1 then
    select coalesce(sum(p.monto), 0) into v_pagado from payments p where p.contract_id = k.id and p.estado = 'verificado';
    v_pct := case when k.precio > 0 then round(v_pagado * 100 / k.precio, 2) else 0 end;
    v_lista := jsonb_build_array(
      jsonb_build_object('texto', 'Promesa firmada', 'ok', v_firmado),
      jsonb_build_object('texto', 'Al menos 10 % del precio pagado (' || v_pct || ' % verificado en Cobranzas)', 'ok', v_pagado >= k.precio * 0.10),
      jsonb_build_object('texto', 'Honorario recibido por Jarva', 'ok', v_honorario));
  else
    v_hito := exists (select 1 from contract_milestones h where h.contract_id = k.id and h.hito in ('escritura', 'desembolso') and h.revertido_en is null);
    v_lista := jsonb_build_array(
      jsonb_build_object('texto', 'Escritura o desembolso registrado', 'ok', v_firmado and v_hito),
      jsonb_build_object('texto', 'Honorario recibido por Jarva', 'ok', v_honorario));
  end if;
  return v_lista;
end $$;

create or replace function public.comision_cumple(p_tramo uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from jsonb_array_elements(public.comision_condiciones(p_tramo)) c where not (c ->> 'ok')::boolean)
$$;

create or replace function public.comision_politica_aprobada() returns boolean
language sql stable security definer set search_path = public as $$
  select liquidacion_aprobada from comision_parametros where id = 1
$$;

-- Quién participó, según quedó fijado en la venta: reasignar al cliente después no le quita la comisión de vista.
create or replace function public.comision_en_alcance(k public.contracts) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.en_alcance(k.asesor_id), false) or coalesce(public.en_alcance(k.responsable_id), false)
    or coalesce(public.en_alcance(k.corredor_origen_id), false) or coalesce(public.en_alcance(k.atribucion_usuario_id), false)
    or public.cliente_en_alcance(k.client_id)
$$;

-- Toma un tramo vigente: comisión primero, luego el tramo, siempre en ese orden.
create or replace function public.comision_tomar_tramo(p_tramo uuid) returns public.comision_tramos
language plpgsql security definer set search_path = public as $$
declare t comision_tramos; v_comision uuid; v_estado text; k contracts;
begin
  select comision_id into v_comision from comision_tramos where id = p_tramo;
  if not found then raise exception 'Tramo inexistente'; end if;
  select estado into v_estado from comisiones where id = v_comision for update;
  select c.* into k from contracts c join comisiones m on m.contract_id = c.id where m.id = v_comision;
  if not public.comision_en_alcance(k) then raise exception 'Comisión fuera de tu alcance' using errcode = '42501'; end if;
  if v_estado = 'anulada' then raise exception 'La comisión está anulada porque se anuló el contrato'; end if;
  select * into t from comision_tramos where id = p_tramo for update;
  return t;
end $$;

/* ------------------------------------------------------------ política de liquidación */

create or replace function public.comisiones_aprobar_politica(p_documento text, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); v_nombre text;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para aprobar la política de liquidación' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_documento, ''))) < 3 then raise exception 'Indica el documento que respalda la aprobación'; end if;
  if public.comision_politica_aprobada() then raise exception 'La política ya está aprobada'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_parametros set liquidacion_aprobada = true, liquidacion_documento = trim(p_documento), liquidacion_motivo = v_m, liquidacion_por = auth.uid(), liquidacion_nombre = v_nombre, liquidacion_en = now() where id = 1;
  perform public.auditar('Aprobar política de liquidación', 'comisiones', 'politica', v_m, jsonb_build_object('aprobada', false), jsonb_build_object('aprobada', true, 'documento', trim(p_documento)));
end $$;

create or replace function public.comisiones_revocar_politica(p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); v_nombre text;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para revocar la política de liquidación' using errcode = '42501'; end if;
  if not public.comision_politica_aprobada() then raise exception 'La política no está aprobada'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_parametros set liquidacion_aprobada = false, liquidacion_motivo = v_m, liquidacion_por = auth.uid(), liquidacion_nombre = v_nombre, liquidacion_en = now() where id = 1;
  perform public.auditar('Revocar política de liquidación', 'comisiones', 'politica', v_m, jsonb_build_object('aprobada', true), jsonb_build_object('aprobada', false));
end $$;

/* ---------------------------------------------------------------------- honorario */

create or replace function public.comisiones_registrar_honorario(p_tramo uuid, p_monto numeric, p_fecha date, p_referencia text) returns void
language plpgsql security definer set search_path = public as $$
declare t comision_tramos; v_nombre text;
begin
  if not public.tiene_permiso('comisiones.finanzas') then raise exception 'Sin permiso para registrar el honorario' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if t.estado <> 'pendiente' then raise exception 'Solo se registra el honorario de un tramo pendiente, con el contrato firmado'; end if;
  if t.honorario_en is not null then raise exception 'Este tramo ya tiene honorario registrado; quítalo si hay que corregirlo'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Indica el monto recibido'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de recepción no es válida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del ingreso'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_tramos set honorario_monto = round(p_monto, 2), honorario_fecha = p_fecha, honorario_referencia = trim(p_referencia), honorario_por = auth.uid(), honorario_nombre = v_nombre, honorario_en = now() where id = p_tramo;
  perform public.auditar('Registrar honorario recibido', 'comision', t.comision_id::text, 'Tramo ' || t.numero || ' · ' || trim(p_referencia), null, jsonb_build_object('tramo', t.numero, 'monto', round(p_monto, 2), 'fecha', p_fecha));
end $$;

create or replace function public.comisiones_quitar_honorario(p_tramo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); t comision_tramos;
begin
  if not public.tiene_permiso('comisiones.finanzas') then raise exception 'Sin permiso para corregir el honorario' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if t.honorario_en is null then raise exception 'Este tramo no tiene honorario registrado'; end if;
  if t.estado <> 'pendiente' then raise exception 'El tramo ya está habilitado o pagado: revierte eso primero'; end if;
  update comision_tramos set honorario_monto = null, honorario_fecha = null, honorario_referencia = null, honorario_por = null, honorario_nombre = null, honorario_en = null where id = p_tramo;
  perform public.auditar('Quitar honorario recibido', 'comision', t.comision_id::text, v_m, jsonb_build_object('tramo', t.numero, 'monto', t.honorario_monto, 'referencia', t.honorario_referencia), null);
end $$;

/* --------------------------------------------------------------- habilitar y pagar */

create or replace function public.comisiones_habilitar(p_tramo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); t comision_tramos; v_nombre text;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para habilitar la liquidación' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if t.estado <> 'pendiente' then raise exception 'Solo se habilita un tramo pendiente'; end if;
  if not public.comision_politica_aprobada() then raise exception 'La política de liquidación aún no tiene aprobación formal'; end if;
  if not public.comision_cumple(p_tramo) then raise exception 'El tramo todavía no cumple sus condiciones'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_tramos set estado = 'habilitada', habilitada_por = auth.uid(), habilitada_nombre = v_nombre, habilitada_en = now(), habilitada_motivo = v_m where id = p_tramo;
  perform public.auditar('Habilitar tramo de comisión', 'comision', t.comision_id::text, v_m, jsonb_build_object('tramo', t.numero, 'estado', 'pendiente'), jsonb_build_object('tramo', t.numero, 'estado', 'habilitada', 'monto', t.monto));
end $$;

create or replace function public.comisiones_deshabilitar(p_tramo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); t comision_tramos;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para cambiar la habilitación' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if t.estado <> 'habilitada' then raise exception 'Este tramo no está habilitado'; end if;
  update comision_tramos set estado = 'pendiente', habilitada_por = null, habilitada_nombre = null, habilitada_en = null, habilitada_motivo = null where id = p_tramo;
  perform public.auditar('Quitar habilitación de comisión', 'comision', t.comision_id::text, v_m, jsonb_build_object('tramo', t.numero, 'estado', 'habilitada', 'habilitada_por', t.habilitada_por), jsonb_build_object('tramo', t.numero, 'estado', 'pendiente'));
end $$;

-- Registra un pago hecho fuera del sistema. No mueve dinero; exige confirmación expresa de Finanzas, y vuelve a comprobarlo todo.
create or replace function public.comisiones_confirmar_pago(p_tramo uuid, p_fecha date, p_beneficiario text, p_referencia text, p_confirmo boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare t comision_tramos; v_nombre text; v_id uuid;
begin
  if not public.tiene_permiso('comisiones.finanzas') then raise exception 'Sin permiso para confirmar pagos' using errcode = '42501'; end if;
  if p_confirmo is not true then raise exception 'Confirma que el pago se realizó'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if t.estado = 'pagada' then raise exception 'Este tramo ya está pagado'; end if;
  if t.estado <> 'habilitada' then raise exception 'Este tramo no está habilitado para liquidación'; end if;
  if not public.comision_politica_aprobada() then raise exception 'La política de liquidación no tiene aprobación vigente'; end if;
  if not public.comision_cumple(p_tramo) then raise exception 'El tramo dejó de cumplir sus condiciones: revisa Cobranzas y Contratos'; end if;
  if t.habilitada_por = auth.uid() then raise exception 'Quien habilitó el tramo no puede confirmar su pago' using errcode = '42501'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de pago no es válida'; end if;
  if char_length(trim(coalesce(p_beneficiario, ''))) < 3 then raise exception 'Indica a quién se pagó'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del pago o la factura'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  insert into comision_movimientos (comision_id, tramo_id, tipo, monto, fecha, beneficiario, referencia, motivo, registrado_por, registrado_nombre)
  values (t.comision_id, t.id, 'pago', t.monto, p_fecha, trim(p_beneficiario), trim(p_referencia), 'Pago confirmado por Finanzas', auth.uid(), v_nombre)
  returning id into v_id;
  update comision_tramos set estado = 'pagada' where id = p_tramo;
  perform public.auditar('Confirmar pago de comisión', 'comision', t.comision_id::text, trim(p_referencia), jsonb_build_object('tramo', t.numero, 'estado', 'habilitada'), jsonb_build_object('tramo', t.numero, 'estado', 'pagada', 'monto', t.monto, 'beneficiario', trim(p_beneficiario)));
  return v_id;
end $$;

-- Corrige un pago mal registrado. Conserva el original marcado; el tramo vuelve a pendiente y necesita habilitarse otra vez.
create or replace function public.comisiones_reversar_pago(p_tramo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); t comision_tramos; v comision_movimientos; v_nombre text;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para reversar pagos' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if t.estado <> 'pagada' then raise exception 'Este tramo no tiene un pago vigente'; end if;
  select * into v from comision_movimientos where tramo_id = p_tramo and tipo = 'pago' and revertido_en is null for update;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_movimientos set revertido_por = auth.uid(), revertido_nombre = v_nombre, revertido_en = now(), motivo_reverso = v_m where id = v.id;
  insert into comision_movimientos (comision_id, tramo_id, tipo, monto, referencia, motivo, registrado_por, registrado_nombre)
  values (t.comision_id, t.id, 'reverso_pago', -t.monto, v.referencia, v_m, auth.uid(), v_nombre);
  update comision_tramos set estado = 'pendiente', habilitada_por = null, habilitada_nombre = null, habilitada_en = null, habilitada_motivo = null where id = p_tramo;
  perform public.auditar('Reversar pago de comisión', 'comision', t.comision_id::text, v_m, jsonb_build_object('tramo', t.numero, 'estado', 'pagada', 'referencia', v.referencia), jsonb_build_object('tramo', t.numero, 'estado', 'pendiente'));
end $$;

-- Ajuste con respaldo, positivo o negativo. No cambia el porcentaje histórico ni el monto de los tramos.
create or replace function public.comisiones_ajustar(p_comision uuid, p_monto numeric, p_motivo text, p_evidencia text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); m comisiones; k contracts; v_nombre text; v_id uuid;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para registrar ajustes' using errcode = '42501'; end if;
  select * into m from comisiones where id = p_comision for update;
  if not found then raise exception 'Comisión inexistente'; end if;
  select * into k from contracts where id = m.contract_id;
  if not public.comision_en_alcance(k) then raise exception 'Comisión fuera de tu alcance' using errcode = '42501'; end if;
  if m.estado <> 'vigente' then raise exception 'Solo se ajusta una comisión de una venta firmada y vigente'; end if;
  if p_monto is null or p_monto = 0 then raise exception 'Indica el monto del ajuste'; end if;
  if char_length(trim(coalesce(p_evidencia, ''))) < 3 then raise exception 'Indica el documento que respalda el ajuste'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  insert into comision_movimientos (comision_id, tipo, monto, referencia, motivo, registrado_por, registrado_nombre)
  values (p_comision, 'ajuste', round(p_monto, 2), trim(p_evidencia), v_m, auth.uid(), v_nombre) returning id into v_id;
  perform public.auditar('Ajustar comisión', 'comision', p_comision::text, v_m, null, jsonb_build_object('monto', round(p_monto, 2), 'evidencia', trim(p_evidencia)));
  return v_id;
end $$;

-- Deja constancia de que se recuperó lo pagado de una venta anulada. El descuento o devolución se gestiona fuera.
create or replace function public.comisiones_registrar_recuperacion(p_movimiento uuid, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_nota); v comision_movimientos; v_nombre text;
begin
  if not public.tiene_permiso('comisiones.finanzas') then raise exception 'Sin permiso para registrar recuperaciones' using errcode = '42501'; end if;
  select * into v from comision_movimientos where id = p_movimiento and tipo = 'por_recuperar' for update;
  if not found then raise exception 'Movimiento inexistente'; end if;
  if v.recuperado_en is not null then raise exception 'Este monto ya figura como recuperado'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_movimientos set recuperado_por = auth.uid(), recuperado_nombre = v_nombre, recuperado_en = now(), nota_recuperacion = v_m where id = p_movimiento;
  perform public.auditar('Registrar recuperación de comisión', 'comision', v.comision_id::text, v_m, jsonb_build_object('estado', 'por_recuperar'), jsonb_build_object('estado', 'recuperado', 'monto', v.monto));
end $$;

/* ------------------------------------------------------------------------ consulta */

-- Quien solo ve las suyas no recibe referencias bancarias, honorarios ni beneficiarios.
create or replace function public.comisiones_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestiona boolean := public.tiene_permiso('comisiones.calcular') or public.tiene_permiso('comisiones.finanzas') or public.tiene_permiso('comisiones.aprobar');
begin
  if not (public.tiene_permiso('comisiones.ver_propias') or v_gestiona) then raise exception 'Sin permiso para ver comisiones' using errcode = '42501'; end if;
  return jsonb_build_object(
    'porcentaje', public.comisiones_porcentaje(),
    'politica', (select jsonb_build_object('aprobada', p.liquidacion_aprobada, 'documento', p.liquidacion_documento, 'nombre', p.liquidacion_nombre, 'en', p.liquidacion_en) from comision_parametros p where p.id = 1),
    'comisiones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'estado', m.estado, 'porcentaje', m.porcentaje, 'precio_base', m.precio_base, 'monto_total', m.monto_total, 'motivo_anulacion', m.motivo_anulacion,
        'contrato', k.codigo, 'contrato_estado', k.estado, 'fecha_contrato', k.fecha_contrato, 'unidad', k.codigo_unidad, 'cliente', c.nombre, 'origen', k.origen,
        'asesor', (select nombre from profiles where id = k.asesor_id), 'corredor', (select nombre from profiles where id = k.corredor_origen_id),
        'ajustes', coalesce((select sum(x.monto) from comision_movimientos x where x.comision_id = m.id and x.tipo = 'ajuste'), 0),
        'por_recuperar', coalesce((select -sum(x.monto) from comision_movimientos x where x.comision_id = m.id and x.tipo = 'por_recuperar' and x.recuperado_en is null), 0),
        'tramos', (select jsonb_agg(jsonb_build_object(
            'id', t.id, 'numero', t.numero, 'porcentaje', t.porcentaje, 'monto', t.monto, 'estado', t.estado,
            'condiciones', public.comision_condiciones(t.id), 'cumple', public.comision_cumple(t.id),
            'habilitada_por', case when v_gestiona then t.habilitada_por end, 'habilitada_nombre', t.habilitada_nombre,
            'honorario', case when v_gestiona and t.honorario_en is not null then jsonb_build_object('monto', t.honorario_monto, 'fecha', t.honorario_fecha, 'referencia', t.honorario_referencia, 'nombre', t.honorario_nombre) end,
            'pago', (select jsonb_build_object('fecha', x.fecha, 'monto', x.monto, 'beneficiario', case when v_gestiona then x.beneficiario end, 'referencia', case when v_gestiona then x.referencia end)
                     from comision_movimientos x where x.tramo_id = t.id and x.tipo = 'pago' and x.revertido_en is null)
          ) order by t.numero) from comision_tramos t where t.comision_id = m.id),
        'movimientos', case when v_gestiona then coalesce((select jsonb_agg(jsonb_build_object(
            'id', x.id, 'tipo', x.tipo, 'monto', x.monto, 'fecha', x.fecha, 'beneficiario', x.beneficiario, 'referencia', x.referencia, 'motivo', x.motivo,
            'registrado_nombre', x.registrado_nombre, 'registrado_en', x.registrado_en, 'revertido_en', x.revertido_en, 'motivo_reverso', x.motivo_reverso,
            'recuperado_en', x.recuperado_en, 'recuperado_nombre', x.recuperado_nombre, 'nota_recuperacion', x.nota_recuperacion
          ) order by x.registrado_en, x.id) from comision_movimientos x where x.comision_id = m.id), '[]'::jsonb) else '[]'::jsonb end
      ) order by k.fecha_contrato desc, k.codigo)
      from comisiones m join contracts k on k.id = m.contract_id join clients c on c.id = k.client_id
      where public.comision_en_alcance(k)), '[]'::jsonb));
end $$;

/* ------------------------------------------------------------ permisos de funciones */

do $$
declare fn text;
begin
  foreach fn in array array['public.comisiones_aprobar_politica(text, text)', 'public.comisiones_revocar_politica(text)', 'public.comisiones_registrar_honorario(uuid, numeric, date, text)',
    'public.comisiones_quitar_honorario(uuid, text)', 'public.comisiones_habilitar(uuid, text)', 'public.comisiones_deshabilitar(uuid, text)',
    'public.comisiones_confirmar_pago(uuid, date, text, text, boolean)', 'public.comisiones_reversar_pago(uuid, text)', 'public.comisiones_ajustar(uuid, numeric, text, text)',
    'public.comisiones_registrar_recuperacion(uuid, text)', 'public.comisiones_listar()'] loop
    execute format('revoke all on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
  foreach fn in array array['public.comision_sincronizar(uuid, numeric, boolean)', 'public.comision_anular(uuid, text)', 'public.contrato_comision()', 'public.comision_condiciones(uuid)',
    'public.comision_cumple(uuid)', 'public.comision_politica_aprobada()', 'public.comision_en_alcance(public.contracts)', 'public.comision_tomar_tramo(uuid)',
    'public.comision_proteger()', 'public.comision_sin_borrado()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end $$;
