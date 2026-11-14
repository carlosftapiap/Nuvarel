-- AMURA · SQL de producción 0001. Copia exacta de supabase/migrations/20261112010000_correo_destinatario_efectivo.sql: no editar aquí.
-- Ejecutar completo en el SQL Editor de Supabase, en orden numérico. Registrar el resultado en CONTROL_EJECUCION.md.

-- AMURA · Historial de envíos: a quién se entregó de verdad cada correo.
--   · destinatario: la persona a quien corresponde el aviso (no cambia).
--   · destinatario_efectivo: el buzón que lo recibió. En modo prueba (CORREO_PRUEBA_DESTINO) es el buzón de pruebas.
-- Aditiva: no modifica alertas existentes. Revertir: alter table public.cobranza_alertas drop column destinatario_efectivo;
-- Ejecutar después de 20261112000000_constancia_provisional.sql y con un respaldo verificado.

alter table public.cobranza_alertas add column if not exists destinatario_efectivo text;
