-- AMURA · SQL de producción 0012. Copia exacta de supabase/migrations/20261122000000_comisiones_vendedor.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Comisión del vendedor. PROPUESTA TÉCNICA pendiente de formalización contractual.
--   · 2,60 % del precio total del departamento, a nombre del responsable comercial registrado en la venta
--     (contracts.responsable_id: quien llevó la negociación; si no hay, el asesor del cliente). Un supervisor que vende
--     también es beneficiario. Si participa un corredor, no se duplica: cada venta tiene un solo beneficiario.
--   · Lista para pago cuando, a la vez: promesa de compraventa firmada y pagos verificados por Finanzas de al menos 6 %
--     del precio. Sin tramos, sin escritura ni desembolso, sin factura ni IVA.
--   · Porcentaje, base y beneficiario quedan fijos al formalizar la venta.
--   · Finanzas registra y confirma el desembolso con su comprobante; todo queda en auditoría. Se mantiene la aprobación
--     general de la política de comisiones.
--   · Mientras no se resuelva el beneficiario contractual del 2,60 %, los pagos a vendedores quedan BLOQUEADOS
--     (comision_parametros.pagos_vendedor_habilitados = false). No hay función para activarlos: requiere una migración autorizada.
-- Las comisiones que ya existen conservan su esquema (dos tramos): nada se recalcula, no cambian importes pagados ni auditoría.
-- Reversión: supabase/sql_produccion/reversion/0012_revertir_comisiones_vendedor.sql.
-- Ejecutar después de 20261031060000_comisiones_tramos.sql.

do $$ begin
  if to_regclass('public.comision_tramos') is null or to_regprocedure('public.comision_sincronizar(uuid, numeric, boolean)') is null then
    raise exception 'Falta Comisiones por tramos: aplica antes 20261031060000_comisiones_tramos.sql';
  end if;
end $$;

/* --------------------------------------------------------------------- estado previo */

-- Producción recibió una versión anterior de esta migración (comisiones VELKROVA), aplicada en parte: dejó
-- esquema = 'velkrova' en los parámetros y en las comisiones. Se convierte aquí. Si hubiera comisiones con ese
-- esquema, la migración se detiene sin cambiar nada.
alter table public.comisiones add column if not exists esquema text;
do $$ begin
  if exists (select 1 from public.comisiones where esquema = 'velkrova') then
    raise exception 'Hay comisiones con el esquema VELKROVA anterior: revísalas antes de aplicar esta migración';
  end if;
end $$;
alter table public.comision_parametros drop constraint if exists comision_parametros_velkrova_ck;
alter table public.comisiones drop constraint if exists comisiones_esquema_ck;

/* --------------------------------------------------------------------- parámetros */

alter table public.comision_parametros add column if not exists esquema text not null default 'vendedor';
update public.comision_parametros set esquema = 'vendedor' where esquema = 'velkrova';
alter table public.comision_parametros alter column esquema set default 'vendedor';
alter table public.comision_parametros add column if not exists umbral_pago_pct numeric(5,2) not null default 6.00;
alter table public.comision_parametros add column if not exists pagos_vendedor_habilitados boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'comision_parametros_vendedor_ck') then
    alter table public.comision_parametros add constraint comision_parametros_vendedor_ck check (esquema in ('vendedor', 'dos_tramos') and umbral_pago_pct > 0 and umbral_pago_pct <= 100);
  end if;
end $$;

/* --------------------------------------------------------------------- comisiones */

-- Las comisiones existentes quedan con el esquema anterior y su beneficiario histórico.
alter table public.comisiones add column if not exists beneficiario_id uuid references auth.users (id);
alter table public.comisiones add column if not exists beneficiario text;
alter table public.comisiones add column if not exists umbral_pago_pct numeric(5,2);
update public.comisiones set esquema = 'dos_tramos' where esquema is null;
alter table public.comisiones alter column esquema set not null;
alter table public.comisiones alter column esquema set default 'dos_tramos';
alter table public.comisiones add constraint comisiones_esquema_ck check (esquema in ('vendedor', 'dos_tramos'));

-- Porcentaje, base, esquema y beneficiario históricos: una vez firmada la venta no cambian, ni siquiera desde una función.
create or replace function public.comision_proteger() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.estado <> 'calculada' and (new.precio_base, new.porcentaje, new.monto_total, new.esquema, new.beneficiario_id)
                                   is distinct from (old.precio_base, old.porcentaje, old.monto_total, old.esquema, old.beneficiario_id) then
    raise exception 'El porcentaje, la base y el beneficiario de una venta firmada no se modifican: registra un ajuste' using errcode = '42501';
  end if;
  return new;
end $$;

/* ------------------------------------------------------- conexión con Contratos */

