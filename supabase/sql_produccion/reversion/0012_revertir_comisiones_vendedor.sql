-- AMURA · Reversión de 0012_comisiones_vendedor.sql. Ejecutar solo con autorización y después de un respaldo.
-- Restaura, copiadas sin cambios de supabase/migrations/20261031060000_comisiones_tramos.sql, las funciones que 0012 redefinió
-- (comisiones_listar con el nombre del corredor que aplicó 20261031080000_integracion_final.sql).
-- Conserva columnas y datos agregados (esquema, beneficiario, umbral): no se borra información ni auditoría.
-- Efecto: las comisiones nuevas vuelven a crearse en dos tramos de 50 %. Una comisión creada con el esquema del vendedor
-- conserva su único tramo, pero se evalúa con las condiciones del tramo 1 anterior (10 % pagado y honorario recibido).

begin;

update public.comision_parametros set esquema = 'dos_tramos' where id = 1;

-- Porcentaje y base históricos: una vez firmada la venta no cambian, ni siquiera desde una función.
create or replace function public.comision_proteger() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.estado <> 'calculada' and (new.precio_base, new.porcentaje, new.monto_total) is distinct from (old.precio_base, old.porcentaje, old.monto_total) then
    raise exception 'El porcentaje y la base de una venta firmada no se modifican: registra un ajuste' using errcode = '42501';
  end if;
  return new;
end $$;

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
        'asesor', (select nombre from profiles where id = k.asesor_id), 'corredor', (select nombre from corredores where id = k.corredor_origen_id),
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

commit;
