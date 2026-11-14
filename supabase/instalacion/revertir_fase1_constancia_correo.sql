-- AMURA · Recuperación de la fase 1: deshace 20261112000000_constancia_provisional.sql y 20261112010000_correo_destinatario_efectivo.sql.
-- No toca pagos, reservas, recibos, contratos ni la cola de correos existente.
-- Se detiene sin cambiar nada si ya se emitieron constancias o se registraron envíos con destinatario efectivo:
-- en ese caso no se revierte (se perdería trazabilidad) y se corrige con una migración nueva.
-- Antes de revertir, volver a publicar la versión anterior de la app: la nueva envía p_medio y fallaría sin estas funciones.

begin;

do $$ begin
  if exists (select 1 from public.comprobantes_pago where constancia_numero is not null) then
    raise exception 'Ya hay constancias emitidas: no se revierte. Corregir con una migración nueva.';
  end if;
  if exists (select 1 from public.comprobantes_pago where medio <> 'transferencia') then
    raise exception 'Ya hay comprobantes con medio de pago registrado: no se revierte.';
  end if;
  if exists (select 1 from public.cobranza_alertas where destinatario_efectivo is not null) then
    raise exception 'Ya hay envíos con destinatario efectivo registrado: no se revierte.';
  end if;
end $$;

drop function if exists public.reservas_reportar_pago(uuid, numeric, date, text, text, jsonb, text);
drop function if exists public.cobranzas_reportar_pago(uuid, numeric, date, text, text, jsonb, text);
drop trigger if exists comprobantes_constancia on public.comprobantes_pago;
drop function if exists public.comprobantes_constancia_numero();
drop index if exists public.comprobantes_constancia_unica;
alter table public.comprobantes_pago drop constraint if exists comprobantes_pago_medio_valido;
alter table public.comprobantes_pago drop column if exists constancia_numero;
alter table public.comprobantes_pago drop column if exists medio;
alter table public.cobranza_alertas drop column if exists destinatario_efectivo;

commit;