-- Crea la comisión de un contrato o, si ya existe y sigue sin firmar, fija su porcentaje y su beneficiario al firmar.
-- Las nuevas usan el esquema vigente (vendedor: una sola comisión del 100 %); las existentes conservan el suyo.
create or replace function public.comision_sincronizar(p_contrato uuid, p_precio numeric, p_firmado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pct numeric := public.comisiones_porcentaje(); v_total numeric := round(p_precio * v_pct / 100, 2); v_uno numeric := round(v_total / 2, 2);
  v_id uuid; v_estado text; v_esquema text; p comision_parametros; v_benef uuid; v_nombre text;
begin
  select * into p from comision_parametros where id = 1;
  select coalesce(k.responsable_id, k.asesor_id) into v_benef from contracts k where k.id = p_contrato;
  select nombre into v_nombre from profiles where id = v_benef;
  select id, estado, esquema into v_id, v_estado, v_esquema from comisiones where contract_id = p_contrato for update;
  if v_id is null then
    v_esquema := p.esquema;
    insert into comisiones (contract_id, precio_base, porcentaje, monto_total, estado, fijada_en, esquema, beneficiario_id, beneficiario, umbral_pago_pct)
    values (p_contrato, p_precio, v_pct, v_total, case when p_firmado then 'vigente' else 'calculada' end, case when p_firmado then now() end, v_esquema,
            case when v_esquema = 'vendedor' then v_benef end, case when v_esquema = 'vendedor' then v_nombre end, case when v_esquema = 'vendedor' then p.umbral_pago_pct end)
    returning id into v_id;
    if v_esquema = 'vendedor' then
      insert into comision_tramos (comision_id, numero, porcentaje, monto, estado) values (v_id, 1, 100, v_total, case when p_firmado then 'pendiente' else 'calculada' end);
    else
      insert into comision_tramos (comision_id, numero, monto, estado) values
        (v_id, 1, v_uno, case when p_firmado then 'pendiente' else 'calculada' end),
        (v_id, 2, v_total - v_uno, case when p_firmado then 'pendiente' else 'calculada' end);
    end if;
  elsif v_estado = 'calculada' and p_firmado then
    if v_esquema = 'vendedor' then
      update comisiones set precio_base = p_precio, porcentaje = v_pct, monto_total = v_total, estado = 'vigente', fijada_en = now(),
        beneficiario_id = v_benef, beneficiario = v_nombre where id = v_id;
      update comision_tramos set monto = v_total, estado = 'pendiente' where comision_id = v_id;
    else
      update comisiones set precio_base = p_precio, porcentaje = v_pct, monto_total = v_total, estado = 'vigente', fijada_en = now() where id = v_id;
      update comision_tramos set monto = case when numero = 1 then v_uno else v_total - v_uno end, estado = 'pendiente' where comision_id = v_id;
    end if;
  end if;
end $$;

/* --------------------------------------------------------------------- condiciones */

-- Se calculan siempre con los datos vivos: si Cobranzas anula un pago o Legal revierte la firma, la condición deja de cumplirse.
create or replace function public.comision_condiciones(p_tramo uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t comision_tramos; m comisiones; k contracts; v_pagado numeric; v_pct numeric; v_firmado boolean; v_hito boolean; v_honorario boolean; v_lista jsonb;
begin
  select * into t from comision_tramos where id = p_tramo;
  select * into m from comisiones where id = t.comision_id;
  select c.* into k from contracts c where c.id = m.contract_id;
  v_firmado := k.estado = 'firmado';
  if m.esquema = 'vendedor' then
    select coalesce(sum(p.monto), 0) into v_pagado from payments p where p.contract_id = k.id and p.estado = 'verificado';
    v_pct := case when k.precio > 0 then round(v_pagado * 100 / k.precio, 2) else 0 end;
    return jsonb_build_array(
      jsonb_build_object('texto', 'Promesa de compraventa firmada', 'ok', v_firmado),
      jsonb_build_object('texto', 'Pagos verificados por Finanzas de al menos ' || rtrim(rtrim(m.umbral_pago_pct::text, '0'), '.') || ' % del precio (' || v_pct || ' % recibido)',
        'ok', v_pagado >= k.precio * m.umbral_pago_pct / 100));
  end if;
  -- Esquema anterior (dos tramos), sin cambios.
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

/* ---------------------------------------------------------------------- honorario */

-- El honorario recibido solo aplica al esquema anterior.
create or replace function public.comisiones_registrar_honorario(p_tramo uuid, p_monto numeric, p_fecha date, p_referencia text) returns void
language plpgsql security definer set search_path = public as $$
declare t comision_tramos; v_nombre text;
begin
  if not public.tiene_permiso('comisiones.finanzas') then raise exception 'Sin permiso para registrar el honorario' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if (select esquema from comisiones where id = t.comision_id) = 'vendedor' then
    raise exception 'La comisión del vendedor no usa honorario: queda lista para pago con la promesa firmada y el 6 %% verificado';
  end if;
  if t.estado <> 'pendiente' then raise exception 'Solo se registra el honorario de un tramo pendiente, con el contrato firmado'; end if;
  if t.honorario_en is not null then raise exception 'Este tramo ya tiene honorario registrado; quítalo si hay que corregirlo'; end if;
  if p_monto is null or p_monto <= 0 then raise exception 'Indica el monto recibido'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de recepción no es válida'; end if;
  if char_length(trim(coalesce(p_referencia, ''))) < 3 then raise exception 'Indica la referencia del ingreso'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_tramos set honorario_monto = round(p_monto, 2), honorario_fecha = p_fecha, honorario_referencia = trim(p_referencia), honorario_por = auth.uid(), honorario_nombre = v_nombre, honorario_en = now() where id = p_tramo;
  perform public.auditar('Registrar honorario recibido', 'comision', t.comision_id::text, 'Tramo ' || t.numero || ' · ' || trim(p_referencia), null, jsonb_build_object('tramo', t.numero, 'monto', round(p_monto, 2), 'fecha', p_fecha));
end $$;

/* --------------------------------------------------------------- habilitar */

-- Opción A: la comisión del vendedor no se habilita a mano; queda lista para pago al cumplir sus condiciones.
create or replace function public.comisiones_habilitar(p_tramo uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_m text := public.clientes_motivo(p_motivo); t comision_tramos; v_nombre text;
begin
  if not public.tiene_permiso('comisiones.aprobar') then raise exception 'Sin permiso para habilitar la liquidación' using errcode = '42501'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  if (select esquema from comisiones where id = t.comision_id) = 'vendedor' then
    raise exception 'La comisión del vendedor no se habilita a mano: queda lista para pago al cumplir sus condiciones';
  end if;
  if t.estado <> 'pendiente' then raise exception 'Solo se habilita un tramo pendiente'; end if;
  if not public.comision_politica_aprobada() then raise exception 'La política de liquidación aún no tiene aprobación formal'; end if;
  if not public.comision_cumple(p_tramo) then raise exception 'El tramo todavía no cumple sus condiciones'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  update comision_tramos set estado = 'habilitada', habilitada_por = auth.uid(), habilitada_nombre = v_nombre, habilitada_en = now(), habilitada_motivo = v_m where id = p_tramo;
  perform public.auditar('Habilitar tramo de comisión', 'comision', t.comision_id::text, v_m, jsonb_build_object('tramo', t.numero, 'estado', 'pendiente'), jsonb_build_object('tramo', t.numero, 'estado', 'habilitada', 'monto', t.monto));
end $$;

/* --------------------------------------------------------------------- pago */

-- Registra un pago hecho fuera del sistema. No mueve dinero; exige confirmación expresa de Finanzas, y vuelve a comprobarlo todo.
-- Vendedor: lista para pago (pendiente y con condiciones cumplidas), a nombre del beneficiario fijado en la venta, con el
-- comprobante del desembolso. Nadie confirma el pago de su propia comisión. Bloqueado mientras no se formalice el beneficiario contractual.
create or replace function public.comisiones_confirmar_pago(p_tramo uuid, p_fecha date, p_beneficiario text, p_referencia text, p_confirmo boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare t comision_tramos; m comisiones; v_nombre text; v_id uuid; v_beneficiario text := trim(coalesce(p_beneficiario, '')); v_referencia text := trim(coalesce(p_referencia, ''));
begin
  if not public.tiene_permiso('comisiones.finanzas') then raise exception 'Sin permiso para confirmar pagos' using errcode = '42501'; end if;
  if p_confirmo is not true then raise exception 'Confirma que el pago se realizó'; end if;
  t := public.comision_tomar_tramo(p_tramo);
  select * into m from comisiones where id = t.comision_id;
  if t.estado = 'pagada' then raise exception 'Este tramo ya está pagado'; end if;
  if m.esquema = 'vendedor' then
    if not (select pagos_vendedor_habilitados from comision_parametros where id = 1) then
      raise exception 'Pagos a vendedores no habilitados: la política de comisión está pendiente de formalización contractual' using errcode = '42501';
    end if;
    if t.estado <> 'pendiente' then raise exception 'Esta comisión no está lista para pago'; end if;
    if m.beneficiario_id = auth.uid() then raise exception 'Nadie confirma el pago de su propia comisión' using errcode = '42501'; end if;
    v_beneficiario := coalesce(m.beneficiario, '');
  elsif t.estado <> 'habilitada' then raise exception 'Este tramo no está habilitado para liquidación';
  end if;
  if not public.comision_politica_aprobada() then raise exception 'La política de liquidación no tiene aprobación vigente'; end if;
  if not public.comision_cumple(p_tramo) then raise exception 'El tramo dejó de cumplir sus condiciones: revisa Cobranzas y Contratos'; end if;
  if t.habilitada_por = auth.uid() then raise exception 'Quien habilitó el tramo no puede confirmar su pago' using errcode = '42501'; end if;
  if p_fecha is null or p_fecha > (now() at time zone 'America/Guayaquil')::date then raise exception 'La fecha de pago no es válida'; end if;
  if char_length(v_beneficiario) < 3 then raise exception 'Indica a quién se pagó'; end if;
  if char_length(v_referencia) < 3 then raise exception 'Indica el comprobante o la referencia del pago'; end if;
  select nombre into v_nombre from profiles where id = auth.uid();
  insert into comision_movimientos (comision_id, tramo_id, tipo, monto, fecha, beneficiario, referencia, motivo, registrado_por, registrado_nombre)
  values (t.comision_id, t.id, 'pago', t.monto, p_fecha, v_beneficiario, v_referencia, 'Pago confirmado por Finanzas', auth.uid(), v_nombre)
  returning id into v_id;
  update comision_tramos set estado = 'pagada' where id = p_tramo;
  perform public.auditar('Confirmar pago de comisión', 'comision', t.comision_id::text, v_referencia, jsonb_build_object('tramo', t.numero, 'estado', t.estado),
    jsonb_build_object('tramo', t.numero, 'estado', 'pagada', 'monto', t.monto, 'beneficiario', v_beneficiario, 'beneficiario_id', m.beneficiario_id));
  return v_id;
end $$;

/* ------------------------------------------------------------------------ consulta */

-- Quien solo ve las suyas no recibe referencias bancarias ni honorarios.
create or replace function public.comisiones_listar() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_gestiona boolean := public.tiene_permiso('comisiones.calcular') or public.tiene_permiso('comisiones.finanzas') or public.tiene_permiso('comisiones.aprobar');
begin
  if not (public.tiene_permiso('comisiones.ver_propias') or v_gestiona) then raise exception 'Sin permiso para ver comisiones' using errcode = '42501'; end if;
  return jsonb_build_object(
    'porcentaje', public.comisiones_porcentaje(),
    'parametros', (select jsonb_build_object('esquema', p.esquema, 'umbral_pago_pct', p.umbral_pago_pct, 'pagos_vendedor_habilitados', p.pagos_vendedor_habilitados)
                   from comision_parametros p where p.id = 1),
    'politica', (select jsonb_build_object('aprobada', p.liquidacion_aprobada, 'documento', p.liquidacion_documento, 'nombre', p.liquidacion_nombre, 'en', p.liquidacion_en) from comision_parametros p where p.id = 1),
    'comisiones', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'estado', m.estado, 'porcentaje', m.porcentaje, 'precio_base', m.precio_base, 'monto_total', m.monto_total, 'motivo_anulacion', m.motivo_anulacion,
        'esquema', m.esquema, 'beneficiario', m.beneficiario, 'beneficiario_id', m.beneficiario_id, 'umbral_pago_pct', m.umbral_pago_pct,
        'contrato', k.codigo, 'contrato_estado', k.estado, 'fecha_contrato', k.fecha_contrato, 'unidad', k.codigo_unidad, 'cliente', c.nombre, 'origen', k.origen,
        'asesor', (select nombre from profiles where id = k.asesor_id), 'corredor', (select nombre from corredores where id = k.corredor_origen_id),
        'ajustes', coalesce((select sum(x.monto) from comision_movimientos x where x.comision_id = m.id and x.tipo = 'ajuste'), 0),
        'por_recuperar', coalesce((select -sum(x.monto) from comision_movimientos x where x.comision_id = m.id and x.tipo = 'por_recuperar' and x.recuperado_en is null), 0),
        'tramos', (select jsonb_agg(jsonb_build_object(
            'id', t.id, 'numero', t.numero, 'porcentaje', t.porcentaje, 'monto', t.monto, 'estado', t.estado,
            'condiciones', public.comision_condiciones(t.id), 'cumple', public.comision_cumple(t.id),
            'lista_para_pago', m.esquema = 'vendedor' and m.estado = 'vigente' and t.estado = 'pendiente' and public.comision_cumple(t.id),
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

/* ------------------------------------------------------- retirar lo de la versión VELKROVA */

-- Factura, IVA y vencimiento ya no forman parte del flujo. Sus columnas quedan sin uso, sin datos.
drop function if exists public.comisiones_registrar_factura(uuid, text, date, numeric);
drop function if exists public.comisiones_quitar_factura(uuid, text);
drop function if exists public.comisiones_definir_iva(numeric, text);
drop function if exists public.sumar_dias_habiles(date, int);
