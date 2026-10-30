-- AMURA · Precios desde la aplicación: parámetros de pago y propuestas de precio con validación en el servidor.
-- Ejecutar después de 20261029040000_administrador_inicial.sql. No modifica datos existentes.

-- El rol de la propuesta es el rol configurable del perfil (texto), igual que en el historial.
alter table public.price_proposals alter column rol type text using rol::text;

-- Parámetros de pago: solo quien tiene inventario.parametros. Valida rangos y deja historial con totales antes y después.
create or replace function public.inventario_actualizar_parametros(
  p_patio numeric, p_reserva numeric, p_cuotas numeric, p_meses_e1 int, p_meses_e2 int, p_motivo text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_antes pricing_params;
  v_id uuid;
  v_total_antes numeric; v_total_despues numeric;
begin
  if not public.tiene_permiso('inventario.parametros') then raise exception 'Sin permiso para modificar parámetros de pago' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if p_patio is null or p_patio < 0 or p_patio > 5000 then raise exception 'El valor del m² de patio debe estar entre 0 y 5000 USD'; end if;
  if p_reserva is null or p_reserva < 0 or p_reserva > 100 then raise exception 'La reserva debe estar entre 0%% y 100%%'; end if;
  if p_cuotas is null or p_cuotas < 0 or p_cuotas > 100 then raise exception 'Las cuotas deben estar entre 0%% y 100%%'; end if;
  if p_reserva + p_cuotas > 100 then raise exception 'Reserva + cuotas no puede superar el 100%%'; end if;
  if p_meses_e1 is null or p_meses_e1 < 1 or p_meses_e1 > 120 then raise exception 'Los meses del Edificio 1 deben estar entre 1 y 120'; end if;
  if p_meses_e2 is null or p_meses_e2 < 1 or p_meses_e2 > 120 then raise exception 'Los meses del Edificio 2 deben estar entre 1 y 120'; end if;

  select * into v_antes from pricing_params where id = 1 for update;
  if (v_antes.patio_usd_m2, v_antes.reserva_pct, v_antes.cuotas_pct, v_antes.meses_e1, v_antes.meses_e2)
     is not distinct from (p_patio, p_reserva, p_cuotas, p_meses_e1, p_meses_e2) then
    raise exception 'No hay cambios en los parámetros';
  end if;

  select sum(precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, u.usd_m2, v_antes.patio_usd_m2)),
         sum(precio_venta(u.area_m2, u.bodega_m2, u.patio_m2, u.usd_m2, p_patio))
    into v_total_antes, v_total_despues
  from inventory_units u;

  update pricing_params set patio_usd_m2 = p_patio, reserva_pct = p_reserva, cuotas_pct = p_cuotas,
                            meses_e1 = p_meses_e1, meses_e2 = p_meses_e2 where id = 1;
  insert into inventory_price_history (user_id, rol, tipo, alcance, motivo, detalle, cambios, total_antes, total_despues)
  values (auth.uid(), (select pr.rol_id from profiles pr where pr.id = auth.uid()), 'parametros', 'Todo el proyecto', trim(p_motivo),
          concat_ws(' · ',
            case when v_antes.patio_usd_m2 <> p_patio then 'Patio USD/m² ' || v_antes.patio_usd_m2 || ' → ' || p_patio end,
            case when v_antes.reserva_pct <> p_reserva then 'Reserva ' || v_antes.reserva_pct || '% → ' || p_reserva || '%' end,
            case when v_antes.cuotas_pct <> p_cuotas then 'Cuotas ' || v_antes.cuotas_pct || '% → ' || p_cuotas || '%' end,
            case when v_antes.meses_e1 <> p_meses_e1 then 'Meses E1 ' || v_antes.meses_e1 || ' → ' || p_meses_e1 end,
            case when v_antes.meses_e2 <> p_meses_e2 then 'Meses E2 ' || v_antes.meses_e2 || ' → ' || p_meses_e2 end),
          '[]'::jsonb, v_total_antes, v_total_despues)
  returning id into v_id;
  perform public.auditar('Cambiar parámetros de pago', 'parametros', '1', trim(p_motivo),
    jsonb_build_object('patio', v_antes.patio_usd_m2, 'reserva', v_antes.reserva_pct, 'cuotas', v_antes.cuotas_pct, 'meses_e1', v_antes.meses_e1, 'meses_e2', v_antes.meses_e2),
    jsonb_build_object('patio', p_patio, 'reserva', p_reserva, 'cuotas', p_cuotas, 'meses_e1', p_meses_e1, 'meses_e2', p_meses_e2));
  return v_id;
