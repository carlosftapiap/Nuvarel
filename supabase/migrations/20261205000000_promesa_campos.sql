-- AMURA · Promesa de compraventa: campos del catálogo de documentos contractuales (sin ejecutar en producción).
-- La promesa usa el módulo existente de Documentos contractuales (tipo «promesa_compraventa»): plantilla aprobada
-- por Legal, versiones, PDF, firma e historial. Aquí solo se agregan al catálogo los datos que la plantilla necesita
-- y que ya calcula la aplicación:
--   · Áreas del departamento (útil, bodega y patio).
--   · Pago inicial 6 % (reserva incluida), entrada total 20 % (6 % + 14 % en cuotas) y saldo 80 % por crédito
--     hipotecario, con sus montos en letras.
-- Solo agrega filas al catálogo. No cambia plantillas, documentos, contratos ni pagos.

-- Solo si el módulo de Documentos contractuales está instalado.
do $do$
begin
  if to_regclass('public.contract_fields') is null then return; end if;

  insert into public.contract_fields (clave, grupo, etiqueta, tipo, deriva_de, descripcion) values
    ('unidad.area_m2', 'Unidad', 'Área útil del departamento (m²)', 'numero', null, ''),
    ('unidad.bodega_m2', 'Unidad', 'Área de bodega (m²)', 'numero', null, ''),
    ('unidad.patio_m2', 'Unidad', 'Área de patio o terraza (m²)', 'numero', null, ''),
    ('pago.inicial', 'Condiciones de pago', 'Pago inicial 6 % (incluye la reserva)', 'dinero', null, 'Reserva más el pago a la firma'),
    ('pago.entrada_total', 'Condiciones de pago', 'Entrada total 20 %', 'dinero', null, 'Pago inicial 6 % más las cuotas del 14 %'),
    ('pago.credito', 'Condiciones de pago', 'Saldo 80 % previsto con crédito hipotecario', 'dinero', null, 'Sujeto a la aprobación de la entidad financiera')
  on conflict (clave) do nothing;

  insert into public.contract_fields (clave, grupo, etiqueta, tipo, deriva_de, descripcion) values
    ('pago.inicial_letras', 'Condiciones de pago', 'Pago inicial 6 % en letras', 'texto', 'pago.inicial', ''),
    ('pago.entrada_total_letras', 'Condiciones de pago', 'Entrada total 20 % en letras', 'texto', 'pago.entrada_total', ''),
    ('pago.credito_letras', 'Condiciones de pago', 'Saldo 80 % en letras', 'texto', 'pago.credito', '')
  on conflict (clave) do nothing;
end $do$;
