-- AMURA · Constancia provisional de recepción de comprobante (fase 1 del plan de brechas).
--   · Cada comprobante nuevo recibe un número de constancia CP-AAAA-0001 al registrarse. La constancia NO acredita dinero recibido:
--     el pago se acredita solo con el recibo definitivo REC-, que se sigue emitiendo al confirmar, como hasta ahora.
--   · Medio del pago: transferencia, depósito o cheque. Para un cheque, la referencia es el número de cheque y el banco, el girador.
-- Aditiva: no modifica comprobantes, pagos, reservas ni recibos existentes; los comprobantes anteriores quedan sin número de constancia.
-- Revertir: drop function public.reservas_reportar_pago(uuid, numeric, date, text, text, jsonb, text);
--           drop function public.cobranzas_reportar_pago(uuid, numeric, date, text, text, jsonb, text);
--           drop trigger comprobantes_constancia on public.comprobantes_pago; drop function public.comprobantes_constancia_numero();
--           alter table public.comprobantes_pago drop column constancia_numero, drop column medio;
-- Ejecutar después de 20261101000000_accesos_internos.sql y con un respaldo verificado.

alter table public.comprobantes_pago add column if not exists medio text not null default 'transferencia';
alter table public.comprobantes_pago drop constraint if exists comprobantes_pago_medio_valido;
alter table public.comprobantes_pago add constraint comprobantes_pago_medio_valido check (medio in ('transferencia', 'deposito', 'cheque'));
alter table public.comprobantes_pago add column if not exists constancia_numero text;
create unique index if not exists comprobantes_constancia_unica on public.comprobantes_pago (constancia_numero) where constancia_numero is not null;

-- Misma numeración que los recibos: correlativa por año y protegida contra registros simultáneos.
create or replace function public.comprobantes_constancia_numero() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_anio text := to_char(now() at time zone 'America/Guayaquil', 'YYYY');
begin
  if new.constancia_numero is null then
    perform pg_advisory_xact_lock(hashtext('constancias_numero'));
    new.constancia_numero := 'CP-' || v_anio || '-' || lpad((select count(*) + 1 from comprobantes_pago where constancia_numero like 'CP-' || v_anio || '-%')::text, 4, '0');
  end if;
  return new;
end $$;
revoke all on function public.comprobantes_constancia_numero() from public, anon, authenticated;

drop trigger if exists comprobantes_constancia on public.comprobantes_pago;
create trigger comprobantes_constancia before insert on public.comprobantes_pago for each row execute function public.comprobantes_constancia_numero();

-- Las funciones de registro siguen igual; estas versiones agregan el medio del pago en la misma transacción.
create or replace function public.reservas_reportar_pago(p_id uuid, p_monto numeric, p_fecha date, p_banco text, p_referencia text, p_archivo jsonb, p_medio text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_medio, '') not in ('transferencia', 'deposito', 'cheque') then raise exception 'Indica si el pago es transferencia, depósito o cheque'; end if;
  v_id := public.reservas_reportar_pago(p_id, p_monto, p_fecha, p_banco, p_referencia, p_archivo);
  update comprobantes_pago set medio = p_medio where id = v_id;
  return v_id;
end $$;

create or replace function public.cobranzas_reportar_pago(p_contract uuid, p_monto numeric, p_fecha date, p_banco text, p_referencia text, p_archivo jsonb, p_medio text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if coalesce(p_medio, '') not in ('transferencia', 'deposito', 'cheque') then raise exception 'Indica si el pago es transferencia, depósito o cheque'; end if;
  v_id := public.cobranzas_reportar_pago(p_contract, p_monto, p_fecha, p_banco, p_referencia, p_archivo);
  update comprobantes_pago set medio = p_medio where payment_id = v_id;
  return v_id;
end $$;

revoke all on function public.reservas_reportar_pago(uuid, numeric, date, text, text, jsonb, text) from public, anon;
revoke all on function public.cobranzas_reportar_pago(uuid, numeric, date, text, text, jsonb, text) from public, anon;
grant execute on function public.reservas_reportar_pago(uuid, numeric, date, text, text, jsonb, text) to authenticated;
grant execute on function public.cobranzas_reportar_pago(uuid, numeric, date, text, text, jsonb, text) to authenticated;