end $$;

-- Propuesta de cambio de precio: la calcula y valida el servidor sobre las unidades del alcance. Queda pendiente de aprobación.
create or replace function public.precios_proponer(
  p_modo text, p_valor numeric, p_motivo text,
  p_codigos text[] default null, p_edificio smallint default null, p_piso text default null, p_tipologia text default null,
  p_descripcion text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_patio numeric; v_cambios jsonb; v_id uuid; v_rol text := (select pr.rol_id from profiles pr where pr.id = auth.uid());
  v_desc text;
begin
  if not public.tiene_permiso('precios.proponer') then raise exception 'Sin permiso para proponer cambios de precio' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Motivo obligatorio'; end if;
  if p_modo not in ('fijar', 'porcentaje') then raise exception 'Modo inválido'; end if;
  if p_modo = 'fijar' and (p_valor < 500 or p_valor > 10000) then raise exception 'USD/m2 fuera de rango'; end if;
  if p_modo = 'porcentaje' and (p_valor = 0 or abs(p_valor) > 50) then raise exception 'Porcentaje fuera de rango'; end if;
  select patio_usd_m2 into v_patio from pricing_params where id = 1;

  with objetivo as (
    select u.*, case when p_modo = 'fijar' then round(p_valor, 2) else round(u.usd_m2 * (1 + p_valor / 100), 2) end as nuevo
    from inventory_units u
    where (p_codigos is null or u.codigo = any (p_codigos))
      and (p_edificio is null or u.edificio = p_edificio)
      and (p_piso is null or u.piso = p_piso)
      and (p_tipologia is null or u.tipologia = p_tipologia)
      and u.estado not in ('reservado', 'promesa', 'vendido')
  )
  select jsonb_agg(jsonb_build_object(
    'codigo', codigo, 'antesUsdM2', usd_m2, 'despuesUsdM2', nuevo,
    'antesPrecio', precio_venta(area_m2, bodega_m2, patio_m2, usd_m2, v_patio),
    'despuesPrecio', precio_venta(area_m2, bodega_m2, patio_m2, nuevo, v_patio)))
  into v_cambios from objetivo where nuevo <> usd_m2;
  if v_cambios is null then raise exception 'La propuesta no modifica ningún precio'; end if;

  v_desc := coalesce(nullif(trim(p_descripcion), ''), 'Propuesta ' || p_modo || ' ' || p_valor);
  insert into price_proposals (user_id, rol, modo, valor, p_codigos, p_edificio, p_piso, p_tipologia, motivo, descripcion, cambios, total_antes, total_despues)
  values (auth.uid(), v_rol, p_modo, p_valor, p_codigos, p_edificio, p_piso, p_tipologia, trim(p_motivo), v_desc, v_cambios,
          (select sum((c ->> 'antesPrecio')::numeric) from jsonb_array_elements(v_cambios) c),
          (select sum((c ->> 'despuesPrecio')::numeric) from jsonb_array_elements(v_cambios) c))
  returning id into v_id;
  perform public.auditar('Proponer cambio de precio', 'propuesta_precio', v_id::text, trim(p_motivo), null, jsonb_build_object('descripcion', v_desc));
  return v_id;
end $$;

revoke all on function public.inventario_actualizar_parametros(numeric, numeric, numeric, int, int, text) from public, anon;
revoke all on function public.precios_proponer(text, numeric, text, text[], smallint, text, text, text) from public, anon;
grant execute on function public.inventario_actualizar_parametros(numeric, numeric, numeric, int, int, text) to authenticated;
grant execute on function public.precios_proponer(text, numeric, text, text[], smallint, text, text, text) to authenticated;
